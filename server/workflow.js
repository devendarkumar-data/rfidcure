// Purchase Intent -> Purchase Order authorization -> GRN workflow.
// Documents live in the approved template tabs (Purchase Indent, Purchase Order — Domestic/Import, GRN  MRN, line items as JSON).
// Workflow state (status, who/when, remarks) lives in two added tabs: "Doc Status" (current state) and "Doc History" (every event).
// Quantities that are derived from other documents (ordered / received / balance) are always recomputed, never stored,
// so they cannot drift or be double counted.
import { TABLE_BY_TAB, TAB, DOC_STATUS_TAB, DOC_HISTORY_TAB } from '../shared/registry.js';
import { can } from '../shared/permissions.js';
import { assertWarehouses, inScope, maskLines, maskRow, parseLines } from './access.js';
import { audit } from './audit.js';
import { getSettings } from './auth.js';
import { CURRENCIES } from '../shared/po-options.js';
import { itemCatalog, nextDocNo, stripInternal, validateHeader, validateLines, warehouseList } from './crud.js';
import { loadStock } from './stock.js';
import { COMPANY } from '../shared/company.js';
import { HttpError, bad, conflict, forbidden, istParts, normDate, notFound, round2, sstr, today, toNum, unprocessable, withLock } from './util.js';

export const INTENT = 'Purchase Intent';
export const PO = 'Purchase Order';
export const IS = { DRAFT: 'Draft', PENDING: 'Pending Review', RETURNED: 'Returned for Correction', APPROVED: 'Approved', REJECTED: 'Rejected', PART: 'Partially Converted to PO', FULL: 'Fully Converted to PO', CLOSED: 'Closed' };
export const PS = { DRAFT: 'Draft', PENDING: 'Pending Authorization', RETURNED: 'Returned for Correction', APPROVED: 'Approved', REJECTED: 'Rejected', PART: 'Partially Received', DONE: 'Completed', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
const PO_ACTIVE_FOR_INTENT = new Set([PS.DRAFT, PS.PENDING, PS.RETURNED, PS.APPROVED, PS.PART, PS.DONE, PS.CLOSED]); // Rejected / Cancelled POs release the intent quantity
const PO_OPEN_FOR_GRN = new Set([PS.APPROVED, PS.PART]);
const intentTable = () => TABLE_BY_TAB['Purchase Indent'];
const poTables = () => [TABLE_BY_TAB['Purchase Order — Domestic'], TABLE_BY_TAB['Purchase Order — Import']];
const poTableByType = (t) => (t === 'import' ? poTables()[1] : poTables()[0]);
const grnTable = () => TABLE_BY_TAB['GRN  MRN'];
export const nowIso = () => new Date().toISOString();
export const sameUser = (a, b) => sstr(a).toLowerCase() === sstr(b).toLowerCase();
export const isSuper = (ctx) => ctx.user.role === 'super_admin';
export const isAdmin = (ctx) => ['super_admin', 'admin'].includes(ctx.user.role);

// ---- shared plumbing ---------------------------------------------------------------------------------------------
export async function statusMap(store, { fresh = false } = {}) {
  const { rows } = await store.read(DOC_STATUS_TAB, { fresh });
  return new Map(rows.map((r) => [`${r['Doc Type']}|${r['Document No.']}`, r]));
}
export async function addHistory(store, { type, no, event, from = '', to = '', user, remarks = '', details = '' }) {
  const t = istParts();
  await store.append(DOC_HISTORY_TAB, [{ 'Doc Type': type, 'Document No.': no, Event: event, 'From Status': from, 'To Status': to, 'User ID': user.id, Date: t.date, Time: t.time, Remarks: remarks, Details: typeof details === 'string' ? details : JSON.stringify(details).slice(0, 4000) }]);
}
export async function setStatus(ctx, srow, patch, hist) {
  const merged = { ...patch, 'Updated At': nowIso() };
  await ctx.store.updateRow(DOC_STATUS_TAB, srow.__row, merged, { col: 'Document No.', val: srow['Document No.'] });
  if (hist) await addHistory(ctx.store, { type: srow['Doc Type'], no: srow['Document No.'], user: ctx.user, from: srow.Status, to: patch.Status || srow.Status, ...hist });
}
async function findDoc(ctx, table, id) {
  const { rows } = await ctx.store.read(table.tab, { fresh: true });
  const row = rows.find((r) => sstr(r[table.idCol]) === sstr(id));
  if (!row) throw notFound('Document not found');
  const st = (await statusMap(ctx.store, { fresh: true })).get(`${{ intent: INTENT, po: PO, req: 'Purchase Requisition' }[table.workflow]}|${id}`);
  if (!st) throw new HttpError(500, `Workflow status for ${id} is missing in the "Doc Status" sheet`);
  return { row, st, lines: parseLines(row.Lines) };
}
export function paginate(list, q, max = 200) {
  const total = list.length;
  const pageSize = Math.min(max, Math.max(1, parseInt(q.pageSize, 10) || 25));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  return { rows: list.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, pages };
}
// display-only keys the UI may echo back when it re-submits a loaded document
const DISPLAY_ONLY = ['Ordered Qty', 'Remaining Qty', 'Received Qty', 'Balance Qty'];
const cleanLines = (ls) => (Array.isArray(ls) ? ls.map((l) => Object.fromEntries(Object.entries(l || {}).filter(([k]) => !DISPLAY_ONLY.includes(k)))) : ls);
export const need = (cond, msg) => { if (!cond) throw bad(msg); };
const lineNos = (lines) => lines.reduce((m, l) => Math.max(m, toNum(l['Line No'])), 0);

export async function defaultLocation(store) {
  const { rows } = await store.read('Configuration');
  return sstr(rows[0]?.Location) || sstr(process.env.DEFAULT_PO_LOCATION) || 'MWH';
}

export async function currentStockMap(ctx) {
  const { balances } = await loadStock(ctx.store);
  const m = new Map();
  for (const e of balances.values()) { const k = `${e.warehouse}|${e.itemCode}`; m.set(k, (m.get(k) || 0) + e.qty); }
  return (wh, code) => Math.round((m.get(`${sstr(wh).toUpperCase()}|${sstr(code)}`) || 0) * 1e6) / 1e6;
}

export async function findIdemDoc(ctx, tab, key) {
  if (!key) return null;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) throw bad('Invalid idempotency key');
  const { rows } = await ctx.store.read('Audit Logs', { fresh: true });
  for (let i = rows.length - 1, n = 0; i >= 0 && n < 400; i--, n++) if (rows[i].Remarks === `idem:${key}` && rows[i].Module === tab && rows[i].Action === 'Create') return sstr(rows[i].Document_No);
  return null;
}

// ---- derived quantities --------------------------------------------------------------------------------------------
// Ordered quantity per intent line, from every PO that still holds the quantity (rejected / cancelled POs release it).
async function intentOrdered(ctx, { fresh = true } = {}) {
  const st = await statusMap(ctx.store, { fresh });
  const out = new Map();
  for (const t of poTables()) {
    const { rows } = await ctx.store.read(t.tab, { fresh });
    for (const r of rows) {
      const s = st.get(`${PO}|${r[t.idCol]}`); if (!s || !PO_ACTIVE_FOR_INTENT.has(s.Status)) continue;
      for (const l of parseLines(r.Lines)) {
        if (!sstr(l['Intent No'])) continue;
        const k = `${l['Intent No']}|${l['Intent Line']}`; out.set(k, (out.get(k) || 0) + toNum(l.Quantity));
      }
    }
  }
  return out;
}
// Accepted quantity per PO line, from the GRNs that reference the PO in "Supplier Ref No".
async function poReceived(ctx, { fresh = true } = {}) {
  const t = grnTable(); const { rows } = await ctx.store.read(t.tab, { fresh });
  const out = new Map(); const grns = new Map();
  for (const r of rows) {
    const po = sstr(r['Supplier Ref No']); if (!po) continue;
    for (const l of parseLines(r.Lines)) {
      if (!toNum(l['PO Line'])) continue;
      const k = `${po}|${toNum(l['PO Line'])}`; out.set(k, (out.get(k) || 0) + toNum(l['Accepted Qty']));
    }
    (grns.get(po) || grns.set(po, []).get(po)).push(sstr(r['Document No.']));
  }
  return { received: out, grns };
}
function poLineBalances(poNo, lines, received) {
  return lines.map((l) => {
    const rec = received.get(`${poNo}|${toNum(l['Line No'])}`) || 0;
    return { lineNo: toNum(l['Line No']), ordered: toNum(l.Quantity), received: rec, balance: Math.max(0, Math.round((toNum(l.Quantity) - rec) * 1e6) / 1e6) };
  });
}
function receiptStatus(bals) {
  const rec = bals.reduce((s, b) => s + b.received, 0), open = bals.some((b) => b.balance > 1e-9);
  return !open ? PS.DONE : rec > 0 ? PS.PART : PS.APPROVED;
}

async function refreshIntent(ctx, intentNo) {
  const t = intentTable(); const { rows } = await ctx.store.read(t.tab, { fresh: true });
  const row = rows.find((r) => r[t.idCol] === intentNo); if (!row) return;
  const st = (await statusMap(ctx.store, { fresh: true })).get(`${INTENT}|${intentNo}`);
  if (!st || ![IS.APPROVED, IS.PART, IS.FULL].includes(st.Status)) return;
  const ord = await intentOrdered(ctx);
  const lines = parseLines(row.Lines).filter((l) => toNum(l['Approved Qty']) > 0);
  const total = lines.reduce((s, l) => s + (ord.get(`${intentNo}|${l['Line No']}`) || 0), 0);
  const full = lines.every((l) => (ord.get(`${intentNo}|${l['Line No']}`) || 0) >= toNum(l['Approved Qty']) - 1e-9);
  const next = full ? IS.FULL : total > 0 ? IS.PART : IS.APPROVED;
  if (next !== st.Status) {
    await setStatus(ctx, st, { Status: next }, { event: 'Conversion update', remarks: `Ordered quantity now ${total}` });
    await ctx.store.updateRow(t.tab, row.__row, { Status: next }, { col: t.idCol, val: intentNo });
  }
}
async function refreshPoReceipt(ctx, poNo) {
  for (const t of poTables()) {
    const { rows } = await ctx.store.read(t.tab, { fresh: true });
    const row = rows.find((r) => r[t.idCol] === poNo); if (!row) continue;
    const st = (await statusMap(ctx.store, { fresh: true })).get(`${PO}|${poNo}`);
    if (!st || !PO_OPEN_FOR_GRN.has(st.Status)) return;
    const { received } = await poReceived(ctx);
    const next = receiptStatus(poLineBalances(poNo, parseLines(row.Lines), received));
    if (next !== st.Status) await setStatus(ctx, st, { Status: next }, { event: 'Receipt', remarks: next === PS.DONE ? 'Fully received' : 'Partially received' });
    return;
  }
}

// ---- Purchase Intent --------------------------------------------------------------------------------------------------
function intentCan(ctx, row, st) {
  const t = intentTable(); const s = st.Status; const mine = sameUser(st['Created By'], ctx.user.id);
  const has = (a) => can(ctx.user.role, t.stage, a) && ctx.user.scope.mode !== 'all-readonly';
  const ownerOrAdmin = mine || isAdmin(ctx);
  const review = has('approve') && s === IS.PENDING && (!mine || isSuper(ctx));
  return {
    edit: has('edit') && [IS.DRAFT, IS.RETURNED].includes(s) && ownerOrAdmin,
    submit: has('edit') && [IS.DRAFT, IS.RETURNED].includes(s) && ownerOrAdmin,
    approve: review, reject: review, return: review,
    close: has('approve') && [IS.APPROVED, IS.PART, IS.FULL].includes(s),
    convert: can(ctx.user.role, 'po', 'create') && [IS.APPROVED, IS.PART].includes(s),
  };
}
function intentShape(ctx, row, st, ordered, stockOf) {
  const lines = parseLines(row.Lines).map((l) => {
    const approved = toNum(l['Approved Qty']), ord = ordered.get(`${row['Document No.']}|${l['Line No']}`) || 0;
    return { ...l, 'Current Stock': stockOf ? stockOf(row['Requesting Warehouse'], l['Item Code']) : l['Current Stock'], 'Ordered Qty': ord, 'Remaining Qty': Math.max(0, round2(approved - ord)) };
  });
  return { header: maskRow(ctx, row), lines: maskLines(ctx, lines), status: st };
}

export async function saveIntent(ctx, body, id, idem) {
  const t = intentTable();
  if (!can(ctx.user.role, t.stage, id ? 'edit' : 'create')) throw forbidden('Your role cannot raise Purchase Intents');
  if (ctx.user.scope.mode === 'all-readonly') throw forbidden('Your account is read-only');
  return withLock('stock', async () => {
    if (!id) { const prev = await findIdemDoc(ctx, t.tab, idem); if (prev) return { ...(await getIntent(ctx, prev)), duplicate: true }; }
    const hdr = { ...(body?.header || {}) }; delete hdr.Status; delete hdr['Submit For Approval']; delete hdr[t.idCol];
    const header = await validateHeader(ctx, t, hdr);
    assertWarehouses(ctx, [header['Requesting Warehouse']], 'warehouse');
    const stock = await loadStock(ctx.store, { fresh: true });
    const catalog = await itemCatalog(ctx.store, stock);
    let lines = await validateLines(ctx, t, cleanLines(body?.lines), catalog, { strictItems: true });
    const date = header.Date || today();
    let existing = null;
    if (id) {
      existing = await findDoc(ctx, t, id);
      if (!intentCan(ctx, existing.row, existing.st).edit) throw conflict(`Intent ${id} cannot be edited in status "${existing.st.Status}"`);
    }
    const stockOf = await currentStockMap(ctx);
    let next = id ? lineNos(existing.lines) : 0; const known = new Set((existing?.lines || []).map((l) => toNum(l['Line No'])));
    lines = lines.map((l, i) => {
      need(toNum(l.Quantity) > 0, `Line ${i + 1}: Required Quantity must be greater than zero`);
      if (l['Required By Date'] && l['Required By Date'] < date) throw bad(`Line ${i + 1}: Required By Date is before the intent date`);
      const keep = toNum(l['Line No']) && known.has(toNum(l['Line No'])) ? toNum(l['Line No']) : ++next;
      return { ...l, 'Line No': keep, Description: l.Description || l[t.itemField], Priority: l.Priority || 'Normal', 'Current Stock': stockOf(header['Requesting Warehouse'], l['Item Code']), 'Approved Qty': '' };
    });
    if (new Set(lines.map((l) => l['Line No'])).size !== lines.length) throw bad('Duplicate line numbers');
    const wantSubmit = !!body?.submit;
    const status = wantSubmit ? IS.PENDING : (existing?.st.Status === IS.RETURNED ? IS.RETURNED : IS.DRAFT);
    const row = { ...header, 'Indent Type': header['Indent Type'] || 'In-house', Status: status, 'Submit For Approval': wantSubmit ? 'Yes' : 'No', Lines: JSON.stringify(stripInternal(lines)) };
    const t0 = nowIso();
    if (!id) {
      const no = await nextDocNo(ctx.store, t, date);
      row[t.idCol] = no;
      await ctx.store.append(t.tab, [row]);
      await ctx.store.append(DOC_STATUS_TAB, [{ 'Doc Type': INTENT, 'Document No.': no, Status: status, 'Created By': ctx.user.id, 'Created At': t0, 'Submitted At': wantSubmit ? t0 : '', Warehouse: header['Requesting Warehouse'], 'Updated At': t0 }]);
      await addHistory(ctx.store, { type: INTENT, no, event: 'Created', to: status, user: ctx.user, details: { lines: lines.length } });
      if (wantSubmit) await addHistory(ctx.store, { type: INTENT, no, event: 'Submitted', from: IS.DRAFT, to: IS.PENDING, user: ctx.user });
      await audit(ctx.store, { user: ctx.user, module: t.tab, doc: no, action: 'Create', next: { status, lines: lines.length }, remarks: idem ? `idem:${idem}` : '' });
      return getIntent(ctx, no);
    }
    const patch = { ...row }; delete patch[t.idCol];
    await ctx.store.updateRow(t.tab, existing.row.__row, patch, { col: t.idCol, val: id });
    const stPatch = { Status: status, Warehouse: header['Requesting Warehouse'], ...(wantSubmit ? { 'Submitted At': t0 } : {}) };
    await setStatus(ctx, existing.st, stPatch, { event: wantSubmit ? (existing.st.Status === IS.RETURNED ? 'Resubmitted' : 'Submitted') : 'Edited', remarks: '' });
    await audit(ctx.store, { user: ctx.user, module: t.tab, doc: id, action: 'Update', prev: { status: existing.st.Status }, next: { status, lines: lines.length } });
    return getIntent(ctx, id);
  });
}

export async function intentAction(ctx, id, body) {
  const t = intentTable(); const action = sstr(body?.action).toLowerCase(); const remarks = sstr(body?.remarks).slice(0, 1000);
  return withLock('stock', async () => {
    const d = await findDoc(ctx, t, id);
    if (!(ctx.user.scope.mode !== 'assigned' || inScope(ctx, d.row['Requesting Warehouse']))) throw notFound('Document not found');
    const c = intentCan(ctx, d.row, d.st);
    if (!c[action === 'return' ? 'return' : action]) throw forbidden(`You cannot ${action} intent ${id} (status: ${d.st.Status})`);
    const t0 = nowIso();
    if (action === 'submit') {
      await ctx.store.updateRow(t.tab, d.row.__row, { Status: IS.PENDING, 'Submit For Approval': 'Yes' }, { col: t.idCol, val: id });
      await setStatus(ctx, d.st, { Status: IS.PENDING, 'Submitted At': t0 }, { event: d.st.Status === IS.RETURNED ? 'Resubmitted' : 'Submitted' });
    } else if (['approve', 'reject', 'return'].includes(action)) {
      if (action !== 'approve') need(remarks, 'Remarks are required to reject or return an intent');
      const patchLines = d.lines.slice();
      if (action === 'approve') {
        const asked = new Map((body.lines || []).map((l) => [toNum(l.lineNo), l.approvedQty]));
        for (const l of patchLines) {
          const req = toNum(l.Quantity); const a = asked.has(toNum(l['Line No'])) ? toNum(asked.get(toNum(l['Line No']))) : req;
          if (a < 0 || a > req + 1e-9) throw bad(`Line ${l['Line No']}: approved quantity must be between 0 and the requested ${req}`);
          l['Approved Qty'] = a;
        }
        if (!patchLines.some((l) => toNum(l['Approved Qty']) > 0)) throw bad('Approve at least one line, or reject the intent');
      }
      const status = action === 'approve' ? IS.APPROVED : action === 'reject' ? IS.REJECTED : IS.RETURNED;
      await ctx.store.updateRow(t.tab, d.row.__row, { Status: status, ...(action === 'approve' ? { Lines: JSON.stringify(patchLines) } : {}) }, { col: t.idCol, val: id });
      await setStatus(ctx, d.st, { Status: status, 'Reviewed By': ctx.user.id, 'Reviewed At': t0, 'Review Remarks': remarks }, { event: action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Returned for correction', remarks, details: action === 'approve' ? patchLines.map((l) => ({ line: l['Line No'], requested: l.Quantity, approved: l['Approved Qty'] })) : '' });
    } else if (action === 'close') {
      need(remarks, 'Remarks are required to close an intent');
      await ctx.store.updateRow(t.tab, d.row.__row, { Status: IS.CLOSED }, { col: t.idCol, val: id });
      await setStatus(ctx, d.st, { Status: IS.CLOSED, 'Review Remarks': remarks }, { event: 'Closed', remarks });
    } else throw bad('Unknown action');
    await audit(ctx.store, { user: ctx.user, module: t.tab, doc: id, action: `Intent ${action}`, prev: { status: d.st.Status }, remarks });
    return getIntent(ctx, id);
  });
}

export async function listIntents(ctx, q = {}) {
  const t = intentTable();
  if (!can(ctx.user.role, t.stage, 'view')) throw forbidden();
  const [{ rows }, st, ordered] = await Promise.all([ctx.store.read(t.tab), statusMap(ctx.store), intentOrdered(ctx, { fresh: false })]);
  const needle = sstr(q.q).toLowerCase(); const item = sstr(q.item).toLowerCase();
  const wanted = sstr(q.status) ? sstr(q.status).split(',').map((x) => x.trim()) : null;
  const list = [];
  for (const r of rows) {
    const s = st.get(`${INTENT}|${r['Document No.']}`); if (!s) continue;
    if (!inScope(ctx, r['Requesting Warehouse']) && ctx.user.scope.mode === 'assigned') continue;
    if (wanted && !wanted.includes(s.Status)) continue;
    if (q.warehouse && sstr(r['Requesting Warehouse']).toUpperCase() !== sstr(q.warehouse).toUpperCase()) continue;
    const d = normDate(r.Date); if ((q.from && d < q.from) || (q.to && d > q.to)) continue;
    if (q.requestedBy && !sameUser(s['Created By'], q.requestedBy)) continue;
    if (q.reviewer && !sameUser(s['Reviewed By'], q.reviewer)) continue;
    const lines = parseLines(r.Lines);
    if (q.priority && !lines.some((l) => sstr(l.Priority).toLowerCase() === sstr(q.priority).toLowerCase())) continue;
    if (item && !lines.some((l) => `${l['Item Code']} ${l.Items}`.toLowerCase().includes(item))) continue;
    if (needle && !`${r['Document No.']} ${r['Requesting Warehouse']} ${s['Created By']} ${lines.map((l) => `${l['Item Code']} ${l.Items}`).join(' ')}`.toLowerCase().includes(needle)) continue;
    const topPriority = ['Urgent', 'High', 'Normal', 'Low'].find((p) => lines.some((l) => l.Priority === p)) || 'Normal';
    list.push({
      'Document No.': r['Document No.'], Date: d, 'Requesting Warehouse': r['Requesting Warehouse'], Status: s.Status, 'Requested By': s['Created By'], 'Purchase Manager': s['Reviewed By'],
      Priority: topPriority, Lines: lines.length, 'Total Required Qty': round2(lines.reduce((x, l) => x + toNum(l.Quantity), 0)),
      'Total Approved Qty': round2(lines.reduce((x, l) => x + toNum(l['Approved Qty']), 0)),
      'Ordered Qty': round2(lines.reduce((x, l) => x + (ordered.get(`${r['Document No.']}|${l['Line No']}`) || 0), 0)),
      'Item Summary': lines.slice(0, 2).map((l) => l.Items).join(', ') + (lines.length > 2 ? ` +${lines.length - 2} more` : ''),
      'Submitted At': s['Submitted At'], 'Reviewed At': s['Reviewed At'], 'Review Remarks': s['Review Remarks'], actions: intentCan(ctx, r, s),
    });
  }
  const dir = q.dir === 'asc' ? 1 : -1; const col = ['Document No.', 'Date', 'Requesting Warehouse', 'Status', 'Priority'].includes(q.sort) ? q.sort : 'Date';
  list.sort((a, b) => dir * String(a[col]).localeCompare(String(b[col]), undefined, { numeric: true }) || dir * a['Document No.'].localeCompare(b['Document No.']));
  if (q.export) return { rows: list, total: list.length };
  return paginate(list, q);
}

export async function historyOf(ctx, type, no) {
  const { rows } = await ctx.store.read(DOC_HISTORY_TAB, { fresh: true });
  return rows.filter((r) => r['Doc Type'] === type && r['Document No.'] === no).map(({ __row, ...r }) => r);
}

export async function getIntent(ctx, id) {
  const t = intentTable();
  if (!can(ctx.user.role, t.stage, 'view')) throw forbidden();
  const d = await findDoc(ctx, t, id);
  if (ctx.user.scope.mode === 'assigned' && !inScope(ctx, d.row['Requesting Warehouse'])) throw notFound('Document not found');
  const ordered = await intentOrdered(ctx); const stockOf = await currentStockMap(ctx);
  const out = intentShape(ctx, d.row, d.st, ordered, stockOf);
  const { __row, ...st } = d.st; void __row;
  return { id, ...out, status: st, history: await historyOf(ctx, INTENT, id), can: intentCan(ctx, d.row, d.st) };
}

// Approved intents that still have quantity left to order - source list for "Create PO from intent".
export async function openIntents(ctx, q = {}) {
  if (!can(ctx.user.role, 'po', 'create')) throw forbidden();
  const t = intentTable(); const [{ rows }, st, ordered] = await Promise.all([ctx.store.read(t.tab, { fresh: true }), statusMap(ctx.store, { fresh: true }), intentOrdered(ctx)]);
  const needle = sstr(q.q).toLowerCase(); const out = [];
  for (const r of rows) {
    const s = st.get(`${INTENT}|${r['Document No.']}`); if (!s || ![IS.APPROVED, IS.PART].includes(s.Status)) continue;
    const lines = parseLines(r.Lines).map((l) => ({ lineNo: l['Line No'], itemCode: l['Item Code'], items: l.Items, description: l.Description, units: l.Units, approved: toNum(l['Approved Qty']), ordered: ordered.get(`${r['Document No.']}|${l['Line No']}`) || 0 }))
      .map((l) => ({ ...l, remaining: Math.max(0, round2(l.approved - l.ordered)) })).filter((l) => l.remaining > 0);
    if (!lines.length) continue;
    if (needle && !`${r['Document No.']} ${r['Requesting Warehouse']} ${lines.map((l) => l.items).join(' ')}`.toLowerCase().includes(needle)) continue;
    out.push({ 'Document No.': r['Document No.'], Date: normDate(r.Date), 'Requesting Warehouse': r['Requesting Warehouse'], status: s.Status, lines });
  }
  return { rows: out };
}

// ---- Purchase Order -----------------------------------------------------------------------------------------------------
export function calcPoLines(type, header, lines) {
  const igst = /^yes$/i.test(sstr(header['Is IGST'])); const fx = type === 'import' ? toNum(header['Exchange Rate']) || 1 : 1;
  let subtotal = 0, tax = 0, grand = 0;
  const out = lines.map((l) => {
    const qty = toNum(l.Quantity), rate = toNum(l.Rate), disc = toNum(l['Other Discount']);
    const gross = round2(qty * rate * fx), taxable = round2(Math.max(0, gross - disc));
    const o = { ...l, Gross: gross };
    if (type === 'domestic') {
      const pct = toNum(l['GST %']); const t = round2(taxable * pct / 100);
      Object.assign(o, { 'Taxable Value': taxable, CGST: igst ? 0 : round2(t / 2), SGST: igst ? 0 : round2(t - round2(t / 2)), IGST: igst ? t : 0, 'Line Total': round2(taxable + t) });
      subtotal += taxable; tax += t; grand += taxable + t;
    } else {
      const pkg = toNum(l['PKG Charges']); o['Rate (INR)'] = round2(rate * fx); o['Line Total'] = round2(taxable + pkg);
      subtotal += taxable + pkg; grand += taxable + pkg;
    }
    return o;
  });
  return { lines: out, subtotal: round2(subtotal), taxTotal: round2(tax), grandTotal: round2(grand) };
}

function poCan(ctx, st) {
  const mine = sameUser(st['Created By'], ctx.user.id); const s = st.Status;
  const has = (a) => can(ctx.user.role, 'po', a) && ctx.user.scope.mode !== 'all-readonly';
  const ownerOrAdmin = mine || isAdmin(ctx) || ctx.user.role === 'purchase_manager';
  const auth = has('approve') && s === PS.PENDING && (!mine || isSuper(ctx));
  return {
    edit: has('edit') && [PS.DRAFT, PS.RETURNED].includes(s) && ownerOrAdmin,
    submit: has('edit') && [PS.DRAFT, PS.RETURNED].includes(s) && ownerOrAdmin,
    approve: auth, reject: auth, return: auth,
    cancel: (has('edit') || has('approve')) && [PS.DRAFT, PS.RETURNED, PS.PENDING].includes(s) && (ownerOrAdmin || has('approve')),
    close: has('approve') && [PS.APPROVED, PS.PART].includes(s),
    receive: can(ctx.user.role, 'grn', 'create') && [PS.APPROVED, PS.PART].includes(s),
    print: true,
    editQuantities: auth,
  };
}

// Check a PO line against its source intent line. `own` = quantity this same PO already holds (so edits are not double counted).
async function checkIntentLines(ctx, lines, { poNo, override, history }) {
  const intents = new Map(); const ordered = await intentOrdered(ctx); const t = intentTable();
  const st = await statusMap(ctx.store, { fresh: true }); const used = new Map();
  for (const [i, l] of lines.entries()) {
    const no = sstr(l['Intent No']); if (!no) continue;
    if (!intents.has(no)) { const { rows } = await ctx.store.read(t.tab, { fresh: true }); intents.set(no, rows.find((r) => r['Document No.'] === no) || null); }
    const row = intents.get(no); const s = st.get(`${INTENT}|${no}`);
    if (!row || !s) throw unprocessable(`Line ${i + 1}: Purchase Intent ${no} was not found`);
    if (![IS.APPROVED, IS.PART].includes(s.Status) && !(override && poNo)) throw unprocessable(`Line ${i + 1}: Purchase Intent ${no} is "${s.Status}" and cannot be converted to a PO`);
    const il = parseLines(row.Lines).find((x) => toNum(x['Line No']) === toNum(l['Intent Line']));
    if (!il) throw unprocessable(`Line ${i + 1}: intent ${no} has no line ${l['Intent Line']}`);
    if (il['Item Code'] !== l['Item Code']) throw unprocessable(`Line ${i + 1}: item does not match intent ${no} line ${l['Intent Line']}`);
    const k = `${no}|${l['Intent Line']}`;
    used.set(k, (used.get(k) || 0) + toNum(l.Quantity));
    let own = 0;
    if (poNo) for (const tt of poTables()) { const { rows } = await ctx.store.read(tt.tab); const r = rows.find((x) => x[tt.idCol] === poNo); if (r) for (const pl of parseLines(r.Lines)) if (`${pl['Intent No']}|${pl['Intent Line']}` === k) own += toNum(pl.Quantity); }
    const remaining = toNum(il['Approved Qty']) - ((ordered.get(k) || 0) - (poNo ? own : 0));
    if (used.get(k) > remaining + 1e-9) {
      if (!override) throw unprocessable(`Line ${i + 1}: quantity ${used.get(k)} exceeds the remaining approved quantity ${Math.max(0, round2(remaining))} on intent ${no}`);
      history.push({ line: i + 1, intent: no, intentLine: l['Intent Line'], approvedRemaining: Math.max(0, round2(remaining)), ordered: used.get(k), overrideReason: override });
    }
  }
}

export async function savePo(ctx, body, id, idem) {
  const type = id ? null : (body?.poType === 'import' ? 'import' : 'domestic');
  return withLock('stock', async () => {
    if (!id) { for (const tt of poTables()) { const prev = await findIdemDoc(ctx, tt.tab, idem); if (prev) return { ...(await getPo(ctx, prev)), duplicate: true }; } }
    let existing = null; let t;
    if (id) {
      for (const tt of poTables()) { const { rows } = await ctx.store.read(tt.tab, { fresh: true }); if (rows.some((r) => r[tt.idCol] === id)) { t = tt; break; } }
      if (!t) throw notFound('Purchase Order not found');
      existing = await findDoc(ctx, t, id);
      if (!poCan(ctx, existing.st).edit) throw conflict(`PO ${id} cannot be edited in status "${existing.st.Status}"`);
    } else t = poTableByType(type);
    const poType = t.poType;
    if (!can(ctx.user.role, 'po', id ? 'edit' : 'create')) throw forbidden('Your role cannot create Purchase Orders');
    if (ctx.user.scope.mode === 'all-readonly') throw forbidden('Your account is read-only');
    const hdr = { ...(body?.header || {}) }; delete hdr['Submit For Approval']; delete hdr[t.idCol];
    const def = await defaultLocation(ctx.store);
    // Warehouse: users tied to one warehouse always raise POs for it (the field is hidden for them); others may only pick warehouses they are assigned to.
    const mine = ctx.user.scope.mode === 'assigned' ? ctx.user.scope.warehouses : null;
    if (mine) {
      if (!mine.length) throw forbidden('No warehouse is assigned to your account. Ask an administrator to assign one.');
      const asked = sstr(hdr.Location).toUpperCase();
      if (!asked) hdr.Location = mine[0];
      else if (!mine.includes(asked)) throw forbidden(mine.length === 1 ? `You can only raise Purchase Orders for your assigned warehouse (${mine[0]})` : `You are not assigned to warehouse ${asked}`);
    }
    if (poType === 'domestic') { hdr.Location = sstr(hdr.Location) || def; hdr.Destination = hdr.Location; } // Destination is not user-editable on a Domestic PO
    else { hdr.Location = sstr(hdr.Location) || def; hdr.Destination = sstr(hdr.Destination) || hdr.Location; }
    if (poType === 'domestic') { delete hdr.Currency; delete hdr['Exchange Rate']; } // Domestic POs are always in INR
    const header = await validateHeader(ctx, t, hdr);
    const date = header.Date || today();
    need(sstr(header['Vendor Account']), 'Vendor is required');
    if (poType === 'import') { need(CURRENCIES.some(([c]) => c === sstr(header.Currency)), 'Currency is required for an Import PO'); need(toNum(header['Exchange Rate']) > 0, 'Exchange Rate is required for an Import PO'); }
    const stock = await loadStock(ctx.store, { fresh: true });
    const catalog = await itemCatalog(ctx.store, stock);
    let lines = await validateLines(ctx, t, cleanLines(body?.lines), catalog, { strictItems: true });
    const stockOf = await currentStockMap(ctx);
    const loc = header.Location || def;
    let next = existing ? lineNos(existing.lines) : 0; const known = new Set((existing?.lines || []).map((l) => toNum(l['Line No'])));
    const overrideHist = [];
    const override = sstr(body?.override?.reason);
    if (override && !can(ctx.user.role, 'po', 'approve')) throw forbidden('You are not authorised to override the approved intent quantity');
    lines = lines.map((l, i) => {
      need(toNum(l.Quantity) > 0, `Line ${i + 1}: Quantity must be greater than zero`);
      need(toNum(l.Rate) > 0, `Line ${i + 1}: Rate is required`);
      if (poType === 'domestic' && (toNum(l['GST %']) < 0 || toNum(l['GST %']) > 100)) throw bad(`Line ${i + 1}: GST % must be between 0 and 100`);
      const keep = toNum(l['Line No']) && known.has(toNum(l['Line No'])) ? toNum(l['Line No']) : ++next;
      return { ...l, 'Line No': keep, Description: l.Description || l[t.itemField], 'Current Stock': stockOf(loc, l['Item Code']) };
    });
    await checkIntentLines(ctx, lines, { poNo: id, override, history: overrideHist });
    const calc = calcPoLines(poType, header, lines);
    const wantSubmit = !!body?.submit; const status = wantSubmit ? PS.PENDING : (existing?.st.Status === PS.RETURNED ? PS.RETURNED : PS.DRAFT);
    const row = { ...header, 'Submit For Approval': wantSubmit ? 'Yes' : 'No', Lines: JSON.stringify(stripInternal(calc.lines)) };
    const t0 = nowIso(); const money = { Subtotal: calc.subtotal, 'Tax Total': calc.taxTotal, 'Grand Total': calc.grandTotal };
    const intents = [...new Set(calc.lines.map((l) => sstr(l['Intent No'])).filter(Boolean))];
    let no = id;
    if (!id) {
      no = await nextDocNo(ctx.store, t, date); row[t.idCol] = no;
      await ctx.store.append(t.tab, [row]);
      await ctx.store.append(DOC_STATUS_TAB, [{ 'Doc Type': PO, 'Document No.': no, Status: status, 'Created By': ctx.user.id, 'Created At': t0, 'Submitted At': wantSubmit ? t0 : '', 'Source Ref': intents.join(', '), Warehouse: loc, ...money, 'Updated At': t0 }]);
      await addHistory(ctx.store, { type: PO, no, event: 'Created', to: status, user: ctx.user, details: { lines: calc.lines.length, ...money } });
      if (wantSubmit) await addHistory(ctx.store, { type: PO, no, event: 'Submitted for authorization', from: PS.DRAFT, to: PS.PENDING, user: ctx.user });
    } else {
      const patch = { ...row }; delete patch[t.idCol];
      await ctx.store.updateRow(t.tab, existing.row.__row, patch, { col: t.idCol, val: id });
      await setStatus(ctx, existing.st, { Status: status, 'Source Ref': intents.join(', '), Warehouse: loc, ...money, ...(wantSubmit ? { 'Submitted At': t0 } : {}) }, { event: wantSubmit ? (existing.st.Status === PS.RETURNED ? 'Resubmitted for authorization' : 'Submitted for authorization') : 'Edited' });
    }
    if (overrideHist.length) await addHistory(ctx.store, { type: PO, no, event: 'Intent quantity override', user: ctx.user, remarks: override, details: overrideHist });
    await audit(ctx.store, { user: ctx.user, module: t.tab, doc: no, action: id ? 'Update' : 'Create', next: { status, ...money }, remarks: !id && idem ? `idem:${idem}` : '' });
    for (const i of intents) await refreshIntent(ctx, i);
    return getPo(ctx, no);
  });
}

export async function poAction(ctx, id, body) {
  const action = sstr(body?.action).toLowerCase(); const remarks = sstr(body?.remarks).slice(0, 1000);
  return withLock('stock', async () => {
    let t; for (const tt of poTables()) { const { rows } = await ctx.store.read(tt.tab, { fresh: true }); if (rows.some((r) => r[tt.idCol] === id)) { t = tt; break; } }
    if (!t) throw notFound('Purchase Order not found');
    const d = await findDoc(ctx, t, id); const c = poCan(ctx, d.st);
    if (!c[action]) throw forbidden(`You cannot ${action} PO ${id} (status: ${d.st.Status}${action === 'approve' && sameUser(d.st['Created By'], ctx.user.id) ? '; you created it, so another authoriser must approve it' : ''})`);
    const t0 = nowIso(); const oldStatus = d.st.Status; const intents = new Set(sstr(d.st['Source Ref']).split(',').map((x) => x.trim()).filter(Boolean));
    if (action === 'submit') {
      await ctx.store.updateRow(t.tab, d.row.__row, { 'Submit For Approval': 'Yes' }, { col: t.idCol, val: id });
      await setStatus(ctx, d.st, { Status: PS.PENDING, 'Submitted At': t0 }, { event: oldStatus === PS.RETURNED ? 'Resubmitted for authorization' : 'Submitted for authorization' });
    } else if (['approve', 'reject', 'return'].includes(action)) {
      if (action !== 'approve') need(remarks, 'Comments are required to reject or return a PO');
      let lines = d.lines; let money = null; const changes = [];
      if (action === 'approve' && Array.isArray(body.lines)) {
        // authoriser may change quantities or remove lines; originals are kept in the history
        const wanted = new Map(body.lines.map((l) => [toNum(l.lineNo), l]));
        const next = [];
        for (const l of d.lines) {
          const w = wanted.get(toNum(l['Line No']));
          if (!w || w.remove) { changes.push({ line: l['Line No'], item: l['Item Code'], from: l.Quantity, to: 0, removed: true }); continue; }
          const q = toNum(w.quantity ?? l.Quantity); need(q > 0, `Line ${l['Line No']}: quantity must be greater than zero (remove the line instead)`);
          if (q !== toNum(l.Quantity)) changes.push({ line: l['Line No'], item: l['Item Code'], from: toNum(l.Quantity), to: q });
          next.push({ ...l, Quantity: q });
        }
        need(next.length > 0, 'A PO must keep at least one line. Reject it instead.');
        if (changes.length) {
          const override = sstr(body.override?.reason); const hist = [];
          if (override && !can(ctx.user.role, 'po', 'approve')) throw forbidden();
          await checkIntentLines(ctx, next, { poNo: id, override, history: hist });
          if (hist.length) await addHistory(ctx.store, { type: PO, no: id, event: 'Intent quantity override', user: ctx.user, remarks: override, details: hist });
        }
        const hdr = { ...d.row };
        const calc = calcPoLines(t.poType, hdr, next); lines = calc.lines; money = { Subtotal: calc.subtotal, 'Tax Total': calc.taxTotal, 'Grand Total': calc.grandTotal };
        await ctx.store.updateRow(t.tab, d.row.__row, { Lines: JSON.stringify(lines) }, { col: t.idCol, val: id });
        for (const i of lines.map((l) => sstr(l['Intent No'])).filter(Boolean)) intents.add(i);
      }
      const status = action === 'approve' ? PS.APPROVED : action === 'reject' ? PS.REJECTED : PS.RETURNED;
      await setStatus(ctx, d.st, { Status: status, 'Reviewed By': ctx.user.id, 'Reviewed At': t0, 'Review Remarks': remarks, ...(money || {}) }, { event: action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Returned for correction', remarks, details: changes.length ? { authoriserChanges: changes } : '' });
    } else if (action === 'cancel') {
      need(remarks, 'Remarks are required to cancel a PO');
      await setStatus(ctx, d.st, { Status: PS.CANCELLED, 'Review Remarks': remarks }, { event: 'Cancelled', remarks });
    } else if (action === 'close') {
      need(remarks, 'Remarks are required to close a PO');
      await setStatus(ctx, d.st, { Status: PS.CLOSED, 'Review Remarks': remarks }, { event: 'Closed (short close)', remarks });
    } else throw bad('Unknown action');
    await audit(ctx.store, { user: ctx.user, module: t.tab, doc: id, action: `PO ${action}`, prev: { status: oldStatus }, remarks });
    for (const i of intents) await refreshIntent(ctx, i);
    return getPo(ctx, id);
  });
}

async function allPos(ctx, { fresh = false } = {}) {
  const st = await statusMap(ctx.store, { fresh }); const { received, grns } = await poReceived(ctx, { fresh });
  const out = [];
  for (const t of poTables()) {
    const { rows } = await ctx.store.read(t.tab, { fresh });
    for (const r of rows) {
      const s = st.get(`${PO}|${r[t.idCol]}`); if (!s) continue;
      const lines = parseLines(r.Lines); const bals = poLineBalances(r[t.idCol], lines, received);
      out.push({ t, r, s, lines, bals, grns: grns.get(r[t.idCol]) || [] });
    }
  }
  return out;
}
const poGrnStatus = (x) => (!x.bals.length ? '' : x.bals.every((b) => b.received <= 0) ? 'Not received' : x.bals.some((b) => b.balance > 1e-9) ? 'Partially received' : 'Fully received');

export async function listPos(ctx, q = {}) {
  if (!can(ctx.user.role, 'po', 'view')) throw forbidden();
  const view = sstr(q.view) || 'all';
  const sets = { 'pending-auth': [PS.PENDING], pending: [PS.APPROVED, PS.PART], approved: [PS.APPROVED, PS.PART, PS.DONE, PS.CLOSED], all: null, returned: [PS.RETURNED], draft: [PS.DRAFT] };
  if (!(view in sets)) throw bad('Unknown view');
  const wanted = sstr(q.status) ? sstr(q.status).split(',').map((x) => x.trim()) : sets[view];
  const needle = sstr(q.q).toLowerCase(); const list = [];
  for (const x of await allPos(ctx)) {
    const { r, s, lines, bals } = x; const t = x.t;
    if (wanted && !wanted.includes(s.Status)) continue;
    const d = normDate(r.Date); if ((q.from && d < q.from) || (q.to && d > q.to)) continue;
    if (q.vendor && !sstr(r['Vendor Account']).toLowerCase().includes(sstr(q.vendor).toLowerCase())) continue;
    if (q.type && sstr(q.type) !== t.poType) continue;
    const intents = [...new Set(lines.map((l) => sstr(l['Intent No'])).filter(Boolean))];
    if (q.intent && !intents.includes(sstr(q.intent))) continue;
    if (needle && !`${r[t.idCol]} ${r['Vendor Account']} ${intents.join(' ')} ${lines.map((l) => `${l['Item Code']} ${l.Items}`).join(' ')}`.toLowerCase().includes(needle)) continue;
    const ordered = round2(bals.reduce((a, b) => a + b.ordered, 0)), received = round2(bals.reduce((a, b) => a + b.received, 0));
    list.push({
      'Document No.': r[t.idCol], Date: d, 'PO Type': t.poType === 'import' ? 'Import' : 'Domestic', 'Vendor Account': r['Vendor Account'], 'Source Purchase Intent': intents.join(', '),
      'Item Summary': lines.slice(0, 2).map((l) => l.Items).join(', ') + (lines.length > 2 ? ` +${lines.length - 2} more` : ''), Lines: lines.length,
      'Total Quantity': ordered, 'Approved Quantity': ['Approved', 'Partially Received', 'Completed', 'Closed'].includes(s.Status) ? ordered : 0, 'Received Quantity': received, 'Balance Quantity': round2(Math.max(0, ordered - received)),
      'Grand Total': toNum(s['Grand Total']), 'Created By': s['Created By'], 'Submitted At': s['Submitted At'], Status: s.Status, 'GRN Status': poGrnStatus(x), 'GRN Count': x.grns.length,
      'Authorized By': s['Reviewed By'], 'Authorized At': s['Reviewed At'], Location: r.Location, actions: poCan(ctx, s),
    });
  }
  const dir = q.dir === 'asc' ? 1 : -1; const col = ['Document No.', 'Date', 'Vendor Account', 'Status', 'Grand Total'].includes(q.sort) ? q.sort : 'Date';
  list.sort((a, b) => dir * (typeof a[col] === 'number' ? a[col] - b[col] : String(a[col]).localeCompare(String(b[col]), undefined, { numeric: true })) || dir * a['Document No.'].localeCompare(b['Document No.']));
  if (q.export) return { rows: list, total: list.length };
  return paginate(list, q);
}

// Supplier block of the printed PO: Vendor Master row matched by Vendor Name or Sup ID.
async function vendorOf(store, account) {
  const a = sstr(account).toLowerCase();
  const { rows } = await store.read('Vendor Master');
  const v = rows.find((r) => sstr(r['Vendor Name']).toLowerCase() === a || sstr(r['Sup ID']).toLowerCase() === a);
  return { name: sstr(v?.['Vendor Name']) || sstr(account), code: sstr(v?.['Sup ID']), address: sstr(v?.Address), city: sstr(v?.City), pincode: sstr(v?.Pincode), state: sstr(v?.State), gstin: sstr(v?.GSTIN), drugLic: sstr(v?.['Drug Lic']), contact: sstr(v?.['Supp Contact']) };
}
async function companyOf(store) {
  const cfg = (await store.read('Configuration')).rows[0] || {};
  return { ...COMPANY, name: sstr(cfg['Company Name']) || COMPANY.name };
}

export async function getPo(ctx, id) {
  if (!can(ctx.user.role, 'po', 'view')) throw forbidden();
  const x = (await allPos(ctx, { fresh: true })).find((p) => p.r[p.t.idCol] === id);
  if (!x) throw notFound('Purchase Order not found');
  const stockOf = await currentStockMap(ctx); const loc = x.r.Location;
  const bals = new Map(x.bals.map((b) => [b.lineNo, b]));
  const lines = x.lines.map((l) => ({ ...l, 'Current Stock': stockOf(loc, l['Item Code']), 'Received Qty': bals.get(toNum(l['Line No']))?.received || 0, 'Balance Qty': bals.get(toNum(l['Line No']))?.balance ?? toNum(l.Quantity) }));
  const { __row, ...st } = x.s; void __row;
  const calc = calcPoLines(x.t.poType, x.r, x.lines);
  return {
    id, poType: x.t.poType, header: maskRow(ctx, x.r), vendor: await vendorOf(ctx.store, x.r['Vendor Account']), company: await companyOf(ctx.store), lines: maskLines(ctx, lines), status: st, totals: { subtotal: calc.subtotal, taxTotal: calc.taxTotal, grandTotal: calc.grandTotal },
    grns: x.grns, grnStatus: poGrnStatus(x), history: await historyOf(ctx, PO, id), can: poCan(ctx, x.s), defaultLocation: await defaultLocation(ctx.store),
  };
}

export async function poDefaults(ctx) {
  const def = await defaultLocation(ctx.store);
  const all = await warehouseList(ctx.store);
  const mine = ctx.user.scope.mode === 'assigned' ? ctx.user.scope.warehouses : null;
  const warehouses = mine ? all.filter((w) => mine.includes(w.toUpperCase())) : all;
  const location = mine ? (mine[0] || '') : def;
  // Only users who may pick between several warehouses see the field; a one-warehouse user is pre-filled and cannot change it.
  return { location, destination: location, canChooseWarehouse: mine ? mine.length > 1 : true, warehouses, note: 'Warehouse defaults to the signed-in user\'s assigned warehouse. Domestic PO: Destination always equals Location.' };
}

// Per-item helper data for the PO line grid: last PO rate, reorder level, brand, stock at a warehouse.
export async function poItemInfo(ctx, q = {}) {
  if (!can(ctx.user.role, 'po', 'view')) throw forbidden();
  const code = sstr(q.code); if (!code) throw bad('code is required');
  let last = null;
  for (const x of await allPos(ctx)) {
    const d = normDate(x.r.Date);
    for (const l of x.lines) if (sstr(l['Item Code']) === code && toNum(l.Rate) > 0 && (!last || d >= last.d)) last = { d, rate: toNum(l.Rate) };
  }
  const it = (await itemCatalog(ctx.store)).get(code) || {};
  const stockOf = await currentStockMap(ctx);
  return { lastRate: last?.rate || 0, reorderLevel: it.minStock || 0, brand: it.brand || '', unit: it.unit || '', currentStock: stockOf(sstr(q.warehouse), code) };
}

// POs a GRN can be raised against.
export async function openPos(ctx, q = {}) {
  if (!can(ctx.user.role, 'grn', 'create')) throw forbidden();
  const needle = sstr(q.q).toLowerCase(); const out = [];
  for (const x of await allPos(ctx, { fresh: true })) {
    if (!PO_OPEN_FOR_GRN.has(x.s.Status)) continue;
    const dest = sstr(x.r.Destination || x.r.Location);
    if (ctx.user.scope.mode === 'assigned' && !inScope(ctx, dest)) continue;
    if (needle && !`${x.r[x.t.idCol]} ${x.r['Vendor Account']}`.toLowerCase().includes(needle)) continue;
    const bm = new Map(x.bals.map((b) => [b.lineNo, b]));
    out.push({
      'Document No.': x.r[x.t.idCol], Date: normDate(x.r.Date), 'Vendor Account': x.r['Vendor Account'], 'Type Of Purchase': x.r['Type Of Purchase'], Warehouse: dest, Status: x.s.Status, 'Source Purchase Intent': sstr(x.s['Source Ref']),
      lines: x.lines.map((l) => ({ poLine: toNum(l['Line No']), itemCode: l['Item Code'], items: l.Items, description: l.Description, units: l.Units, rate: toNum(l.Rate), ordered: bm.get(toNum(l['Line No'])).ordered, received: bm.get(toNum(l['Line No'])).received, balance: bm.get(toNum(l['Line No'])).balance })).filter((l) => l.balance > 0),
    });
  }
  return { rows: out };
}

// ---- GRN integration (used as hooks by the generic create path) ---------------------------------------------------------
export function grnHooks(ctx) {
  let poNo = '';
  return {
    async rawBody(body) {
      poNo = sstr(body?.header?.['Supplier Ref No']);
      if (!poNo) return body; // direct receipt (no PO) keeps the existing GRN behaviour
      const x = (await allPos(ctx, { fresh: true })).find((p) => p.r[p.t.idCol] === poNo);
      if (!x) throw unprocessable(`PO ${poNo} was not found`);
      if (!PO_OPEN_FOR_GRN.has(x.s.Status)) throw unprocessable(`PO ${poNo} is "${x.s.Status}". Goods can be received only against an Approved or Partially Received PO.`);
      const dest = sstr(x.r.Destination || x.r.Location);
      const header = { ...body.header, 'Supplier Ref No': poNo, 'Vendor Account': x.r['Vendor Account'], 'Type Of Purchase': x.r['Type Of Purchase'] || body.header['Type Of Purchase'], Warehouse: dest, 'Update Stock': 'Yes' };
      if (body.header.Warehouse && sstr(body.header.Warehouse).toUpperCase() !== dest.toUpperCase()) throw unprocessable(`PO ${poNo} is destined for ${dest}; the GRN warehouse must match`);
      const bm = new Map(x.bals.map((b) => [b.lineNo, b])); const lm = new Map(x.lines.map((l) => [toNum(l['Line No']), l]));
      const take = new Map(); const lines = [];
      for (const [i, l] of (body.lines || []).entries()) {
        const n = toNum(l['PO Line']); const pl = lm.get(n);
        if (!pl) throw unprocessable(`Line ${i + 1}: PO ${poNo} has no line ${l['PO Line']}`);
        const rec = toNum(l['Received Qty']), rej = toNum(l['Rejected / Damaged Qty']);
        need(rec > 0, `Line ${i + 1}: Received Qty must be greater than zero`); need(rej >= 0 && rej <= rec, `Line ${i + 1}: rejected quantity cannot exceed received quantity`);
        const acc = round2(rec - rej); take.set(n, (take.get(n) || 0) + acc);
        if (take.get(n) > bm.get(n).balance + 1e-9) throw unprocessable(`Line ${i + 1} (${pl['Item Code']}): receiving ${take.get(n)} exceeds the PO balance ${bm.get(n).balance}`);
        lines.push({ ...l, 'PO Line': n, 'Item Code': pl['Item Code'], Items: pl.Items, Description: pl.Description || pl.Items, ['Ordered Qty']: toNum(pl.Quantity), 'Received Qty': rec, 'Rejected / Damaged Qty': rej, 'Accepted Qty': acc, Quantity: rec, Rate: toNum(pl.Rate) });
      }
      return { ...body, header, lines };
    },
    async after() { if (poNo) await refreshPoReceipt(ctx, poNo); },
  };
}

// ---- dashboard counts ----------------------------------------------------------------------------------------------------------
export async function workflowCounts(ctx, { from, to, warehouse } = {}) {
  const out = {};
  const wf = sstr(warehouse).toUpperCase();
  if (can(ctx.user.role, 'intent', 'view')) {
    const st = await statusMap(ctx.store); const { rows } = await ctx.store.read('Purchase Indent'); const c = { pendingReview: 0, approved: 0, total: 0 };
    for (const r of rows) {
      const s = st.get(`${INTENT}|${r['Document No.']}`); if (!s) continue;
      if (ctx.user.scope.mode === 'assigned' && !inScope(ctx, r['Requesting Warehouse'])) continue;
      if (wf && sstr(r['Requesting Warehouse']).toUpperCase() !== wf) continue;
      const d = normDate(r.Date); if ((from && d < from) || (to && d > to)) continue;
      c.total++; if (s.Status === IS.PENDING) c.pendingReview++; if ([IS.APPROVED, IS.PART].includes(s.Status)) c.approved++;
    }
    out.intents = c;
  }
  if (can(ctx.user.role, 'po', 'view')) {
    const c = { pendingAuthorization: 0, approved: 0, pending: 0, total: 0, value: 0 };
    for (const x of await allPos(ctx)) {
      const d = normDate(x.r.Date); if ((from && d < from) || (to && d > to)) continue;
      if (wf && sstr(x.r.Location).toUpperCase() !== wf) continue;
      c.total++; const s = x.s.Status;
      if (s === PS.PENDING) c.pendingAuthorization++;
      if ([PS.APPROVED, PS.PART, PS.DONE, PS.CLOSED].includes(s)) { c.approved++; c.value = round2(c.value + toNum(x.s['Grand Total'])); }
      if ([PS.APPROVED, PS.PART].includes(s)) c.pending++;
    }
    out.pos = c;
  }
  if (can(ctx.user.role, 'grn', 'view')) {
    const { rows } = await ctx.store.read('GRN  MRN'); let n = 0, linked = 0;
    for (const r of rows) { const d = normDate(r.Date); if ((from && d < from) || (to && d > to)) continue; if (ctx.user.scope.mode === 'assigned' && !inScope(ctx, r.Warehouse)) continue; if (wf && sstr(r.Warehouse).toUpperCase() !== wf) continue; n++; if (sstr(r['Supplier Ref No'])) linked++; }
    out.grns = { created: n, againstPo: linked };
  }
  return out;
}
