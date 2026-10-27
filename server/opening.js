// Opening Stock view (with "as on date" balances), CSV export and a validated Excel/CSV import.
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { HEADERS_BY_TAB } from '../shared/registry.js';
import { can, fieldAccess } from '../shared/permissions.js';
import { audit } from './audit.js';
import { inScope } from './access.js';
import { warehouseList } from './crud.js';
import { computeBalances, keyOf } from './stock.js';
import { HttpError, bad, forbidden, isBlank, normDate, round2, sstr, today, toNum, withLock } from './util.js';

const TAB = 'Opening Stock';
export const OPENING_HEADERS = HEADERS_BY_TAB[TAB];
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

function needView(ctx) {
  if (!can(ctx.user.role, 'reports', 'view')) throw forbidden('Your role cannot view stock');
  const miss = ['Item Code', 'Batch Number', 'Quantity'].filter((f) => fieldAccess(ctx.user.role, f) === 'n');
  if (miss.length) throw forbidden('Field-level restrictions hide stock quantities, items or batches from your role');
}

// ---- view ---------------------------------------------------------------------------------------------------------
export async function listOpening(ctx, q = {}) {
  needView(ctx);
  if (q.export && !can(ctx.user.role, 'reports', 'export')) throw forbidden();
  const asOn = normDate(q.asOn) || today();
  const [{ rows: opening }, { rows: ledger }] = await Promise.all([ctx.store.read(TAB), ctx.store.read('Stock Ledger')]);
  // movement posted after go-live, up to the chosen date
  const upTo = ledger.filter((r) => { const d = normDate(r.Date); return !d || d <= asOn; });
  const move = new Map();
  for (const e of computeBalances([], upTo).values()) move.set(e.key, e.qty);
  const t = today(); const needle = sstr(q.q).toLowerCase(); const lst = (v) => sstr(v).split('|').map((x) => x.trim()).filter(Boolean);   // multi-select filters arrive as a|b|c
  const whs = lst(q.warehouse).map((x) => x.toUpperCase());
  for (const w of whs) if (!inScope(ctx, w)) throw forbidden(`You are not assigned to warehouse ${w}`);
  const cats = lst(q.category).map((x) => x.toLowerCase()), brands = lst(q.brand).map((x) => x.toLowerCase()), stats = lst(q.expiryStatus).map((x) => x.toLowerCase());
  const lc = (v) => sstr(v).toLowerCase();
  let list = [];
  for (const r of opening) {
    if (isBlank(r.Warehouse) || isBlank(r['Item Code'])) continue;
    if (!inScope(ctx, r.Warehouse)) continue;
    if (whs.length && !whs.includes(sstr(r.Warehouse).toUpperCase())) continue;
    const exp = normDate(r['Expiry Date']);
    if (q.item && !`${r['Item Code']} ${r['Item Name']}`.toLowerCase().includes(lc(q.item))) continue;
    if (q.batch && !lc(r['Batch Number']).includes(lc(q.batch))) continue;
    if (cats.length && !cats.includes(lc(r['Item Category Type Name']))) continue;
    if (brands.length && !brands.includes(lc(r['Brand Name']))) continue;
    if (q.expiryFrom && (!exp || exp < q.expiryFrom)) continue;
    if (q.expiryTo && (!exp || exp > q.expiryTo)) continue;
    const days = exp ? daysBetween(t, exp) : null;
    const status = !exp ? 'No expiry' : days < 0 ? 'Expired' : days <= 90 ? 'Expiry soon' : 'Valid';
    if (stats.length && !stats.includes(status.toLowerCase())) continue;
    const qty = toNum(r.Quantity);
    if (q.negative && qty >= 0) continue;
    if (needle && !`${r.Warehouse} ${r['Item Code']} ${r['Item Name']} ${r['Batch Number']} ${r['Brand Name']} ${r['Item Category Type Name']}`.toLowerCase().includes(needle)) continue;
    const mv = move.get(keyOf(r.Warehouse, r['Item Code'], r['Batch Number'])) || 0;
    list.push({
      Warehouse: sstr(r.Warehouse), 'Item Code': sstr(r['Item Code']), 'Item Name': sstr(r['Item Name']), 'Item Category Type Name': sstr(r['Item Category Type Name']), 'Brand Name': sstr(r['Brand Name']),
      'Batch Number': sstr(r['Batch Number']), 'Expiry Date': exp, 'Expiry Status': status, 'Opening Qty': qty, 'Movement Since Opening': round2(mv), 'Qty As On Date': round2(qty + mv), 'Stock Value': toNum(r['Stock Value']),
    });
  }
  const sortCol = ['Warehouse', 'Item Code', 'Item Name', 'Batch Number', 'Expiry Date', 'Opening Qty', 'Qty As On Date', 'Stock Value', 'Expiry Status', 'Item Category Type Name', 'Brand Name'].includes(q.sort) ? q.sort : 'Item Code';
  const dir = q.dir === 'desc' ? -1 : 1;
  list.sort((a, b) => dir * (typeof a[sortCol] === 'number' ? a[sortCol] - b[sortCol] : String(a[sortCol]).localeCompare(String(b[sortCol]), undefined, { numeric: true })) || a.Warehouse.localeCompare(b.Warehouse) || a['Batch Number'].localeCompare(b['Batch Number']));
  const totals = { rows: list.length, openingQty: round2(list.reduce((s, r) => s + r['Opening Qty'], 0)), qtyAsOn: round2(list.reduce((s, r) => s + r['Qty As On Date'], 0)), value: round2(list.reduce((s, r) => s + r['Stock Value'], 0)) };
  const facets = {
    categories: [...new Set(opening.filter((r) => inScope(ctx, r.Warehouse)).map((r) => sstr(r['Item Category Type Name'])).filter(Boolean))].sort(),
    brands: [...new Set(opening.filter((r) => inScope(ctx, r.Warehouse)).map((r) => sstr(r['Brand Name'])).filter(Boolean))].sort(),
  };
  if (q.export) return { rows: list.slice(0, 50000), totals, total: list.length, asOn };
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 25));
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  return { rows: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize, pages, totals, asOn, facets, canImport: can(ctx.user.role, 'admin', 'create') && ctx.user.scope.mode !== 'all-readonly' };
}

// ---- import -------------------------------------------------------------------------------------------------------
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => sstr(x)));
}
const cellVal = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v && typeof v === 'object' ? (v.result ?? v.text ?? (Array.isArray(v.richText) ? v.richText.map((x) => x.text).join('') : '')) : v ?? '');

export async function readFile(name, b64, sheetName = TAB) {
  if (!b64 || typeof b64 !== 'string') throw bad('No file received');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw bad('The file is empty');
  if (buf.length > 3_000_000) throw new HttpError(413, 'File is larger than 3 MB. Split it into smaller files.');
  if (/\.csv$/i.test(name || '')) return parseCsv(buf.toString('utf8'));
  if (!/\.xlsx$/i.test(name || '')) throw bad('Upload an .xlsx or .csv file');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.read(Readable.from(buf)); } catch { throw bad('Could not read the Excel file. Save it as .xlsx and try again.'); }
  const ws = wb.getWorksheet(sheetName) || wb.worksheets[0];
  if (!ws) throw bad('The workbook has no sheets');
  const out = [];
  ws.eachRow({ includeEmpty: false }, (r) => out.push(r.values.slice(1).map(cellVal)));
  return out;
}

// Returns { rows, errors, warnings, counts } - nothing is written.
export async function checkImport(ctx, body) {
  const grid = await readFile(body?.filename, body?.content);
  if (grid.length < 2) throw bad('The file has no data rows');
  return validateGrid(ctx, grid, body?.mode === 'append' ? 'append' : 'replace');
}
async function validateGrid(ctx, grid, mode) {
  const head = grid[0].map((h) => sstr(h).toLowerCase());
  const idx = Object.fromEntries(OPENING_HEADERS.map((h) => [h, head.indexOf(h.toLowerCase())]));
  const missing = ['Warehouse', 'Item Code', 'Quantity'].filter((h) => idx[h] < 0);
  if (missing.length) throw bad(`Missing required column(s): ${missing.join(', ')}. Expected headers: ${OPENING_HEADERS.join(', ')}`);
  const whs = (await warehouseList(ctx.store)).map((w) => w.toUpperCase());
  const { rows: existing } = await ctx.store.read(TAB, { fresh: true });
  const have = new Set(existing.map((r) => keyOf(r.Warehouse, r['Item Code'], r['Batch Number'])));
  const errors = []; const warnings = []; const rows = []; const seen = new Map(); const t = today();
  const err = (n, m) => { if (errors.length < 5000) errors.push({ row: n, message: m }); else errors.overflow = true; };
  for (let i = 1; i < grid.length; i++) {
    const n = i + 1; const g = grid[i];
    const v = (h) => (idx[h] < 0 ? '' : g[idx[h]] ?? '');
    if (OPENING_HEADERS.every((h) => isBlank(v(h)))) continue;
    const o = Object.fromEntries(OPENING_HEADERS.map((h) => [h, typeof v(h) === 'string' ? v(h).trim() : v(h)]));
    o.Warehouse = sstr(o.Warehouse).toUpperCase(); o['Item Code'] = sstr(o['Item Code']); o['Batch Number'] = sstr(o['Batch Number']);
    if (!o.Warehouse) { err(n, 'Warehouse is blank'); continue; }
    if (!o['Item Code']) { err(n, 'Item Code is blank'); continue; }
    if (whs.length && !whs.includes(o.Warehouse)) err(n, `Warehouse "${o.Warehouse}" is not a known warehouse`);
    if (!inScope(ctx, o.Warehouse)) err(n, `You are not assigned to warehouse ${o.Warehouse}`);
    const qty = typeof o.Quantity === 'number' ? o.Quantity : Number(String(o.Quantity).replace(/,/g, ''));
    if (isBlank(o.Quantity) || !Number.isFinite(qty)) { err(n, `Quantity "${o.Quantity}" is not a number`); continue; }
    if (qty < 0) err(n, `Negative quantity ${qty} (${o['Item Code']} / ${o['Batch Number'] || 'no batch'})`);
    o.Quantity = qty;
    if (!isBlank(o['Expiry Date'])) { const d = normDate(o['Expiry Date']); if (!d) err(n, `Expiry Date "${o['Expiry Date']}" is not a valid date (use YYYY-MM-DD)`); else { o['Expiry Date'] = d; if (d < t && qty > 0) warnings.push({ row: n, message: `${o['Item Code']} / ${o['Batch Number']} is already expired (${d})` }); } } else { o['Expiry Date'] = ''; if (qty > 0) warnings.push({ row: n, message: `${o['Item Code']} / ${o['Batch Number'] || 'no batch'} has no expiry date` }); }
    if (isBlank(o['Stock Value'])) { o['Stock Value'] = ''; } else { const sv = typeof o['Stock Value'] === 'number' ? o['Stock Value'] : Number(String(o['Stock Value']).replace(/,/g, '')); if (!Number.isFinite(sv)) err(n, `Stock Value "${o['Stock Value']}" is not a number`); else o['Stock Value'] = sv; }
    const k = keyOf(o.Warehouse, o['Item Code'], o['Batch Number']);
    if (seen.has(k)) err(n, `Duplicate of row ${seen.get(k)} (${o.Warehouse} / ${o['Item Code']} / ${o['Batch Number'] || 'no batch'}). Merge duplicates before importing.`); else seen.set(k, n);
    if (mode === 'append' && have.has(k)) err(n, `${o.Warehouse} / ${o['Item Code']} / ${o['Batch Number'] || 'no batch'} already exists in Opening Stock`);
    rows.push(o);
  }
  if (!rows.length) throw bad('The file has no data rows');
  return { mode, rows, errors, warnings, counts: { rows: rows.length, errors: errors.length + (errors.overflow ? 1 : 0), warnings: warnings.length, quantity: round2(rows.reduce((s, r) => s + r.Quantity, 0)), value: round2(rows.reduce((s, r) => s + toNum(r['Stock Value']), 0)), existingRows: existing.length } };
}

export async function importOpening(ctx, body) {
  if (!can(ctx.user.role, 'admin', 'create') || ctx.user.scope.mode === 'all-readonly') throw forbidden('Only an Administrator can import opening stock');
  const r = await checkImport(ctx, body);
  const preview = { mode: r.mode, counts: r.counts, errors: r.errors, warnings: r.warnings.slice(0, 100), sample: r.rows.slice(0, 10) };
  if (!body?.confirm) return { ...preview, committed: false };
  if (r.counts.errors) throw new HttpError(422, `The file has ${r.counts.errors} error(s). Fix them and upload again.`, preview.errors.slice(0, 20));
  return withLock('stock', async () => {
    const ledger = await ctx.store.read('Stock Ledger', { fresh: true });
    if (r.mode === 'replace' && ledger.rows.length) throw new HttpError(409, `The Stock Ledger already has ${ledger.rows.length} posting(s); replacing opening stock would shift balances. Use "Add rows" instead.`);
    const before = r.counts.existingRows;
    if (r.mode === 'replace') await ctx.store.clearData(TAB);
    for (let i = 0; i < r.rows.length; i += 500) await ctx.store.append(TAB, r.rows.slice(i, i + 500));
    await audit(ctx.store, { user: ctx.user, module: TAB, action: r.mode === 'replace' ? 'Import (replace)' : 'Import (append)', prev: { rows: before }, next: { rows: r.rows.length, quantity: r.counts.quantity }, remarks: sstr(body?.filename).slice(0, 100) });
    return { ...preview, committed: true };
  });
}

// ---- add one row / edit one row --------------------------------------------------------------------------------------
const needAdmin = (ctx, action) => {
  if (!can(ctx.user.role, 'admin', action) || ctx.user.scope.mode === 'all-readonly') throw forbidden(`Only an Administrator can ${action} opening stock`);
};

export async function addOpeningRow(ctx, body) {
  needAdmin(ctx, 'create');
  const row = { ...(body?.row || {}) };
  const grid = [OPENING_HEADERS, OPENING_HEADERS.map((h) => row[h] ?? '')];
  const r = await validateGrid(ctx, grid, 'append');
  if (r.counts.errors) throw new HttpError(422, r.errors.map((e) => e.message).join('; '));
  return withLock('stock', async () => {
    const again = await validateGrid(ctx, grid, 'append'); // re-check against fresh data inside the lock
    if (again.counts.errors) throw new HttpError(422, again.errors.map((e) => e.message).join('; '));
    await ctx.store.append(TAB, again.rows);
    await audit(ctx.store, { user: ctx.user, module: TAB, action: 'Add row', next: again.rows[0] });
    return { added: again.rows[0], warnings: again.warnings };
  });
}

// Change the quantity (and optionally expiry / value) of ONE opening row, identified by warehouse + item + batch.
export async function editOpeningRow(ctx, body) {
  needAdmin(ctx, 'edit');
  const key = keyOf(body?.warehouse, body?.itemCode, body?.batch);
  const reason = sstr(body?.reason); if (!reason) throw bad('A reason is required to change opening stock');
  const qty = body?.quantity === '' || body?.quantity === undefined ? null : Number(body.quantity);
  if (qty !== null && (!Number.isFinite(qty) || qty < 0)) throw bad('Quantity must be zero or more');
  const exp = isBlank(body?.expiry) ? null : normDate(body.expiry); if (exp === '') throw bad('Expiry Date is not a valid date');
  const val = isBlank(body?.stockValue) ? null : Number(body.stockValue); if (val !== null && !Number.isFinite(val)) throw bad('Stock Value is not a number');
  return withLock('stock', async () => {
    const { rows } = await ctx.store.read(TAB, { fresh: true });
    const matches = rows.filter((r) => keyOf(r.Warehouse, r['Item Code'], r['Batch Number']) === key);
    if (!matches.length) throw new HttpError(404, 'Opening stock row not found');
    if (matches.length > 1) throw new HttpError(409, 'Several opening rows share this warehouse / item / batch. Merge them first (Data Quality page).');
    const row = matches[0];
    if (!inScope(ctx, row.Warehouse)) throw forbidden();
    const ledger = await ctx.store.read('Stock Ledger', { fresh: true });
    const moved = computeBalances([], ledger.rows).get(key)?.qty || 0;
    const newQty = qty === null ? toNum(row.Quantity) : qty;
    if (newQty + moved < -1e-9) throw new HttpError(422, `Not possible: ${moved} has already been posted against this batch, so opening quantity cannot be below ${Math.max(0, -moved)}`);
    const patch = { ...(qty !== null ? { Quantity: qty } : {}), ...(exp !== null ? { 'Expiry Date': exp } : {}), ...(val !== null ? { 'Stock Value': val } : {}) };
    if (!Object.keys(patch).length) throw bad('Nothing to change');
    await ctx.store.updateRow(TAB, row.__row, patch, { col: 'Item Code', val: row['Item Code'] });
    await audit(ctx.store, { user: ctx.user, module: TAB, action: 'Edit row', prev: { key, Quantity: row.Quantity, 'Expiry Date': row['Expiry Date'], 'Stock Value': row['Stock Value'] }, next: patch, remarks: reason });
    return { updated: { ...row, ...patch, __row: undefined } };
  });
}
