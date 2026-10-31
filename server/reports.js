// Stock views, dashboard and data-quality scan. Everything is computed on the server from the sheets.
import { ROLE_STAGE_ACTIONS, can, fieldAccess, groupAccess } from '../shared/permissions.js';
import { TABLES } from '../shared/registry.js';
import { inScope } from './access.js';
import { hospitalSet, itemCatalog } from './crud.js';
import { StockView, computeBalances, loadStock, locations, scanOpeningStock } from './stock.js';
import { reqCounts } from './requisition.js';
import { workflowCounts } from './workflow.js';
import { bad, forbidden, istParts, normDate, round2, sstr, today, toNum } from './util.js';

export const needReports = (ctx) => { if (!can(ctx.user.role, 'reports', 'view')) throw forbidden('Your role cannot view reports'); };
export const needStockFields = (ctx) => {
  const miss = ['Item Code', 'Batch Number', 'Quantity'].filter((f) => fieldAccess(ctx.user.role, f) === 'n');
  if (miss.length) throw forbidden('Field-level restrictions hide stock quantities, items or batches from your role');
};
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export function scopedBalances(ctx, balances, warehouse) {
  const w = sstr(warehouse).toUpperCase();
  if (w && !inScope(ctx, w)) throw forbidden(`You are not assigned to warehouse ${w}`);
  return [...balances.values()].filter((e) => inScope(ctx, e.warehouse) && (!w || e.warehouse === w));
}

export async function stockBalances(ctx, q = {}) {
  needReports(ctx); needStockFields(ctx);
  if (q.export && !can(ctx.user.role, 'reports', 'export')) throw forbidden();
  const { balances, opening } = await loadStock(ctx.store);
  const hosp = q.hospitals === '1' ? new Set() : await hospitalSet(ctx.store); // hospital (imprest) locations are not stock warehouses
  const open = q.master ? computeBalances(opening, []) : null; // Stock Master: opening and live quantity side by side
  const t = today(); const needle = sstr(q.q).toLowerCase();
  let rows = scopedBalances(ctx, balances, q.warehouse).filter((e) => !hosp.has(e.warehouse)).filter((e) => (q.showZero ? true : Math.abs(e.qty) > 1e-9 || (open && Math.abs(open.get(e.key)?.qty || 0) > 1e-9)));
  if (needle) rows = rows.filter((e) => `${e.itemCode} ${e.itemName} ${e.batch} ${e.brand}`.toLowerCase().includes(needle));
  const shaped = rows.map((e) => {
    const days = e.expiry ? daysBetween(t, e.expiry) : null;
    return { Warehouse: e.warehouse, 'Item Code': e.itemCode, 'Item Name': e.itemName, Category: e.category, Brand: e.brand, 'Batch Number': e.batch, 'Expiry Date': e.expiry, ...(open ? { 'Opening Qty': open.get(e.key)?.qty || 0 } : {}), Quantity: e.qty, 'Stock Value': e.value, Rate: e.qty > 0 ? round2(e.value / e.qty) : 0, 'Days To Expiry': days, Flag: e.qty < 0 ? 'Negative' : days !== null && days < 0 ? 'Expired' : days !== null && days <= 90 ? 'Expiring' : '' };
  }).filter((r) => (!q.flag || r.Flag.toLowerCase() === q.flag.toLowerCase()));
  const sortCol = ['Warehouse', 'Item Code', 'Item Name', 'Batch Number', 'Expiry Date', 'Quantity', 'Stock Value', 'Days To Expiry'].includes(q.sort) ? q.sort : 'Item Code';
  const dir = q.dir === 'desc' ? -1 : 1;
  shaped.sort((a, b) => dir * ((typeof a[sortCol] === 'number' || a[sortCol] === null) ? (a[sortCol] ?? 1e9) - (b[sortCol] ?? 1e9) : String(a[sortCol]).localeCompare(String(b[sortCol]), undefined, { numeric: true })) || a.Warehouse.localeCompare(b.Warehouse));
  const totals = { quantity: round2(shaped.reduce((s, r) => s + r.Quantity, 0)), value: round2(shaped.reduce((s, r) => s + r['Stock Value'], 0)) };
  if (q.export) return { rows: shaped, totals, total: shaped.length };
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 25));
  const pages = Math.max(1, Math.ceil(shaped.length / pageSize));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  return { rows: shaped.slice((page - 1) * pageSize, page * pageSize), total: shaped.length, page, pageSize, pages, totals };
}

// Live Stock Overview: one row per item, one column per warehouse the user may see.
// Quantity of selected items in selected warehouses, for the line pickers (e.g. a warehouse sees the Mother Warehouse stock when raising a requisition).
export async function stockLevels(ctx, q = {}) {
  if (!can(ctx.user.role, 'requisition', 'view') && !can(ctx.user.role, 'intent', 'view')) throw forbidden();
  if (fieldAccess(ctx.user.role, 'Quantity') === 'n') throw forbidden('Field-level restrictions hide quantities from your role');
  const codes = new Set(sstr(q.codes).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 200));
  const whs = new Set(sstr(q.warehouses).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 6));
  const { balances } = await loadStock(ctx.store); const levels = {};
  for (const c of codes) levels[c] = Object.fromEntries([...whs].map((w) => [w, 0]));
  for (const e of balances.values()) if (codes.has(e.itemCode) && whs.has(e.warehouse)) levels[e.itemCode][e.warehouse] = round2(levels[e.itemCode][e.warehouse] + e.qty);
  return { levels };
}

export async function stockSummary(ctx, q = {}) {
  needReports(ctx); needStockFields(ctx);
  const { balances } = await loadStock(ctx.store);
  const hosp = await hospitalSet(ctx.store);
  const items = new Map(); const whs = new Set();
  for (const e of scopedBalances(ctx, balances, q.warehouse).filter((x) => !hosp.has(x.warehouse))) {
    if (Math.abs(e.qty) < 1e-9) continue;
    whs.add(e.warehouse);
    const it = items.get(e.itemCode) || items.set(e.itemCode, { itemCode: e.itemCode, itemName: e.itemName, total: 0, value: 0, by: {} }).get(e.itemCode);
    it.by[e.warehouse] = round2((it.by[e.warehouse] || 0) + e.qty); it.total = round2(it.total + e.qty); it.value = round2(it.value + e.value);
  }
  const needle = sstr(q.q).toLowerCase();
  let rows = [...items.values()].filter((i) => !needle || `${i.itemCode} ${i.itemName}`.toLowerCase().includes(needle)).sort((a, b) => b.total - a.total);
  const total = rows.length;
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 20));
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  return { warehouses: [...whs].sort(), rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// FEFO-ordered batches of one item in one warehouse, for the line-item pickers in forms.
export async function stockBatches(ctx, q) {
  const creates = Object.values(ROLE_STAGE_ACTIONS[ctx.user.role] || {}).some((a) => a.includes('create'));
  if (!creates) throw forbidden();
  needStockFields(ctx);
  const wh = sstr(q.warehouse), code = sstr(q.code);
  if (q.all === '1') { // every batch of the item known to the system (Opening Stock + ledger, all warehouses) - used by Imprest In
    if (!code) throw bad('code is required');
    const { balances } = await loadStock(ctx.store);
    const byBatch = new Map();
    for (const e of balances.values()) {
      if (e.itemCode !== code || !sstr(e.batch)) continue;
      const b = byBatch.get(e.batch) || { batch: e.batch, expiry: '', qty: 0, value: 0 };
      b.qty += e.qty; b.value += e.value; if (e.expiry && (!b.expiry || e.expiry < b.expiry)) b.expiry = e.expiry; byBatch.set(e.batch, b);
    }
    return { batches: [...byBatch.values()].sort((a, b) => String(a.expiry || '9').localeCompare(String(b.expiry || '9'))).map((b) => ({ batch: b.batch, expiry: b.expiry, qty: Math.round(b.qty * 1e6) / 1e6, rate: b.qty > 0 ? Math.round((b.value / b.qty) * 100) / 100 : 0, expired: !!(b.expiry && b.expiry < today()) })) };
  }
  if (!wh || !code) throw bad('warehouse and code are required');
  if (!inScope(ctx, wh) && !q.any) throw forbidden(`You are not assigned to warehouse ${wh}`);
  const { balances } = await loadStock(ctx.store);
  const view = new StockView(balances);
  return { batches: view.batches(wh, code).map((b) => ({ ...b, expired: !!(b.expiry && b.expiry < today()) })) };
}

export async function dataQuality(ctx) {
  if (!can(ctx.user.role, 'admin', 'view')) throw forbidden();
  const { opening, balances } = await loadStock(ctx.store);
  const s = scanOpeningStock(opening);
  const negBal = [...balances.values()].filter((e) => e.qty < -1e-9).map((e) => ({ warehouse: e.warehouse, itemCode: e.itemCode, itemName: e.itemName, batch: e.batch, qty: e.qty }));
  const cut = (a) => ({ count: a.length, sample: a.slice(0, 200) });
  return { openingRows: opening.length, negative: cut(s.negative), blankValue: cut(s.blankValue), blankExpiry: cut(s.blankExpiry), blankBatch: cut(s.blankBatch), duplicates: cut(s.duplicates), negativeBalances: cut(negBal) };
}

const DOC_STAGE_TABLES = TABLES.filter((t) => t.kind === 'doc' && ['po', 'grn', 'transfer', 'imprest', 'consumption'].includes(t.stage) || t.slug === 'purchase-indent');

export async function dashboard(ctx, q = {}) {
  needReports(ctx);
  const to = normDate(q.to) || today();
  const from = normDate(q.from) || addDays(to, -89);
  if (from > to) throw bad('From date is after To date');
  const wf = sstr(q.warehouse).toUpperCase();
  if (wf && !inScope(ctx, wf)) throw forbidden(`You are not assigned to warehouse ${wf}`);
  const qtyOk = groupAccess(ctx.user.role, 'quantity') !== 'n', itemOk = groupAccess(ctx.user.role, 'item') !== 'n';
  const { balances, ledger } = await loadStock(ctx.store);
  const rows = scopedBalances(ctx, balances, wf);
  const t = today();
  const live = rows.filter((e) => Math.abs(e.qty) > 1e-9);
  const out = { range: { from, to }, warehouse: wf || null, generated: istParts() };

  const byWh = new Map();
  for (const e of live) { const o = byWh.get(e.warehouse) || byWh.set(e.warehouse, { warehouse: e.warehouse, value: 0, qty: 0, batches: 0 }).get(e.warehouse); o.value = round2(o.value + e.value); o.qty = round2(o.qty + e.qty); o.batches++; }
  out.kpis = { stockValue: round2(live.reduce((s, e) => s + e.value, 0)), batchesInStock: live.filter((e) => e.qty > 0).length };
  if (qtyOk) out.kpis.totalQuantity = round2(live.reduce((s, e) => s + e.qty, 0));
  if (itemOk) out.kpis.distinctItems = new Set(live.filter((e) => e.qty > 0).map((e) => e.itemCode)).size;
  out.byWarehouse = [...byWh.values()].map((w) => (qtyOk ? w : { warehouse: w.warehouse, value: w.value, batches: w.batches })).sort((a, b) => b.value - a.value);

  const expiring = live.filter((e) => e.qty > 0 && e.expiry && e.expiry >= t && e.expiry <= addDays(t, 90));
  const expired = live.filter((e) => e.qty > 0 && e.expiry && e.expiry < t);
  out.kpis.expiring90 = { batches: expiring.length, value: round2(expiring.reduce((s, e) => s + e.value, 0)) };
  out.kpis.expired = { batches: expired.length, value: round2(expired.reduce((s, e) => s + e.value, 0)) };
  out.kpis.negativeBatches = live.filter((e) => e.qty < 0).length;
  if (itemOk && qtyOk) {
    out.expiringSoon = expiring.sort((a, b) => a.expiry.localeCompare(b.expiry)).slice(0, 10).map((e) => ({ warehouse: e.warehouse, itemCode: e.itemCode, itemName: e.itemName, batch: e.batch, expiry: e.expiry, qty: e.qty }));
    const im = await itemCatalog(ctx.store); const mins = (await ctx.store.read('Item Master')).rows.filter((r) => toNum(r['Min Stock Level']) > 0);
    const tot = new Map(); for (const e of live) tot.set(e.itemCode, (tot.get(e.itemCode) || 0) + e.qty);
    out.belowMinimum = mins.map((r) => ({ itemCode: sstr(r.Code), itemName: sstr(r['Item Name']), min: toNum(r['Min Stock Level']), qty: tot.get(sstr(r.Code)) || 0 })).filter((x) => x.qty < x.min).slice(0, 10);
    void im;
    const byItem = new Map(); for (const e of live) { const o = byItem.get(e.itemCode) || byItem.set(e.itemCode, { itemCode: e.itemCode, itemName: e.itemName, value: 0, qty: 0 }).get(e.itemCode); o.value += e.value; o.qty += e.qty; }
    out.topItems = [...byItem.values()].sort((a, b) => b.value - a.value).slice(0, 10).map((x) => ({ ...x, value: round2(x.value), qty: round2(x.qty) }));
  }

  // movements in the selected period (ledger), month by month
  const mv = new Map(); const types = new Map();
  for (const r of ledger) {
    const d = normDate(r.Date); if (!d || d < from || d > to) continue;
    if (!inScope(ctx, r.Warehouse) || (wf && sstr(r.Warehouse).toUpperCase() !== wf)) continue;
    const month = d.slice(0, 7); const q2 = toNum(r.Quantity);
    const m = mv.get(month) || mv.set(month, { month, inward: 0, outward: 0 }).get(month);
    if (q2 > 0) m.inward += q2; else m.outward += -q2;
    types.set(sstr(r.Type), (types.get(sstr(r.Type)) || 0) + 1);
  }
  if (qtyOk) out.movements = [...mv.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, inward: round2(m.inward), outward: round2(m.outward) }));
  out.movementTypes = [...types.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);

  // document counts for the stages this user may view
  const docs = [];
  for (const tb of DOC_STAGE_TABLES) {
    if (!can(ctx.user.role, tb.stage, 'view')) continue;
    const { rows: dr } = await ctx.store.read(tb.tab);
    let n = 0;
    for (const r of dr) { const d = normDate(r.Date); if (d && d >= from && d <= to && (ctx.user.scope.mode !== 'assigned' || !tb.wh.length || tb.wh.some((c) => inScope(ctx, r[c]))) && (!wf || !tb.wh.length || tb.wh.some((c) => sstr(r[c]).toUpperCase() === wf))) n++; }
    docs.push({ table: tb.tab, slug: tb.slug, count: n });
  }
  out.documents = docs;
  out.workflow = await workflowCounts(ctx, { from, to, warehouse: wf });
  const rc = await reqCounts(ctx, { from, to, warehouse: wf }); if (rc) out.workflow.requisitions = rc;

  // ---- summary cards (always computed from live data) ----
  const loc = await locations(ctx);
  const kind = (w) => loc.classify(w);
  const phys = live.filter((e) => kind(e.warehouse) === 'Warehouse');
  const cards = { currentStock: { qty: round2(phys.reduce((a, e) => a + e.qty, 0)), value: round2(phys.reduce((a, e) => a + e.value, 0)) } };
  const opening = (await ctx.store.read('Opening Stock')).rows.filter((r) => inScope(ctx, r.Warehouse) && (!wf || sstr(r.Warehouse).toUpperCase() === wf));
  cards.openingStock = { qty: round2(opening.reduce((a, r) => a + toNum(r.Quantity), 0)), rows: opening.length };
  const imCount = (await ctx.store.read('Item Master')).rows.filter((r) => sstr(r.Code)).length;
  cards.totalItems = Math.max(imCount, new Set(live.map((e) => e.itemCode)).size);
  const pw = new Map(); for (const e of phys) { const o = pw.get(e.warehouse) || pw.set(e.warehouse, { warehouse: e.warehouse, qty: 0, value: 0 }).get(e.warehouse); o.qty = round2(o.qty + e.qty); o.value = round2(o.value + e.value); }
  cards.warehouses = [...pw.values()].sort((a, b) => a.warehouse.localeCompare(b.warehouse));
  const vt = live.filter((e) => kind(e.warehouse) === 'Hospital / virtual'); const tr = live.filter((e) => kind(e.warehouse) === 'In transit');
  cards.virtualStock = { qty: round2(vt.reduce((a, e) => a + e.qty, 0)), locations: new Set(vt.map((e) => e.warehouse)).size };
  cards.inTransit = { qty: round2(tr.reduce((a, e) => a + e.qty, 0)) };
  let cons = 0; for (const r of ledger) { const d = normDate(r.Date); if (sstr(r.Type) === 'Consumption' && d && d >= from && d <= to && inScope(ctx, r.Warehouse) && (!wf || sstr(r.Warehouse).toUpperCase() === wf)) cons += -toNum(r.Quantity); }
  cards.consumption = { qty: round2(cons) };
  if (qtyOk) {
    const mins = new Map((await ctx.store.read('Item Master')).rows.filter((r) => toNum(r['Min Stock Level']) > 0).map((r) => [sstr(r.Code), toNum(r['Min Stock Level'])]));
    const per = new Map(); for (const e of phys) per.set(`${e.warehouse}|${e.itemCode}`, (per.get(`${e.warehouse}|${e.itemCode}`) || 0) + e.qty);
    cards.lowStockItems = [...per.entries()].filter(([k, v]) => { const m = mins.get(k.split('|')[1]); return m && v < m; }).length;
  }
  out.cards = cards;
  // recent transactions + inward / outward by warehouse (period)
  out.recent = ledger.filter((r) => inScope(ctx, r.Warehouse) && (!wf || sstr(r.Warehouse).toUpperCase() === wf)).slice(-10).reverse().map((r) => ({ date: normDate(r.Date), type: sstr(r.Type), doc: sstr(r.Doc), warehouse: sstr(r.Warehouse), itemCode: sstr(r['Item Code']), itemName: sstr(r['Item Name']), qty: toNum(r.Quantity) }));
  const bw = new Map();
  for (const r of ledger) {
    const d = normDate(r.Date); if (!d || d < from || d > to || !inScope(ctx, r.Warehouse) || (wf && sstr(r.Warehouse).toUpperCase() !== wf)) continue;
    if (kind(r.Warehouse) !== 'Warehouse') continue;
    const o = bw.get(sstr(r.Warehouse)) || bw.set(sstr(r.Warehouse), { warehouse: sstr(r.Warehouse), inward: 0, outward: 0 }).get(sstr(r.Warehouse)); const v = toNum(r.Quantity); if (v > 0) o.inward += v; else o.outward += -v;
  }
  if (qtyOk) out.movementByWarehouse = [...bw.values()].map((o) => ({ ...o, inward: round2(o.inward), outward: round2(o.outward) }));
  return out;
}
