// Google Sheets store. Uses a service account; the spreadsheet id comes only from the environment.
// Worksheet names are checked against the registry whitelist before any request is made.
import { sheets as sheetsApi } from '@googleapis/sheets';
import { JWT } from 'google-auth-library';
import { ALLOWED_TABS, HEADERS_BY_TAB } from '../../shared/registry.js';
import { HttpError, conflict, sleep } from '../util.js';

const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const CELL_LIMIT = 49000;

export class SheetsStore {
  constructor({ sheetId, clientEmail, privateKey, client, ttlMs = 2500 }) {
    this.kind = 'sheets'; this.id = sheetId; this.ttl = ttlMs;
    this.api = client || sheetsApi({ version: 'v4', auth: new JWT({ email: clientEmail, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
    this.cache = new Map(); this.meta = null; this.ready = new Set();
  }
  // Sheets API quota is ~60 reads/min for one service account, so rarely-changing tabs are cached longer.
  // Writes made through this instance always invalidate; other warm instances may lag by up to this many ms.
  ttlFor(tab) {
    if (['Users', 'Credentials', 'Configuration', 'Security'].includes(tab)) return Math.max(this.ttl, 20000);
    if (tab.endsWith('Master')) return Math.max(this.ttl, 30000);
    return this.ttl;
  }
  _guard(tab) { if (!ALLOWED_TABS.has(tab)) throw new HttpError(500, `Worksheet "${tab}" is not registered`); }
  async _retry(fn) {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        const code = e?.code || e?.response?.status;
        if ((code === 429 || code >= 500) && i < 4) { await sleep(500 * 2 ** i + Math.random() * 250); continue; }
        if (code === 403 || code === 404) console.error('[sheets] Google replied', code, String(e?.message || '').slice(0, 300));
        if (code === 403 || code === 404) throw new HttpError(502, 'Google Sheets refused access. Check that the spreadsheet is shared with the service account (Editor) and the id is correct.');
        throw new HttpError(502, `Google Sheets error: ${e?.message || e}`);
      }
    }
  }
  async _meta(force) {
    if (!this.meta || force) {
      const r = await this._retry(() => this.api.spreadsheets.get({ spreadsheetId: this.id, fields: 'sheets.properties(sheetId,title)' }));
      this.meta = Object.fromEntries((r.data.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
    }
    return this.meta;
  }
  async ensure(tab) {
    this._guard(tab);
    if (this.ready.has(tab)) return;
    const meta = await this._meta();
    if (!(tab in meta)) {
      await this._retry(() => this.api.spreadsheets.batchUpdate({ spreadsheetId: this.id, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } }));
      await this._meta(true);
    }
    const r = await this._retry(() => this.api.spreadsheets.values.get({ spreadsheetId: this.id, range: `'${tab}'!1:1`, valueRenderOption: 'UNFORMATTED_VALUE' }));
    const head = (r.data.values?.[0] || []).map((x) => String(x));
    const want = HEADERS_BY_TAB[tab];
    if (!head.length) {
      await this._retry(() => this.api.spreadsheets.values.update({ spreadsheetId: this.id, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [want] } }));
    } else if (head.join('\u0001') !== want.join('\u0001')) {
      throw new HttpError(500, `Worksheet "${tab}" header row does not match the approved template. Expected: ${want.join(', ')}. Found: ${head.join(', ')}.`);
    }
    this.ready.add(tab);
  }
  async read(tab, { fresh = false } = {}) {
    await this.ensure(tab);
    const c = this.cache.get(tab);
    if (c && !fresh && Date.now() - c.t < this.ttlFor(tab)) return c.data;
    const want = HEADERS_BY_TAB[tab];
    const r = await this._retry(() => this.api.spreadsheets.values.get({ spreadsheetId: this.id, range: `'${tab}'!A:${colName(want.length)}`, valueRenderOption: 'UNFORMATTED_VALUE' }));
    const vals = r.data.values || [];
    const rows = [];
    for (let i = 1; i < vals.length; i++) {
      const v = vals[i]; if (!v || v.every((x) => x === '' || x === null)) continue;
      const o = { __row: i + 1 }; want.forEach((h, j) => { o[h] = v[j] ?? ''; }); rows.push(o);
    }
    const data = { headers: [...want], rows };
    this.cache.set(tab, { t: Date.now(), data });
    return data;
  }
  _ser(tab, o) {
    return HEADERS_BY_TAB[tab].map((h) => {
      let v = o[h]; if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'object') v = JSON.stringify(v);
      if (typeof v === 'string' && v.length > CELL_LIMIT) throw new HttpError(422, `Value in "${h}" is too large for one Google Sheets cell`);
      return v;
    });
  }
  async append(tab, objs) {
    await this.ensure(tab);
    await this._retry(() => this.api.spreadsheets.values.append({ spreadsheetId: this.id, range: `'${tab}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: objs.map((o) => this._ser(tab, o)) } }));
    this.cache.delete(tab);
  }
  async _verify(tab, rowNum, expect) {
    const want = HEADERS_BY_TAB[tab];
    const r = await this._retry(() => this.api.spreadsheets.values.get({ spreadsheetId: this.id, range: `'${tab}'!A${rowNum}:${colName(want.length)}${rowNum}`, valueRenderOption: 'UNFORMATTED_VALUE' }));
    const v = r.data.values?.[0];
    if (!v || v.every((x) => x === '')) throw conflict('The record no longer exists - refresh and try again');
    const o = {}; want.forEach((h, j) => { o[h] = v[j] ?? ''; });
    if (expect && String(o[expect.col]) !== String(expect.val)) throw conflict('The record was changed by someone else - refresh and try again');
    return o;
  }
  async updateRow(tab, rowNum, patch, expect) {
    await this.ensure(tab);
    const cur = await this._verify(tab, rowNum, expect);
    const merged = { ...cur, ...patch };
    const last = colName(HEADERS_BY_TAB[tab].length);
    await this._retry(() => this.api.spreadsheets.values.update({ spreadsheetId: this.id, range: `'${tab}'!A${rowNum}:${last}${rowNum}`, valueInputOption: 'RAW', requestBody: { values: [this._ser(tab, merged)] } }));
    this.cache.delete(tab);
  }
  // Read-only health check of every registered worksheet (used by `npm run check-sheet`).
  async checkAll() {
    const meta = await this._meta(true); const out = [];
    for (const tab of ALLOWED_TABS) {
      if (!(tab in meta)) { out.push({ tab, status: 'missing' }); continue; }
      const r = await this._retry(() => this.api.spreadsheets.values.get({ spreadsheetId: this.id, range: `'${tab}'!1:1`, valueRenderOption: 'UNFORMATTED_VALUE' }));
      const head = (r.data.values?.[0] || []).map(String); const want = HEADERS_BY_TAB[tab];
      out.push({ tab, status: !head.length ? 'empty' : head.join('\u0001') === want.join('\u0001') ? 'ok' : 'mismatch', expected: want, found: head });
    }
    return out;
  }
  // Removes all data rows but keeps the header row. Used by the opening-stock import script only.
  async clearData(tab) {
    await this.ensure(tab);
    await this._retry(() => this.api.spreadsheets.values.clear({ spreadsheetId: this.id, range: `'${tab}'!A2:${colName(HEADERS_BY_TAB[tab].length)}` }));
    this.cache.delete(tab);
  }
  async deleteRow(tab, rowNum, expect) {
    await this.ensure(tab);
    await this._verify(tab, rowNum, expect);
    const meta = await this._meta();
    await this._retry(() => this.api.spreadsheets.batchUpdate({ spreadsheetId: this.id, requestBody: { requests: [{ deleteDimension: { range: { sheetId: meta[tab], dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum } } }] } }));
    this.cache.delete(tab);
  }
}
