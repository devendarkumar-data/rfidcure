// Generic, registry-driven list / create / update / delete. All input is validated against the table definition.
import { TABLE_BY_SLUG, REFS, TAB } from '../shared/registry.js';
import { fieldAccess } from '../shared/permissions.js';
import { assertCan, assertWarehouses, canWriteField, inScope, maskLines, maskRow, parseLines, rowVisible } from './access.js';
import { audit } from './audit.js';
import { POSTERS, writeWarehouses } from './posting.js';
import { StockView, buildCatalog, findNegatives, loadStock } from './stock.js';
import { HttpError, bad, conflict, forbidden, fyOf, isBlank, isDate, normDate, notFound, round2, sstr, today, toNum, unprocessable, withLock } from './util.js';

const MAX_LINES = 300;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

export function tableOr404(slug) {
  const t = TABLE_BY_SLUG[slug];
  if (!t) throw notFound('Unknown table');
  return t;
}

// ---- reference data (masters, warehouses, items) ---------------------------------------------------
export async function masterValues(store, ref) {
  const t = TABLE_BY_SLUG[ref.master];
  const { rows } = await store.read(t.tab);
  return rows.filter((r) => !/^inactive$/i.test(sstr(r.Status))).map((r) => sstr(r[ref.col])).filter(Boolean);
}
export async function warehouseList(store) {
  const set = new Map();
  const { rows } = await store.read(TAB.warehouseMaster);
  for (const r of rows) { const n = sstr(r['Warehouse Name']); if (n) set.set(n.toUpperCase(), n); }
  const { balances } = await loadStock(store);
  for (const e of balances.values()) if (e.warehouse && !/^TRANSIT-/.test(e.warehouse) && !set.has(e.warehouse)) set.set(e.warehouse, e.warehouse); // in-transit locations are system-managed, never selectable
  return [...set.values()].sort();
}
export async function itemCatalog(store, stock) {
  const im = await store.read(TAB.itemMaster);
  const { balances } = stock || (await loadStock(store));
  return buildCatalog(im.rows, balances);
}

// ---- value validation ---------------------------------------------------------------------------------
export function coerce(f, v, where) {
  if (v === null || v === undefined) return '';
  if (f.type === 'number') {
    if (v === '') return '';
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    if (!Number.isFinite(n)) throw bad(`${where}${f.name} must be a number`);
    if (n < 0) throw bad(`${where}${f.name} cannot be negative`);
    if (Math.abs(n) > 1e12) throw bad(`${where}${f.name} is too large`);
    return n;
  }
  if (f.type === 'date') {
    if (v === '') return '';
    const d = normDate(v);
    if (!d || !isDate(d)) throw bad(`${where}${f.name} must be a valid date (yyyy-mm-dd)`);
    return d;
  }
  if (f.type === 'bool' || f.yesNo) {
    if (v === '') return '';
    if (v === true || /^(yes|true|1)$/i.test(String(v))) return 'Yes';
    if (v === false || /^(no|false|0)$/i.test(String(v))) return 'No';
    throw bad(`${where}${f.name} must be Yes or No`);
  }
  if (typeof v === 'object') throw bad(`${where}${f.name} has an invalid value`);
  const s = clean(v);
  const max = f.type === 'textarea' ? 5000 : 500;
  if (s.length > max) throw bad(`${where}${f.name} is too long (max ${max} characters)`);
  if (f.options && s) {
    const hit = f.options.find((o) => o.toLowerCase() === s.toLowerCase());
    if (!hit) throw bad(`${where}${f.name} must be one of: ${f.options.join(', ')}`);
    return hit;
  }
  return s;
}

async function refCheck(ctx, f, value, where) {
  if (isBlank(value) || !f.ref || ['item', 'company', 'bhead'].includes(f.ref.special)) return;
  const cache = (ctx.cache ||= new Map());
  const ck = f.ref.master ? `m:${f.ref.master}:${f.ref.col}` : `s:${f.ref.special}`;
  if (!cache.has(ck)) cache.set(ck, f.ref.master ? await masterValues(ctx.store, f.ref) : (await warehouseList(ctx.store)));
  const list = cache.get(ck);
  if (list.length && !list.some((x) => x.toLowerCase() === String(value).toLowerCase())) {
    throw bad(`${where}${f.name} "${value}" is not in ${f.ref.master ? TABLE_BY_SLUG[f.ref.master].tab : 'the warehouse list'}`);
  }
}

export async function validateHeader(ctx, table, input, { partial = false } = {}) {
  const out = {};
  const byName = Object.fromEntries(table.fields.map((f) => [f.name, f]));
  for (const k of Object.keys(input || {})) {
    if (k === 'Lines' || k === '__row') continue;
    if (!byName[k]) throw bad(`Unknown field "${k}"`);
  }
  for (const f of table.fields) {
    if (f.readonly || f.type === 'auto' || f.type === 'calc') { if (!isBlank(input?.[f.name]) && f.name !== table.idCol) throw bad(`${f.name} is calculated by the system`); continue; }
    if (!(f.name in (input || {}))) continue;
    const v = coerce(f, input[f.name], '');
    if (!isBlank(v) && !canWriteField(ctx, f.name)) throw forbidden(`You cannot enter ${f.name}`);
    if (!isBlank(v)) await refCheck(ctx, f, v, '');
    out[f.name] = v;
  }
  if (!partial) {
    for (const r of table.required) {
      const f = byName[r];
      if (f && !canWriteField(ctx, r)) continue;
      if (isBlank(out[r])) throw bad(`${r} is required`);
    }
  } else {
    for (const r of table.required) if (r in out && isBlank(out[r])) throw bad(`${r} is required`);
  }
  return out;
}

export async function validateLines(ctx, table, input, catalog, { strictItems }) {
  if (!table.hasLines) return [];
  if (!table.lineFields.length) return [];
  if (!Array.isArray(input) || !input.length) { if (table.itemField) throw bad('Add at least one line item'); return []; }
  if (input.length > MAX_LINES) throw bad(`Too many lines (max ${MAX_LINES})`);
  const byName = Object.fromEntries(table.lineFields.map((f) => [f.name, f]));
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const src = input[i] || {}; const w = `Line ${i + 1}: `; const l = {};
    for (const k of Object.keys(src)) if (!byName[k] && k !== '_name') throw bad(`${w}unknown field "${k}"`);
    for (const f of table.lineFields) {
      if (f.type === 'calc' && f.name !== 'Item Code') continue;
      if (f.name === 'Item Code' || !(f.name in src)) continue;
      const v = coerce(f, src[f.name], w);
      if (!isBlank(v) && !canWriteField(ctx, f.name)) throw forbidden(`${w}you cannot enter ${f.name}`);
      if (!isBlank(v) && f.ref?.special === 'warehouse') await refCheck(ctx, f, v, w);
      l[f.name] = v;
    }
    if (table.itemField) {
      const raw = sstr(src['Item Code']) || sstr(src[table.itemField]);
      if (!raw) throw bad(`${w}select an item`);
      let it = catalog.get(raw);
      if (!it) { const lower = raw.toLowerCase(); it = [...catalog.values()].find((x) => x.name.toLowerCase() === lower); }
      if (!it) {
        if (strictItems || catalog.size) throw unprocessable(`${w}item "${raw}" is not in the Item Master or stock`);
        l['Item Code'] = ''; l[table.itemField] = raw;
      } else { l['Item Code'] = it.code; l[table.itemField] = it.name; l._name = it.name; }
    }
    if ('Quantity' in l && table.post && table.post !== 'actual' && !(toNum(l.Quantity) > 0) && !(table.post === 'grn' && !isBlank(l['Accepted Qty']))) throw bad(`${w}Quantity must be greater than zero`);
    if ('Gross' in byName && !isBlank(l.Quantity) && !isBlank(l.Rate)) l.Gross = round2(toNum(l.Quantity) * toNum(l.Rate));
    out.push(l);
  }
  return out;
}

export const stripInternal = (lines) => lines.map(({ _name, ...rest }) => rest);

// ---- ids ---------------------------------------------------------------------------------------------------
export async function nextDocNo(store, table, date) {
  const { rows } = await store.read(table.tab, { fresh: true });
  const prefix = `${table.prefix}/${fyOf(date)}/`;
  let max = 0;
  for (const r of rows) { const id = sstr(r[table.idCol]); if (id.startsWith(prefix)) max = Math.max(max, parseInt(id.slice(prefix.length), 10) || 0); }
  return `${prefix}${String(max + 1).padStart(5, '0')}${table.suffix ? `/${table.suffix}` : ''}`;
}
export async function nextMasterId(store, table) {
  const abbr = table.tab.replace(/ Master$/i, '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 4) || 'M';
  const { rows } = await store.read(table.tab, { fresh: true });
  let max = 0;
  for (const r of rows) { const m = /-(\d+)$/.exec(sstr(r['Master Id'])); if (m) max = Math.max(max, Number(m[1])); }
  return `${abbr}-${String(max + 1).padStart(4, '0')}`;
}

// ---- list ---------------------------------------------------------------------------------------------------
const cmp = (a, b, type) => {
  if (type === 'number') return toNum(a) - toNum(b);
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
};
export function listColumns(ctx, table) {
  return table.fields.filter((f) => fieldAccess(ctx.user.role, f.name) !== 'n');
}

export async function listRecords(ctx, table, q = {}, opts = {}) {
  assertCan(ctx, table, 'view');
  const exporting = !!q.export || !!opts.all; // opts.all is server-side only (report engine); the query string cannot set it
  if (q.export) assertCan(ctx, table, 'export');
  const { rows } = await ctx.store.read(table.tab);
  const cols = listColumns(ctx, table);
  const fieldBy = Object.fromEntries(cols.map((f) => [f.name, f]));
  const needle = sstr(q.q).toLowerCase();
  const dateCol = table.fields.find((f) => f.name === 'Date' || f.name === 'Created_Date')?.name;
  const filters = Object.entries(q).filter(([k, v]) => k.startsWith('f.') && sstr(v)).map(([k, v]) => [k.slice(2), sstr(v)]);
  for (const [k] of filters) if (!fieldBy[k]) throw bad(`Cannot filter by "${k}"`);

  let list = [];
  for (const r of rows) {
    const lines = table.hasLines && table.lineFields.length ? parseLines(r.Lines) : null;
    if (!rowVisible(ctx, table, r, lines)) continue;
    if (dateCol && (q.from || q.to)) { const d = normDate(r[dateCol]); if ((q.from && d < q.from) || (q.to && d > q.to)) continue; }
    if (filters.some(([k, v]) => sstr(r[k]).toLowerCase() !== v.toLowerCase())) continue;
    if (needle) {
      let hay = cols.map((f) => sstr(r[f.name])).join(' ').toLowerCase();
      if (lines) hay += ' ' + lines.map((l) => Object.values(maskLines(ctx, [l])[0]).join(' ')).join(' ').toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    list.push({ r, lines });
  }
  const sortCol = fieldBy[q.sort] ? q.sort : table.sort?.col || (dateCol || (table.kind === 'master' ? table.headers[1] : null));
  const dir = (q.dir || table.sort?.dir || (dateCol ? 'desc' : 'asc')) === 'desc' ? -1 : 1;
  if (sortCol && fieldBy[sortCol]) {
    const type = fieldBy[sortCol].type;
    list.sort((a, b) => dir * cmp(a.r[sortCol], b.r[sortCol], type) || dir * (a.r.__row - b.r.__row));
  } else if (dir < 0) list.reverse();

  const total = list.length;
  const shape = ({ r, lines }) => {
    const o = maskRow(ctx, r);
    if (lines) o.__lines = lines.length;
    return o;
  };
  if (exporting) return { columns: cols, rows: list.slice(0, 50000).map(shape), total };
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 25));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  return { rows: list.slice((page - 1) * pageSize, page * pageSize).map(shape), total, page, pageSize, pages };
}

export async function findRow(ctx, table, id) {
  if (!table.idCol) throw bad('This table has no record id');
  const { rows } = await ctx.store.read(table.tab, { fresh: true });
  const row = rows.find((r) => sstr(r[table.idCol]) === sstr(id));
  if (!row) throw notFound('Record not found');
  return row;
}

export async function getRecord(ctx, table, id) {
  assertCan(ctx, table, 'view');
  const row = await findRow(ctx, table, id);
  const lines = parseLines(row.Lines);
  if (!rowVisible(ctx, table, row, lines)) throw notFound('Record not found'); // do not reveal records outside the user's warehouses
  return { record: maskRow(ctx, row), lines: maskLines(ctx, lines), editable: isEditable(ctx, table) };
}
export function isEditable(ctx, table) {
  if (table.post || table.kind === 'log' || table.kind === 'list' || table.kind === 'audit' || table.kind === 'stockdata') return false;
  try { assertCan(ctx, table, 'edit'); return true; } catch { return false; }
}

// ---- create ---------------------------------------------------------------------------------------------------
async function findIdem(ctx, table, key) {
  const { rows } = await ctx.store.read('Audit Logs', { fresh: true });
  for (let i = rows.length - 1, n = 0; i >= 0 && n < 400; i--, n++) {
    if (rows[i].Remarks === `idem:${key}` && rows[i].Module === table.tab && rows[i].Action === 'Create') return sstr(rows[i].Document_No);
  }
  return null;
}

export async function createRecord(ctx, table, body, idemKey, hooks = {}) {
  assertCan(ctx, table, 'create');
  if (table.workflow && table.workflow !== 'grn' && !hooks.internal) throw new HttpError(405, `${table.tab} is managed through the approval workflow (/api/wf)`);
  if (!['doc', 'master', 'log'].includes(table.kind)) throw new HttpError(405, `${table.tab} cannot be created from the app`);
  if (idemKey && !/^[A-Za-z0-9-]{8,64}$/.test(idemKey)) throw bad('Invalid idempotency key');
  const lockKey = table.post || table.kind === 'doc' ? 'stock' : `t:${table.tab}`;
  return withLock(lockKey, async () => {
    const { store } = ctx;
    if (idemKey) {
      const prevId = await findIdem(ctx, table, idemKey);
      if (prevId && table.idCol) return { id: prevId, ...(await getRecord(ctx, table, prevId)), duplicate: true };
      if (prevId) return { duplicate: true };
    }
    if (table.workflow === 'grn' && hooks.rawBody) body = await hooks.rawBody(body);
    const header = await validateHeader(ctx, table, body?.header ?? body ?? {});
    const date = header.Date || today();
    let id = null, lines = [], warnings = [], view = null;

    // master uniqueness
    if (table.kind === 'master') {
      const col = table.uniqueCol; const val = sstr(header[col]);
      if (val) {
        const { rows } = await store.read(table.tab, { fresh: true });
        if (rows.some((r) => sstr(r[col]).toLowerCase() === val.toLowerCase())) throw conflict(`${col} "${val}" already exists in ${table.tab}`);
      }
      id = await nextMasterId(store, table);
    }
    if (table.kind === 'doc') {
      const stock = table.itemField || table.post ? await loadStock(store, { fresh: true }) : null;
      const catalog = stock ? await itemCatalog(store, stock) : new Map();
      lines = await validateLines(ctx, table, body?.lines, catalog, { strictItems: !!table.post });
      id = await nextDocNo(store, table, date);
      assertWarehouses(ctx, writeWarehouses(table.post, header, lines));
      if (table.wh.length && ctx.user.scope.mode === 'assigned' && !table.post && !table.wh.some((c) => inScope(ctx, header[c]))) {
        throw forbidden('You can only create documents for your assigned warehouses');
      }
      if (table.post) {
        view = new StockView(stock.balances);
        const res = POSTERS[table.post]({ header, lines, view, doc: id, date });
        lines = res.lines; warnings = view.warnings;
      }
    }
    const row = { ...header };
    if (table.idCol) row[table.idCol] = id;
    if (table.hasLines) row.Lines = JSON.stringify(stripInternal(lines));
    if (table.kind === 'log' && table.hasLines && Array.isArray(body?.lines)) {
      const ls = await validateLines(ctx, { ...table, itemField: null }, body.lines, new Map(), { strictItems: false });
      row.Lines = JSON.stringify(ls);
    }

    await store.append(table.tab, [row]);
    if (view?.entries.length) {
      try {
        await store.append(TAB.ledger, view.ledgerRows(ctx.user.id));
        const neg = await findNegatives(store, view.touchedKeys());
        if (neg.length) throw conflict('Stock changed while saving (another user posted at the same time). Nothing was posted - please retry.');
      } catch (e) {
        // roll back: compensating ledger rows + remove the document row, so balances stay exact
        try {
          if (e instanceof HttpError && e.status === 409) {
            await store.append(TAB.ledger, view.entries.map((x) => ({ Date: x.date, Type: 'Reversal', Doc: x.doc, Warehouse: x.warehouse, 'Item Code': x.code, 'Item Name': x.name, 'Batch Number': x.batch, 'Expiry Date': x.expiry, Quantity: -x.qty, Rate: x.rate, User: ctx.user.id })));
          }
          const { rows } = await store.read(table.tab, { fresh: true });
          const mine = rows.find((r) => sstr(r[table.idCol]) === id);
          if (mine) await store.deleteRow(table.tab, mine.__row, { col: table.idCol, val: id });
        } catch { /* best effort */ }
        throw e;
      }
    }
    if (hooks.after) await hooks.after({ id, header, lines });
    await audit(store, { user: ctx.user, module: table.tab, doc: id || '', action: 'Create', next: { ...header, lines: lines.length, ledgerRows: view?.entries.length || 0 }, remarks: idemKey ? `idem:${idemKey}` : '' });
    return { id, record: maskRow(ctx, row), lines: maskLines(ctx, lines), warnings, posted: !!view?.entries.length };
  });
}

// ---- update / delete -------------------------------------------------------------------------------------------
export async function updateRecord(ctx, table, id, body) {
  assertCan(ctx, table, 'edit');
  if (table.post) throw conflict('Stock-posting documents cannot be edited because they have already moved stock. Create a correcting document instead.');
  if (table.workflow) throw new HttpError(405, `${table.tab} is managed through the approval workflow (/api/wf)`);
  if (!['doc', 'master'].includes(table.kind)) throw new HttpError(405, `${table.tab} cannot be edited from the app`);
  return withLock(`t:${table.tab}`, async () => {
    const row = await findRow(ctx, table, id);
    const curLines = parseLines(row.Lines);
    if (!rowVisible(ctx, table, row, curLines)) throw notFound('Record not found');
    if (body?.header && body.header[table.idCol] && sstr(body.header[table.idCol]) !== sstr(id)) throw bad('The id cannot be changed');
    const header = await validateHeader(ctx, table, body?.header ?? body ?? {}, { partial: true });
    delete header[table.idCol];
    if (table.kind === 'master' && table.uniqueCol in header) {
      const val = sstr(header[table.uniqueCol]);
      const { rows } = await ctx.store.read(table.tab, { fresh: true });
      if (val && rows.some((r) => r.__row !== row.__row && sstr(r[table.uniqueCol]).toLowerCase() === val.toLowerCase())) throw conflict(`${table.uniqueCol} "${val}" already exists`);
    }
    const patch = { ...header };
    let lines = null;
    if (table.hasLines && body?.lines) {
      const catalog = table.itemField ? await itemCatalog(ctx.store) : new Map();
      lines = await validateLines(ctx, table, body.lines, catalog, { strictItems: false });
      patch.Lines = JSON.stringify(stripInternal(lines));
    }
    if (table.wh.length && ctx.user.scope.mode === 'assigned') {
      const merged = { ...row, ...patch };
      if (!table.wh.some((c) => inScope(ctx, merged[c]))) throw forbidden('You can only keep documents within your assigned warehouses');
    }
    const prev = {}, next = {};
    for (const [k, v] of Object.entries(patch)) if (k !== 'Lines' && String(row[k] ?? '') !== String(v ?? '')) { prev[k] = row[k]; next[k] = v; }
    if (lines) { prev.lines = curLines.length; next.lines = lines.length; }
    await ctx.store.updateRow(table.tab, row.__row, patch, { col: table.idCol, val: id });
    await audit(ctx.store, { user: ctx.user, module: table.tab, doc: id, action: 'Update', prev, next });
    return { id, record: maskRow(ctx, { ...row, ...patch }), lines: lines ? maskLines(ctx, lines) : maskLines(ctx, curLines) };
  });
}

export async function deleteRecord(ctx, table, id) {
  assertCan(ctx, table, 'delete');
  if (table.kind !== 'master') throw new HttpError(405, 'Only master records can be deleted. Documents are kept for audit.');
  return withLock(`t:${table.tab}`, async () => {
    const row = await findRow(ctx, table, id);
    await ctx.store.deleteRow(table.tab, row.__row, { col: table.idCol, val: id });
    await audit(ctx.store, { user: ctx.user, module: table.tab, doc: id, action: 'Delete', prev: Object.fromEntries(Object.entries(row).filter(([k]) => k !== '__row')) });
    return { ok: true };
  });
}

// ---- settings (single-row tabs) ---------------------------------------------------------------------------------
export async function getSettingsRecord(ctx, table) {
  assertCan(ctx, table, 'view');
  const { rows } = await ctx.store.read(table.tab);
  const r = rows[0] || {};
  return { values: Object.fromEntries(table.fields.map((f) => [f.name, r[f.name] ?? ''])) };
}
export async function saveSettingsRecord(ctx, table, body) {
  assertCan(ctx, table, 'edit');
  return withLock(`t:${table.tab}`, async () => {
    const values = await validateHeader(ctx, table, body?.values ?? body ?? {}, { partial: true });
    const { rows } = await ctx.store.read(table.tab, { fresh: true });
    if (table.tab === 'Security') {
      const m = toNum(values['Minimum Password Length']); if ('Minimum Password Length' in values && (m < 8 || m > 64)) throw bad('Minimum Password Length must be between 8 and 64');
      const l = toNum(values['Lock After Failed Attempts']); if ('Lock After Failed Attempts' in values && (l < 3 || l > 20)) throw bad('Lock After Failed Attempts must be between 3 and 20');
    }
    if (table.tab === 'Configuration' && 'Session Timeout (min)' in values) {
      const m = toNum(values['Session Timeout (min)']); if (m < 5 || m > 1440) throw bad('Session Timeout must be between 5 and 1440 minutes');
    }
    const prev = rows[0] ? Object.fromEntries(Object.keys(values).map((k) => [k, rows[0][k]])) : {};
    if (rows[0]) await ctx.store.updateRow(table.tab, rows[0].__row, values); else await ctx.store.append(table.tab, [values]);
    await audit(ctx.store, { user: ctx.user, module: table.tab, action: 'Update', prev, next: values });
    return { values };
  });
}

// ---- lookups for dropdowns ---------------------------------------------------------------------------------------
export async function lookup(ctx, field, q, limit = 30, scopeOnly = false) {
  const ref = REFS[field];
  if (!ref) throw bad('Unknown lookup');
  if (fieldAccess(ctx.user.role, field) === 'n') throw forbidden();
  const needle = sstr(q).toLowerCase();
  if (ref.special === 'item') {
    const cat = await itemCatalog(ctx.store);
    const out = [];
    for (const it of cat.values()) { if (!needle || it.code.toLowerCase().includes(needle) || it.name.toLowerCase().includes(needle)) { out.push({ value: it.code, label: `${it.code} — ${it.name}`, name: it.name, unit: it.unit || '', brand: it.brand || '' }); if (out.length >= limit) break; } }
    return { options: out };
  }
  if (ref.special === 'warehouse') {
    let list = await warehouseList(ctx.store);
    if (scopeOnly) list = list.filter((w) => inScope(ctx, w)); // only the user's own / currently viewed warehouse(s)
    return { options: list.map((w) => ({ value: w, label: w, inScope: inScope(ctx, w) })) };
  }
  if (ref.special === 'company') {
    const cfg = (await ctx.store.read('Configuration')).rows[0] || {};
    const names = [...new Set([sstr(cfg['Company Name']), ...(await masterValues(ctx.store, { master: 'account-master', col: 'Name' }))].filter(Boolean))].sort();
    return { options: names.filter((v) => !needle || v.toLowerCase().includes(needle)).map((v) => ({ value: v, label: v })) };
  }
  if (ref.special === 'bhead') { // Sales Executive Master rows typed "Business Head"; if none are typed, every salesperson is offered
    const { rows } = await ctx.store.read('Sales Executive Master');
    const heads = rows.filter((r) => /business\s*head/i.test(sstr(r.Type)) && sstr(r['Salesperson Name']));
    const names = [...new Set((heads.length ? heads : rows).map((r) => sstr(r['Salesperson Name'])).filter(Boolean))].sort();
    return { options: names.filter((v) => !needle || v.toLowerCase().includes(needle)).map((v) => ({ value: v, label: v })) };
  }
  const vals = [...new Set(await masterValues(ctx.store, ref))].sort();
  return { options: vals.filter((v) => !needle || v.toLowerCase().includes(needle)).slice(0, 200).map((v) => ({ value: v, label: v })) };
}


// Details of a customer / hospital used to pre-fill the Imprest Out shipping block (name, address, city, state, pin, bill code).
export async function customerDetails(ctx, name) {
  if (fieldAccess(ctx.user.role, 'Customer Account') === 'n') throw forbidden();
  const { rows } = await ctx.store.read('Customer  Hospital Master');
  const key = sstr(name).toLowerCase();
  const r = rows.find((x) => sstr(x['Hospital Name']).toLowerCase() === key);
  if (!r) return { found: false };
  return { found: true, name: sstr(r['Hospital Name']), code: sstr(r.Code), address: sstr(r.Address), city: sstr(r.City), state: sstr(r.State), pincode: sstr(r.Pincode) };
}
