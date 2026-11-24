// Reporting section. Each report is computed from the live documents / stock ledger on every request (no stored totals),
// then filtered, sorted, paginated or exported (CSV / Excel) by one generic wrapper.
import { TABLE_BY_SLUG } from '../shared/registry.js';
import { can, fieldAccess } from '../shared/permissions.js';
import { inScope, parseLines } from './access.js';
import { listRecords } from './crud.js';
import { needStockFields, scopedBalances, daysBetween, virtualWarehouses } from './reports.js';
import { isTransitLoc, loadStock, locations } from './stock.js';
import { listReqs } from './requisition.js';
import { listIntents, listPos } from './workflow.js';
import { listOpening } from './opening.js';
import { forbidden, normDate, notFound, round2, sstr, today, toNum } from './util.js';

const stripActions = (rows) => rows.map(({ actions, ...r }) => r);
const colsOf = (rows, fallback) => (rows.length ? Object.keys(rows[0]) : fallback);
const tableReport = (slug, extra = {}) => async (ctx, q) => {
  const t = TABLE_BY_SLUG[slug]; const r = await listRecords(ctx, t, { sort: q.sort, dir: q.dir }, { all: true });
  const cols = r.columns.map((c) => c.name);
  const rows = r.rows.map((row) => { const o = Object.fromEntries(cols.map((c) => [c, row[c]])); o.Lines = row.__lines ?? ''; return o; });
  return { columns: [...cols, 'Lines'], rows };
};

const ledgerCols = ['Date', 'Type', 'Doc', 'Warehouse', 'Item Code', 'Item Name', 'Batch Number', 'Expiry Date', 'Quantity', 'Rate', 'User'];
const stockCols = ['Warehouse', 'Item Code', 'Item Name', 'Category', 'Brand', 'Batch Number', 'Expiry Date', 'Quantity', 'Rate', 'Stock Value', 'Days To Expiry', 'Flag'];

function batchRows(ctx, balances, filterFn) {
  const t = today();
  return scopedBalances(ctx, balances, '').filter((e) => Math.abs(e.qty) > 1e-9 && filterFn(e)).map((e) => {
    const days = e.expiry ? daysBetween(t, e.expiry) : null;
    return { Warehouse: e.warehouse, 'Item Code': e.itemCode, 'Item Name': e.itemName, Category: e.category, Brand: e.brand, 'Batch Number': e.batch, 'Expiry Date': e.expiry, Quantity: e.qty, Rate: e.qty > 0 ? round2(e.value / e.qty) : 0, 'Stock Value': e.value, 'Days To Expiry': days, Flag: e.qty < 0 ? 'Negative' : days !== null && days < 0 ? 'Expired' : days !== null && days <= 90 ? 'Expiring' : '' };
  });
}

const stage = (st, a = 'view') => (ctx) => can(ctx.user.role, st, a);
const stockOk = (ctx) => can(ctx.user.role, 'reports', 'view') && !['Item Code', 'Batch Number', 'Quantity'].some((f) => fieldAccess(ctx.user.role, f) === 'n');

export const REPORTS = [
  // ---- stock ----
  { key: 'opening-stock-register', group: 'Stock', title: 'Opening Stock Register', stage: 'reports', ok: stockOk, dateCol: null, statusCol: 'Expiry Status', columns: ['Warehouse', 'Item Code', 'Item Name', 'Item Category Type Name', 'Brand Name', 'Batch Number', 'Expiry Date', 'Expiry Status', 'Opening Qty', 'Movement Since Opening', 'Qty As On Date', 'Stock Value'],
    run: async (ctx, q) => ({ rows: await opAll(ctx, q) }) },
  { key: 'item-master-register', group: 'Stock', title: 'Item Master Register', stage: 'reports', ok: stage('reports'), columns: ['Code', 'Item Name', 'Brand', 'Item Category', 'Min Stock Level', 'MOQ', 'Preferred Vendor', 'Batch Number', 'Expiry Date', 'Total Stock'],
    run: async (ctx) => {
      const im = await ctx.store.read('Item Master'); const { balances } = await loadStock(ctx.store); const tot = new Map();
      for (const e of scopedBalances(ctx, balances, '')) if (!isTransitLoc(e.warehouse)) tot.set(e.itemCode, (tot.get(e.itemCode) || 0) + e.qty);
      return { rows: im.rows.map((r) => ({ Code: sstr(r.Code), 'Item Name': sstr(r['Item Name']), Brand: sstr(r.Brand), 'Item Category': sstr(r['Item Category']), 'Min Stock Level': toNum(r['Min Stock Level']), MOQ: toNum(r.MOQ), 'Batch Number': sstr(r['Batch Number']), 'Expiry Date': sstr(r['Expiry Date']), 'Preferred Vendor': sstr(r['Preferred Vendor']), 'Total Stock': round2(tot.get(sstr(r.Code)) || 0) })) };
    } },
  { key: 'item-wise-stock', group: 'Stock', title: 'Item-wise Stock Report', stage: 'reports', ok: stockOk, columns: ['Item Code', 'Item Name', 'Category', 'Total Qty', 'Stock Value'],
    run: async (ctx) => {
      needStockFields(ctx); const { balances } = await loadStock(ctx.store); const { classify } = await locations(ctx); const m = new Map(); const whs = new Set();
      for (const e of scopedBalances(ctx, balances, '')) {
        if (Math.abs(e.qty) < 1e-9 || classify(e.warehouse) !== 'Warehouse') continue; whs.add(e.warehouse);
        const o = m.get(e.itemCode) || m.set(e.itemCode, { 'Item Code': e.itemCode, 'Item Name': e.itemName, Category: e.category, 'Total Qty': 0, 'Stock Value': 0 }).get(e.itemCode);
        o[e.warehouse] = round2((o[e.warehouse] || 0) + e.qty); o['Total Qty'] = round2(o['Total Qty'] + e.qty); o['Stock Value'] = round2(o['Stock Value'] + e.value);
      }
      const w = [...whs].sort();
      return { columns: ['Item Code', 'Item Name', 'Category', ...w, 'Total Qty', 'Stock Value'], rows: [...m.values()].map((o) => { for (const x of w) o[x] ??= 0; return o; }) };
    } },
  { key: 'warehouse-stock', group: 'Stock', title: 'Warehouse-wise Live Stock (batch level)', stage: 'reports', ok: stockOk, columns: stockCols, dateCol: 'Expiry Date', statusCol: 'Flag',
    run: async (ctx) => { needStockFields(ctx); const { balances } = await loadStock(ctx.store); const { classify } = await locations(ctx); return { rows: batchRows(ctx, balances, (e) => classify(e.warehouse) === 'Warehouse') }; } },
  { key: 'expiry-report', group: 'Stock', title: 'Expiry Report', stage: 'reports', ok: stockOk, columns: ['Warehouse', 'Item Code', 'Item Name', 'Category', 'Brand', 'Batch Number', 'Expiry Date', 'Days To Expiry', 'Expiry Tag', 'Quantity', 'Rate', 'Stock Value'], dateCol: 'Expiry Date', dateAsc: true, statusCol: 'Expiry Tag', statusLabel: 'Tag', withinDefault: 365, summary: { itemCol: 'Item Code', qtyCol: 'Quantity', valueCol: 'Stock Value' },
    run: async (ctx, q = {}) => {
      needStockFields(ctx); const { balances } = await loadStock(ctx.store);
      const tag = (d) => (d === null ? 'No expiry' : d < 0 ? 'Expired' : d <= 30 ? '0-30 days' : d <= 60 ? '31-60 days' : d <= 90 ? '61-90 days' : d <= 365 ? '91-365 days' : 'Over 365 days');
      // Default view: everything already expired plus everything expiring from today up to 365 days ahead. within=all shows every batch.
      const within = q.within === 'all' ? null : Number.isFinite(parseInt(q.within, 10)) ? parseInt(q.within, 10) : 365;
      const rows = batchRows(ctx, balances, (e) => e.qty > 0).map(({ Flag, ...r }) => ({ ...r, 'Expiry Tag': tag(r['Days To Expiry']) })).filter((r) => within === null || (r['Days To Expiry'] !== null && r['Days To Expiry'] <= within));
      rows.sort((a, b) => (a['Days To Expiry'] ?? 1e9) - (b['Days To Expiry'] ?? 1e9)); // earliest expiry first
      return { rows };
    } },
  // One item (or batch) followed through its whole life: indent -> PO -> GRN -> transfers -> Imprest Out -> Imprest In -> Consumption.
  { key: 'item-timeline', group: 'Stock', title: 'Item Timeline (Indent → PO → GRN → Imprest → Consumption)', stage: 'reports', ok: stockOk, dateCol: 'Date', dateAsc: true, statusCol: 'Event', groupBy: 'Item Code',
    columns: ['Date', 'Event', 'Document', 'Item Code', 'Item Name', 'Batch Number', 'Expiry Date', 'Warehouse', 'Quantity', 'Party', 'Reference'],
    run: async (ctx) => {
      needStockFields(ctx);
      const { store } = ctx; const rd = async (tab) => (await store.read(tab)).rows;
      const [led, grns, outs, ins, cons, xfers] = await Promise.all([rd('Stock Ledger'), rd('GRN  MRN'), rd('Imprest Out — New'), rd('Imprest In — New'), rd('Material Consumption'), rd('Stock Transfer')]);
      const hosp = ctx.user.scope.mode === 'assigned' ? await (await import('./imprest.js')).visibleHospitals(ctx) : null;
      const seen = (w) => (isTransitLoc(w) ? ctx.user.scope.mode !== 'assigned' : inScope(ctx, w) || !!hosp?.has(sstr(w)));
      const rows = []; const nameOf = new Map();
      const push = (o) => rows.push({ Date: normDate(o.Date) || '', Event: o.Event, Document: o.Document, 'Item Code': sstr(o.code), 'Item Name': sstr(o.name) || nameOf.get(sstr(o.code)) || '', 'Batch Number': sstr(o.batch), 'Expiry Date': normDate(o.expiry) || '', Warehouse: sstr(o.wh), Quantity: toNum(o.qty), Party: sstr(o.party), Reference: sstr(o.ref) });
      for (const r of led) { if (sstr(r['Item Code'])) nameOf.set(sstr(r['Item Code']), sstr(r['Item Name'])); }
      if (can(ctx.user.role, 'intent', 'view')) for (const d of await rd('Purchase Indent')) for (const l of parseLines(d.Lines)) { const c = sstr(l['Item Code']); if (c) push({ Date: d.Date, Event: 'Purchase Indent', Document: sstr(d['Document No.']), code: c, name: l.Items, qty: l.Quantity, wh: d['Requesting Warehouse'], party: d.Status }); }
      if (can(ctx.user.role, 'po', 'view')) for (const tab of ['Purchase Order — Domestic', 'Purchase Order — Import']) for (const d of await rd(tab)) for (const l of parseLines(d.Lines)) { const c = sstr(l['Item Code']); if (c) push({ Date: d.Date, Event: 'Purchase Order', Document: sstr(d['Document No.']), code: c, name: l.Items, qty: l.Quantity, wh: d.Destination || d.Location, party: d['Vendor Account'], ref: l['Intent No'] }); }
      const grnBy = new Map(grns.map((g) => [sstr(g['Document No.']), g])); const outBy = new Map(outs.map((g) => [sstr(g.DocNo), g]));
      const inBy = new Map(ins.map((g) => [sstr(g.DocNo), g])); const consBy = new Map(cons.map((g) => [sstr(g['Document No']), g])); const xBy = new Map(xfers.map((g) => [sstr(g['Document No.']), g]));
      for (const r of led.filter((x) => seen(x.Warehouse))) {
        const doc = sstr(r.Doc); const t = sstr(r.Type); const code = sstr(r['Item Code']); const batch = sstr(r['Batch Number']);
        let party = '', ref = '';
        if (t === 'GRN') { const g = grnBy.get(doc); party = sstr(g?.['Vendor Account']); ref = sstr(parseLines(g?.Lines).find((l) => sstr(l['Item Code']) === code && sstr(l.Batch) === batch)?.['PO No'] || g?.['Supplier Ref No']); }
        else if (/^Imprest Out/.test(t)) { const g = outBy.get(doc); party = sstr(g?.['Customer Account']); ref = [g?.Surgery, g?.Doctor].map(sstr).filter(Boolean).join(' / '); }
        else if (t === 'Imprest In') { const g = inBy.get(doc); party = sstr(g?.['To Warehouse']); ref = sstr(g?.['Imprest Ref']); }
        else if (t === 'Consumption') { const g = consBy.get(doc); party = sstr(g?.['Customer Account'] || g?.Warehouse); ref = sstr(g?.['Imprest Ref']); }
        else if (t === 'Stock Transfer') { const g = xBy.get(doc); party = `${sstr(g?.['From Warehouse'])} → ${sstr(g?.['To Warehouse'])}`; }
        push({ Date: r.Date, Event: t, Document: doc, code, name: r['Item Name'], batch, expiry: r['Expiry Date'], wh: r.Warehouse, qty: r.Quantity, party, ref });
      }
      return { rows: rows.filter((r) => r['Item Code']) };
    } },
  // Value of the stock sent to each hospital / virtual warehouse, date-wise: + sent (Imprest Out), - taken back (Imprest In) or consumed.
  { key: 'hospital-stock-valuation', group: 'Stock', title: 'Hospital / Virtual Warehouse Stock Valuation (date-wise)', stage: 'reports', ok: stockOk, dateCol: 'Date', dateAsc: true, statusCol: 'Event',
    columns: ['Date', 'Virtual Warehouse', 'Event', 'Document', 'Item Code', 'Item Name', 'Batch Number', 'Expiry Date', 'Quantity', 'Rate', 'Value'],
    run: async (ctx) => {
      needStockFields(ctx);
      const virt = await virtualWarehouses(ctx); const upper = new Map([...virt].map((v) => [sstr(v).toUpperCase(), v]));
      const { rows } = await ctx.store.read('Stock Ledger');
      return { rows: rows.filter((r) => upper.has(sstr(r.Warehouse).toUpperCase())).map((r) => ({ Date: normDate(r.Date) || '', 'Virtual Warehouse': upper.get(sstr(r.Warehouse).toUpperCase()), Event: sstr(r.Type), Document: sstr(r.Doc), 'Item Code': sstr(r['Item Code']), 'Item Name': sstr(r['Item Name']), 'Batch Number': sstr(r['Batch Number']), 'Expiry Date': normDate(r['Expiry Date']) || '', Quantity: toNum(r.Quantity), Rate: toNum(r.Rate), Value: round2(toNum(r.Quantity) * toNum(r.Rate)) })) };
    } },
  { key: 'virtual-stock', group: 'Stock', title: 'Virtual Warehouse / Hospital Stock (incl. in transit)', stage: 'reports', ok: stockOk, columns: ['Location', 'Location Type', ...stockCols.slice(1)], dateCol: 'Expiry Date', statusCol: 'Flag',
    run: async (ctx) => {
      needStockFields(ctx); const { balances } = await loadStock(ctx.store); const { classify } = await locations(ctx);
      const rows = []; const t = today();
      for (const e of balances.values()) {
        if (Math.abs(e.qty) < 1e-9 || classify(e.warehouse) === 'Warehouse') continue;
        if (isTransitLoc(e.warehouse) ? ctx.user.scope.mode === 'assigned' : !inScope(ctx, e.warehouse)) continue; // in-transit stock: broad-scope roles only
        const days = e.expiry ? daysBetween(t, e.expiry) : null;
        rows.push({ Location: e.warehouse, 'Location Type': classify(e.warehouse), 'Item Code': e.itemCode, 'Item Name': e.itemName, Category: e.category, Brand: e.brand, 'Batch Number': e.batch, 'Expiry Date': e.expiry, Quantity: e.qty, Rate: e.qty > 0 ? round2(e.value / e.qty) : 0, 'Stock Value': e.value, 'Days To Expiry': days, Flag: days !== null && days < 0 ? 'Expired' : days !== null && days <= 90 ? 'Expiring' : '' });
      }
      return { rows };
    } },
  { key: 'low-stock', group: 'Stock', title: 'Low-Stock Report (replenishment)', stage: 'reports', ok: stockOk, columns: ['Warehouse', 'Item Code', 'Item Name', 'Quantity', 'Min Stock Level', 'Shortfall', 'Mother Warehouse Stock', 'Action'],
    run: async (ctx) => {
      needStockFields(ctx);
      const [{ balances }, im, loc] = await Promise.all([loadStock(ctx.store), ctx.store.read('Item Master'), locations(ctx)]);
      const min = new Map(im.rows.filter((r) => toNum(r['Min Stock Level']) > 0).map((r) => [sstr(r.Code), toNum(r['Min Stock Level'])]));
      const per = new Map(); const mother = (await import('./workflow.js')).defaultLocation; const mw = String(await mother(ctx.store)).toUpperCase();
      const mstock = new Map();
      for (const e of balances.values()) { if (loc.classify(e.warehouse) !== 'Warehouse') continue; const k = `${e.warehouse}|${e.itemCode}`; per.set(k, { warehouse: e.warehouse, code: e.itemCode, name: e.itemName, qty: (per.get(k)?.qty || 0) + e.qty }); if (e.warehouse === mw) mstock.set(e.itemCode, (mstock.get(e.itemCode) || 0) + e.qty); }
      const rows = [];
      for (const x of per.values()) {
        const m = min.get(x.code); if (!m || x.qty >= m - 1e-9 || !inScope(ctx, x.warehouse)) continue;
        rows.push({ Warehouse: x.warehouse, 'Item Code': x.code, 'Item Name': x.name, Quantity: round2(x.qty), 'Min Stock Level': m, Shortfall: round2(m - x.qty), 'Mother Warehouse Stock': x.warehouse === mw ? '' : round2(mstock.get(x.code) || 0), Action: x.warehouse === mw ? 'Raise Purchase Indent' : 'Raise Purchase Requisition' });
      }
      return { rows };
    } },
  { key: 'stock-ledger', group: 'Stock', title: 'Stock Ledger', stage: 'reports', ok: stockOk, columns: ledgerCols, dateCol: 'Date', statusCol: 'Type',
    run: async (ctx) => { needStockFields(ctx); const { rows } = await ctx.store.read('Stock Ledger'); return { rows: rows.filter((r) => (isTransitLoc(r.Warehouse) ? ctx.user.scope.mode !== 'assigned' : inScope(ctx, r.Warehouse))).map((r) => ({ ...Object.fromEntries(ledgerCols.map((c) => [c, c === 'Date' || c === 'Expiry Date' ? normDate(r[c]) : r[c]])) })) }; } },
  // ---- purchasing ----
  { key: 'purchase-indent-register', group: 'Purchasing', title: 'Purchase Indent Register', stage: 'intent', ok: stage('intent'), dateCol: 'Date', statusCol: 'Status', columns: ['Document No.', 'Date', 'Requesting Warehouse', 'Status', 'Requested By', 'Purchase Manager', 'Priority', 'Item Summary', 'Total Required Qty', 'Total Approved Qty', 'Ordered Qty'],
    run: async (ctx) => { const r = await listIntents(ctx, { export: 1 }); return { rows: stripActions(r.rows) }; } },
  { key: 'pending-purchase-indents', group: 'Purchasing', title: 'Pending Purchase Indent Report', stage: 'intent', ok: stage('intent'), dateCol: 'Date', statusCol: 'Status', columns: ['Document No.', 'Date', 'Requesting Warehouse', 'Status', 'Requested By', 'Priority', 'Item Summary', 'Total Required Qty'],
    run: async (ctx) => { const r = await listIntents(ctx, { export: 1, status: 'Pending Review,Returned for Correction,Draft' }); return { rows: stripActions(r.rows) }; } },
  { key: 'pending-po-authorization', group: 'Purchasing', title: 'Pending PO Authorization Report', stage: 'po', ok: stage('po'), dateCol: 'Date', statusCol: 'Status', columns: ['Document No.', 'Date', 'PO Type', 'Vendor Account', 'Source Purchase Intent', 'Item Summary', 'Total Quantity', 'Grand Total', 'Created By', 'Submitted At', 'Status'],
    run: async (ctx) => { const r = await listPos(ctx, { export: 1, view: 'pending-auth' }); return { rows: stripActions(r.rows) }; } },
  { key: 'pending-purchase-orders', group: 'Purchasing', title: 'Pending Purchase Orders Report', stage: 'po', ok: stage('po'), dateCol: 'Date', statusCol: 'Status', columns: ['Document No.', 'Date', 'PO Type', 'Vendor Account', 'Source Purchase Intent', 'Total Quantity', 'Received Quantity', 'Balance Quantity', 'GRN Status', 'Grand Total', 'Status'],
    run: async (ctx) => { const r = await listPos(ctx, { export: 1, view: 'pending' }); return { rows: stripActions(r.rows) }; } },
  { key: 'approved-purchase-orders', group: 'Purchasing', title: 'Approved Purchase Orders Register', stage: 'po', ok: stage('po'), dateCol: 'Date', statusCol: 'Status', columns: ['Document No.', 'Date', 'PO Type', 'Vendor Account', 'Source Purchase Intent', 'Total Quantity', 'Received Quantity', 'Balance Quantity', 'Grand Total', 'Authorized By', 'Authorized At', 'Status'],
    run: async (ctx) => { const r = await listPos(ctx, { export: 1, view: 'approved' }); return { rows: stripActions(r.rows) }; } },
  { key: 'grn-register', group: 'Purchasing', title: 'GRN Register', stage: 'grn', ok: stage('grn'), dateCol: 'Date', run: tableReport('grn-mrn') },
  // ---- warehouse operations ----
  { key: 'purchase-requisition-register', group: 'Warehouse', title: 'Purchase Requisition Register', stage: 'requisition', ok: stage('requisition'), dateCol: 'Date', statusCol: 'Status', columns: ['Document No.', 'Date', 'Requesting Warehouse', 'Issuing Warehouse', 'Priority', 'Status', 'Requested By', 'Reviewed By', 'Item Summary', 'Total Requested', 'Total Approved', 'Total Dispatched', 'Total Received'],
    run: async (ctx) => { const r = await listReqs(ctx, { export: 1 }); return { rows: stripActions(r.rows) }; } },
  { key: 'pending-purchase-requisitions', group: 'Warehouse', title: 'Pending Purchase Requisition Report', stage: 'requisition', ok: stage('requisition'), dateCol: 'Date', statusCol: 'Status', columns: ['Document No.', 'Date', 'Requesting Warehouse', 'Issuing Warehouse', 'Priority', 'Status', 'Requested By', 'Item Summary', 'Total Requested', 'Total Approved', 'Total Dispatched', 'Total Received'],
    run: async (ctx) => { const r = await listReqs(ctx, { export: 1, status: 'Pending Approval,Approved,Partially Dispatched,Dispatched,Partially Received' }); return { rows: stripActions(r.rows) }; } },
  { key: 'stock-transfer-register', group: 'Warehouse', title: 'Stock Transfer Register', stage: 'transfer', ok: stage('transfer'), dateCol: 'Date', run: tableReport('stock-transfer') },
  { key: 'hospital-delivery-register', group: 'Warehouse', title: 'Hospital Delivery (Imprest Out) Register', stage: 'imprest', ok: stage('imprest'), dateCol: 'Date', run: tableReport('imprest-out-new') },
  { key: 'consumption-register', group: 'Warehouse', title: 'Consumption Register', stage: 'consumption', ok: stage('consumption'), dateCol: 'Date', run: tableReport('material-consumption') },
];
export const REPORT_BY_KEY = Object.fromEntries(REPORTS.map((r) => [r.key, r]));

async function opAll(ctx, q) {
  // all rows of the opening-stock view for this user (the paged view caps page size, so walk the pages)
  const out = []; let page = 1;
  for (;;) { const r = await listOpening(ctx, { pageSize: 200, page, asOn: q.asOn }); out.push(...r.rows); if (page >= r.pages) break; page++; }
  return out;
}

export function catalog(ctx) {
  return REPORTS.filter((r) => r.ok(ctx)).map(({ key, group, title }) => ({ key, group, title }));
}

const dateOf = (v) => normDate(v) || '';
// Runs, filters, sorts and pages one report.
export async function runReport(ctx, key, q = {}) {
  const def = REPORT_BY_KEY[key]; if (!def) throw notFound('Unknown report');
  if (!def.ok(ctx)) throw forbidden('Your role cannot open this report');
  if (q.export && !can(ctx.user.role, def.stage, 'export')) throw forbidden('Your role cannot export this report');
  const res = await def.run(ctx, q);
  const columns = res.columns || def.columns || (res.rows[0] ? Object.keys(res.rows[0]) : []);
  let rows = res.rows;
  const lc = (v) => sstr(v).toLowerCase();
  const whCols = columns.filter((c) => /warehouse|location$/i.test(c)); const itemCols = columns.filter((c) => /^(item code|item name|items?|code)$/i.test(c));
  const needle = lc(q.q);
  rows = rows.filter((r) => {
    if (q.warehouse && !whCols.some((c) => lc(r[c]) === lc(q.warehouse)) && !(r['Requesting Warehouse'] || r['Issuing Warehouse'] || r['From Warehouse'] || r['To Warehouse'] ? [r['Requesting Warehouse'], r['Issuing Warehouse'], r['From Warehouse'], r['To Warehouse']].some((w) => lc(w) === lc(q.warehouse)) : false)) return false;
    if (q.batch && !lc(r['Batch Number']).includes(lc(q.batch))) return false;
    if (q.items && !sstr(q.items).split(',').map((x) => x.trim().toLowerCase()).includes(lc(r['Item Code']))) return false;
    if (q.brand && lc(r.Brand) !== lc(q.brand)) return false;
    if (q.category && lc(r.Category) !== lc(q.category)) return false;
    if (q.item && !(itemCols.some((c) => lc(r[c]).includes(lc(q.item))) || lc(r['Item Summary']).includes(lc(q.item)))) return false;
    if (q.status && def.statusCol && lc(r[def.statusCol]) !== lc(q.status)) return false;
    if ((q.from || q.to) && def.dateCol) { const d = dateOf(r[def.dateCol]); if (!d || (q.from && d < q.from) || (q.to && d > q.to)) return false; }
    if (needle && !columns.some((c) => lc(r[c]).includes(needle))) return false;
    return true;
  });
  if (q.sort && columns.includes(q.sort)) {
    const dir = q.dir === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => dir * ((typeof a[q.sort] === 'number' && typeof b[q.sort] === 'number') ? a[q.sort] - b[q.sort] : String(a[q.sort] ?? '').localeCompare(String(b[q.sort] ?? ''), undefined, { numeric: true })));
  } else if (def.dateCol && columns.includes(def.dateCol)) rows = [...rows].sort((a, b) => (def.dateAsc ? (dateOf(a[def.dateCol]) || '9').localeCompare(dateOf(b[def.dateCol]) || '9') : dateOf(b[def.dateCol]).localeCompare(dateOf(a[def.dateCol]))));
  let summary = null;
  if (def.summary) { // how many items / batches fall in each tag, for the figures above the table
    const m = new Map(); const S = def.summary;
    const all = res.rows; // whole report, so the tag boxes keep their figures when one of them is used as a filter
    for (const r of all) { const k = sstr(r[def.statusCol]); const o = m.get(k) || m.set(k, { tag: k, items: new Set(), batches: 0, qty: 0, value: 0 }).get(k); o.items.add(r[S.itemCol]); o.batches += 1; o.qty = round2(o.qty + toNum(r[S.qtyCol])); o.value = round2(o.value + toNum(r[S.valueCol])); }
    summary = { tags: [...m.values()].map((o) => ({ tag: o.tag, items: o.items.size, batches: o.batches, qty: o.qty, value: o.value })), items: new Set(all.map((r) => r[S.itemCol])).size, batches: all.length, value: round2(all.reduce((s, r) => s + toNum(r[S.valueCol]), 0)) };
  }
  const statuses = def.statusCol ? [...new Set(res.rows.map((r) => sstr(r[def.statusCol])).filter(Boolean))].sort() : [];
  const uniq = (c) => (columns.includes(c) ? [...new Set(res.rows.map((r) => sstr(r[c])).filter(Boolean))].sort() : []);
  const meta = { key, title: def.title, group: def.group, columns, hasDate: !!def.dateCol, statuses, statusLabel: def.statusLabel || 'Status', summary, hasWithin: !!def.withinDefault, withinDefault: def.withinDefault || null, brands: uniq('Brand'), categories: uniq('Category') };
  if (q.export) { // a grouped report (parent item, child lines) is exported as: item heading row, its lines, blank row, next item
    if (def.groupBy) {
      const g = new Map(); for (const r of rows.slice(0, 50000)) (g.get(r[def.groupBy]) || g.set(r[def.groupBy], []).get(r[def.groupBy])).push(r);
      rows = [...g.entries()].sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true })).flatMap(([k, ls], i) => [...(i ? [{}] : []), { [columns[0]]: `${k} — ${sstr(ls[0]['Item Name'])}`.trim() }, ...ls]);
    }
    return { ...meta, rows: rows.slice(0, 50000), total: rows.length };
  }
  const totals = {}; for (const c of columns) if (rows.length && rows.every((r) => typeof r[c] === 'number') && /qty|quantity|value|total|stock|amount/i.test(c) && !/rate|days|level/i.test(c)) totals[c] = round2(rows.reduce((s, r) => s + r[c], 0));
  if (q.all) return { ...meta, totals, rows: rows.slice(0, 20000), total: rows.length, truncated: rows.length > 20000 };
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 25)); const pages = Math.max(1, Math.ceil(rows.length / pageSize)); const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  return { ...meta, rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, pages, totals };
}
