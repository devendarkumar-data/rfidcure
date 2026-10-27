// In-memory store used for local development and automated tests. Never allowed in production (see config.js).
import { ALLOWED_TABS, HEADERS_BY_TAB } from '../../shared/registry.js';
import { HttpError, conflict } from '../util.js';

export class MemoryStore {
  constructor() { this.kind = 'memory'; this.tabs = new Map(); this.reads = 0; }
  _tab(tab) {
    if (!ALLOWED_TABS.has(tab)) throw new HttpError(500, `Worksheet "${tab}" is not registered`);
    if (!this.tabs.has(tab)) this.tabs.set(tab, { headers: [...HEADERS_BY_TAB[tab]], rows: [] });
    return this.tabs.get(tab);
  }
  async ensure(tab) { this._tab(tab); }
  async read(tab) {
    this.reads++;
    const t = this._tab(tab);
    return { headers: [...t.headers], rows: t.rows.map((r, i) => ({ ...r, __row: i + 2 })) };
  }
  async append(tab, objs) {
    const t = this._tab(tab);
    for (const o of objs) t.rows.push(Object.fromEntries(t.headers.map((h) => [h, o[h] ?? ''])));
  }
  _check(t, rowNum, expect) {
    const row = t.rows[rowNum - 2];
    if (!row) throw conflict('The record no longer exists - refresh and try again');
    if (expect && String(row[expect.col]) !== String(expect.val)) throw conflict('The record was changed by someone else - refresh and try again');
    return row;
  }
  async updateRow(tab, rowNum, patch, expect) {
    const t = this._tab(tab); const row = this._check(t, rowNum, expect);
    for (const h of t.headers) if (h in patch) row[h] = patch[h] ?? '';
  }
  async deleteRow(tab, rowNum, expect) {
    const t = this._tab(tab); this._check(t, rowNum, expect); t.rows.splice(rowNum - 2, 1);
  }
  async clearData(tab) { this._tab(tab).rows = []; }
  // test / dev helper
  async replaceAll(tab, objs) { const t = this._tab(tab); t.rows = objs.map((o) => Object.fromEntries(t.headers.map((h) => [h, o[h] ?? '']))); }
}
