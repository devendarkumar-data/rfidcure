// Purchase Requisition = INTERNAL stock replenishment: an operating warehouse asks the Mother Warehouse for stock.
// It is not a vendor purchase. Flow: Draft -> Pending Approval -> Approved -> (Partially) Dispatched -> (Partially) Received.
// Stock moves only at dispatch and receipt, through an in-transit location "TRANSIT-<requesting warehouse>":
//   dispatch: Mother Warehouse  -> TRANSIT-DWH   (physical stock leaves the Mother Warehouse immediately)
//   receipt : TRANSIT-DWH       -> DWH           (the same batches, once the receiving warehouse confirms)
// Dispatched / received quantities are never stored; they are recomputed from the Stock Ledger so they cannot drift.
import { TABLE_BY_TAB, DOC_STATUS_TAB } from '../shared/registry.js';
import { can } from '../shared/permissions.js';
import { assertWarehouses, inScope, maskLines, maskRow, parseLines } from './access.js';
import { audit } from './audit.js';
import { itemCatalog, nextDocNo, stripInternal, validateHeader, validateLines } from './crud.js';
import { StockView, findNegatives, loadStock } from './stock.js';
import { addHistory, currentStockMap, defaultLocation, findIdemDoc, historyOf, isAdmin, isSuper, need, nowIso, paginate, sameUser, setStatus, statusMap } from './workflow.js';
import { HttpError, bad, conflict, forbidden, normDate, notFound, round2, sstr, today, toNum, unprocessable, withLock } from './util.js';

export const REQ = 'Purchase Requisition';
export const RS = { DRAFT: 'Draft', PENDING: 'Pending Approval', APPROVED: 'Approved', PDISP: 'Partially Dispatched', DISP: 'Dispatched', PREC: 'Partially Received', REC: 'Received', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const FLOW = new Set([RS.APPROVED, RS.PDISP, RS.DISP, RS.PREC]); // statuses driven by the ledger
const table = () => TABLE_BY_TAB[REQ];
export const transitOf = (wh) => `TRANSIT-${sstr(wh).toUpperCase()}`;
export const isTransit = (wh) => /^TRANSIT-/i.test(sstr(wh));
const EPS = 1e-9;

// ---- ledger-derived movement for requisitions -----------------------------------------------------------------------
async function movements(ctx, { fresh = true } = {}) {
  const { rows } = await ctx.store.read('Stock Ledger', { fresh });
  const by = new Map();
  for (const r of rows) {
    const doc = sstr(r.Doc); if (!doc.startsWith('PR/') || !isTransit(r.Warehouse)) continue;
    const m = by.get(doc) || by.set(doc, { disp: new Map(), out: new Map(), batches: new Map() }).get(doc);
    const code = sstr(r['Item Code']); const q = toNum(r.Quantity); const type = sstr(r.Type);
    const bk = `${code}|${sstr(r['Batch Number'])}`;
    const b = m.batches.get(bk) || m.batches.set(bk, { code, batch: sstr(r['Batch Number']), expiry: normDate(r['Expiry Date']), rate: toNum(r.Rate), qty: 0 }).get(bk);
    b.qty = Math.round((b.qty + q) * 1e6) / 1e6; // net still in transit
    if (type === 'Requisition Dispatch' || (type === 'Reversal' && q < 0)) m.disp.set(code, (m.disp.get(code) || 0) + q);
  }
  for (const m of by.values()) {
    for (const [code, d] of m.disp) {
      const outstanding = [...m.batches.values()].filter((b) => b.code === code).reduce((s, b) => s + b.qty, 0);
      m.out.set(code, { dispatched: round2(d), received: round2(d - outstanding), inTransit: round2(outstanding) });
    }
  }
  return by;
}
const lineMv = (mv, code) => mv?.out.get(code) || { dispatched: 0, received: 0, inTransit: 0 };

// status from approved / dispatched / received totals
function flowStatus(lines, mv) {
  let A = 0, D = 0, R = 0;
  for (const l of lines) { const a = toNum(l['Approved Qty']); const m = lineMv(mv, l['Item Code']); A += a; D += Math.min(m.dispatched, a); R += Math.min(m.received, a); }
  if (A > 0 && R >= A - EPS) return RS.REC;
  if (R > EPS) return RS.PREC;
  if (A > 0 && D >= A - EPS) return RS.DISP;
  if (D > EPS) return RS.PDISP;
  return RS.APPROVED;
}
const statusOf = (st, lines, mv) => (FLOW.has(st.Status) ? flowStatus(lines, mv) : st.Status);

async function findReq(ctx, id) {
  const t = table();
  const { rows } = await ctx.store.read(t.tab, { fresh: true });
  const row = rows.find((r) => sstr(r[t.idCol]) === sstr(id));
  if (!row) throw notFound('Requisition not found');
  const st = (await statusMap(ctx.store, { fresh: true })).get(`${REQ}|${id}`);
  if (!st) throw new HttpError(500, `Workflow status for ${id} is missing in the "Doc Status" sheet`);
  return { row, st, lines: parseLines(row.Lines) };
}
const visible = (ctx, row) => ctx.user.scope.mode !== 'assigned' || inScope(ctx, row['Requesting Warehouse']) || inScope(ctx, row['Issuing Warehouse']);

function reqCan(ctx, row, st, lines, mv) {
  const status = statusOf(st, lines, mv); const mine = sameUser(st['Created By'], ctx.user.id);
  const ro = ctx.user.scope.mode === 'all-readonly';
  const has = (a) => can(ctx.user.role, 'requisition', a) && !ro;
  const atIssuer = inScope(ctx, row['Issuing Warehouse']); const atRequester = inScope(ctx, row['Requesting Warehouse']);
  let remaining = 0, outstanding = 0;
  for (const l of lines) { const m = lineMv(mv, l['Item Code']); remaining += Math.max(0, toNum(l['Approved Qty']) - m.dispatched); outstanding += m.inTransit; }
  const decide = has('approve') && status === RS.PENDING && (!mine || isSuper(ctx)) && atIssuer;
  return {
    edit: has('edit') && status === RS.DRAFT && (mine || isAdmin(ctx)) && (atRequester || isAdmin(ctx)),
    submit: has('edit') && status === RS.DRAFT && (mine || isAdmin(ctx)),
    approve: decide, reject: decide,
    cancel: !ro && [RS.DRAFT, RS.PENDING, RS.APPROVED].includes(status) && (mine || isAdmin(ctx) || (has('approve') && atIssuer)) && (status !== RS.APPROVED || outstanding + lines.reduce((s, l) => s + lineMv(mv, l['Item Code']).dispatched, 0) <= EPS),
    dispatch: has('edit') && [RS.APPROVED, RS.PDISP, RS.PREC].includes(status) && atIssuer && remaining > EPS,
    receive: (has('create') || has('edit')) && outstanding > EPS && atRequester,
  };
}

// ---- posting helper (same safety net as the generic documents: verify, compensate on conflict) -------------------------
async function postView(ctx, view) {
  if (!view.entries.length) return;
  const { store } = ctx;
  await store.append('Stock Ledger', view.ledgerRows(ctx.user.id));
  const neg = await findNegatives(store, view.touchedKeys());
  if (neg.length) {
    await store.append('Stock Ledger', view.entries.map((x) => ({ Date: x.date, Type: 'Reversal', Doc: x.doc, Warehouse: x.warehouse, 'Item Code': x.code, 'Item Name': x.name, 'Batch Number': x.batch, 'Expiry Date': x.expiry, Quantity: -x.qty, Rate: x.rate, User: ctx.user.id })));
    throw conflict('Stock changed while saving (another user posted at the same time). Nothing was posted - please retry.');
  }
}

// ---- save (create / edit draft) ---------------------------------------------------------------------------------------
export async function saveReq(ctx, body, id, idem) {
  const t = table();
  if (!can(ctx.user.role, 'requisition', id ? 'edit' : 'create')) throw forbidden('Your role cannot raise Purchase Requisitions');
  if (ctx.user.scope.mode === 'all-readonly') throw forbidden('Your account is read-only');
  return withLock('stock', async () => {
    if (!id) { const prev = await findIdemDoc(ctx, t.tab, idem); if (prev) return { ...(await getReq(ctx, prev)), duplicate: true }; }
    const hdr = { ...(body?.header || {}) }; delete hdr[t.idCol];
    hdr['Issuing Warehouse'] = sstr(hdr['Issuing Warehouse']) || await defaultLocation(ctx.store);
    const header = await validateHeader(ctx, t, hdr);
    need(header['Requesting Warehouse'], 'Select the requesting warehouse');
    if (sstr(header['Requesting Warehouse']).toUpperCase() === sstr(header['Issuing Warehouse']).toUpperCase()) throw bad('The requesting warehouse and the issuing (Mother) warehouse must be different');
    assertWarehouses(ctx, [header['Requesting Warehouse']], 'warehouse');
    const stock = await loadStock(ctx.store, { fresh: true });
    const catalog = await itemCatalog(ctx.store, stock);
    const clean = (Array.isArray(body?.lines) ? body.lines : []).map((l) => Object.fromEntries(Object.entries(l || {}).filter(([k]) => !['Dispatched Qty', 'Received Qty', 'In Transit', 'Remaining Qty', 'Shortage'].includes(k))));
    let lines = await validateLines(ctx, t, clean, catalog, { strictItems: true });
    let existing = null;
    if (id) { existing = await findReq(ctx, id); if (!reqCan(ctx, existing.row, existing.st, existing.lines, null).edit) throw conflict(`Requisition ${id} cannot be edited in status "${existing.st.Status}"`); }
    const seen = new Set(); const stockOf = await currentStockMap(ctx);
    let n = 0;
    lines = lines.map((l, i) => {
      need(toNum(l.Quantity) > 0, `Line ${i + 1}: required quantity must be greater than zero`);
      if (seen.has(l['Item Code'])) throw bad(`Line ${i + 1}: ${l['Item Code']} is already on this requisition - combine the quantities`);
      seen.add(l['Item Code']);
      return { ...l, 'Line No': ++n, 'Current Stock': stockOf(header['Requesting Warehouse'], l['Item Code']), 'Mother Stock': stockOf(header['Issuing Warehouse'], l['Item Code']), 'Approved Qty': '' };
    });
    const date = header.Date || today(); const wantSubmit = !!body?.submit; const status = wantSubmit ? RS.PENDING : RS.DRAFT; const t0 = nowIso();
    const row = { ...header, Lines: JSON.stringify(stripInternal(lines)) };
    if (!id) {
      const no = await nextDocNo(ctx.store, t, date); row[t.idCol] = no;
      await ctx.store.append(t.tab, [row]);
      await ctx.store.append(DOC_STATUS_TAB, [{ 'Doc Type': REQ, 'Document No.': no, Status: status, 'Created By': ctx.user.id, 'Created At': t0, 'Submitted At': wantSubmit ? t0 : '', Warehouse: header['Requesting Warehouse'], 'Updated At': t0 }]);
      await addHistory(ctx.store, { type: REQ, no, event: 'Created', to: status, user: ctx.user, details: { lines: lines.length } });
      if (wantSubmit) await addHistory(ctx.store, { type: REQ, no, event: 'Submitted', from: RS.DRAFT, to: RS.PENDING, user: ctx.user });
      await audit(ctx.store, { user: ctx.user, module: t.tab, doc: no, action: 'Create', next: { status, lines: lines.length }, remarks: idem ? `idem:${idem}` : '' });
      return getReq(ctx, no);
    }
    const patch = { ...row }; delete patch[t.idCol];
    await ctx.store.updateRow(t.tab, existing.row.__row, patch, { col: t.idCol, val: id });
    await setStatus(ctx, existing.st, { Status: status, Warehouse: header['Requesting Warehouse'], ...(wantSubmit ? { 'Submitted At': t0 } : {}) }, { event: wantSubmit ? 'Submitted' : 'Edited' });
    await audit(ctx.store, { user: ctx.user, module: t.tab, doc: id, action: 'Update', next: { status, lines: lines.length } });
    return getReq(ctx, id);
  });
}

// ---- actions ----------------------------------------------------------------------------------------------------------
export async function reqAction(ctx, id, body) {
  const t = table(); const action = sstr(body?.action).toLowerCase(); const remarks = sstr(body?.remarks).slice(0, 1000);
  return withLock('stock', async () => {
    const d = await findReq(ctx, id);
    if (!visible(ctx, d.row)) throw notFound('Requisition not found');
    const mvAll = await movements(ctx); const mv = mvAll.get(id);
    const c = reqCan(ctx, d.row, d.st, d.lines, mv);
    if (!c[action]) throw forbidden(`You cannot ${action} requisition ${id} (status: ${statusOf(d.st, d.lines, mv)})`);
    const t0 = nowIso(); const date = today(); const old = statusOf(d.st, d.lines, mv);
    const issuing = sstr(d.row['Issuing Warehouse']).toUpperCase(); const requesting = sstr(d.row['Requesting Warehouse']).toUpperCase(); const transit = transitOf(requesting);
    if (action === 'submit') {
      await setStatus(ctx, d.st, { Status: RS.PENDING, 'Submitted At': t0 }, { event: 'Submitted' });
    } else if (action === 'approve' || action === 'reject') {
      if (action === 'reject') need(remarks, 'Remarks are required to reject a requisition');
      const lines = d.lines.slice();
      if (action === 'approve') {
        const asked = new Map((body.lines || []).map((l) => [toNum(l.lineNo), l.approvedQty]));
        for (const l of lines) {
          const req = toNum(l.Quantity); const a = asked.has(toNum(l['Line No'])) ? toNum(asked.get(toNum(l['Line No']))) : req;
          if (a < 0 || a > req + EPS) throw bad(`Line ${l['Line No']}: approved quantity must be between 0 and the requested ${req}`);
          l['Approved Qty'] = a;
        }
        need(lines.some((l) => toNum(l['Approved Qty']) > 0), 'Approve at least one line, or reject the requisition');
        await ctx.store.updateRow(t.tab, d.row.__row, { Lines: JSON.stringify(lines) }, { col: t.idCol, val: id });
      }
      const status = action === 'approve' ? RS.APPROVED : RS.REJECTED;
      await setStatus(ctx, d.st, { Status: status, 'Reviewed By': ctx.user.id, 'Reviewed At': t0, 'Review Remarks': remarks }, { event: action === 'approve' ? 'Approved' : 'Rejected', remarks, details: action === 'approve' ? lines.map((l) => ({ line: l['Line No'], requested: l.Quantity, approved: l['Approved Qty'] })) : '' });
    } else if (action === 'cancel') {
      need(remarks, 'Remarks are required to cancel a requisition');
      await setStatus(ctx, d.st, { Status: RS.CANCELLED, 'Review Remarks': remarks }, { event: 'Cancelled', remarks });
    } else if (action === 'dispatch' || action === 'receive') {
      const stock = await loadStock(ctx.store, { fresh: true }); const view = new StockView(stock.balances);
      const asked = new Map((body.lines || []).map((l) => [toNum(l.lineNo), l])); const detail = [];
      for (const l of d.lines) {
        const code = l['Item Code']; const m = lineMv(mv, code); const label = `${code} (${l.Items})`;
        const given = asked.get(toNum(l['Line No']));
        if (body.lines && !given) continue;
        if (action === 'dispatch') {
          const remaining = round2(toNum(l['Approved Qty']) - m.dispatched);
          if (remaining <= EPS) continue;
          const qty = given && given.quantity !== undefined && given.quantity !== '' ? toNum(given.quantity) : remaining;
          if (qty <= 0) continue;
          if (qty > remaining + EPS) throw unprocessable(`${label}: dispatching ${qty} exceeds the approved balance ${remaining}`);
          const allocs = view.out({ wh: issuing, code, name: l.Items, qty, batch: sstr(given?.batch), date, type: 'Requisition Dispatch', doc: id, label });
          for (const a of allocs) view.in({ wh: transit, code, name: l.Items, qty: a.qty, batch: a.batch, expiry: a.expiry, rate: a.rate, date, type: 'Requisition Dispatch', doc: id, label });
          detail.push({ line: l['Line No'], item: code, qty, batches: allocs.map((a) => `${a.batch}:${a.qty}`) });
        } else {
          const outstanding = m.inTransit; if (outstanding <= EPS) continue;
          const qty = given && given.quantity !== undefined && given.quantity !== '' ? toNum(given.quantity) : outstanding;
          if (qty <= 0) continue;
          if (qty > outstanding + EPS) throw unprocessable(`${label}: receiving ${qty} exceeds the quantity in transit ${outstanding}`);
          let left = qty; const bs = [...(mv?.batches.values() || [])].filter((b) => b.code === code && b.qty > EPS).sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999') || a.batch.localeCompare(b.batch));
          for (const b of bs) {
            if (left <= EPS) break; const take = Math.min(left, b.qty); left = Math.round((left - take) * 1e6) / 1e6;
            view.out({ wh: transit, code, name: l.Items, qty: take, batch: b.batch, date, type: 'Requisition Receive', doc: id, label });
            view.in({ wh: requesting, code, name: l.Items, qty: take, batch: b.batch, expiry: b.expiry, rate: b.rate, date, type: 'Requisition Receive', doc: id, label });
          }
          detail.push({ line: l['Line No'], item: code, qty });
        }
      }
      need(detail.length > 0, action === 'dispatch' ? 'Nothing to dispatch' : 'Nothing to receive');
      await postView(ctx, view);
      const after = (await movements(ctx)).get(id);
      const status = flowStatus(d.lines, after);
      await setStatus(ctx, d.st, { Status: status }, { event: action === 'dispatch' ? 'Dispatched' : 'Received', remarks, details: { lines: detail, warnings: view.warnings } });
    } else throw bad('Unknown action');
    await audit(ctx.store, { user: ctx.user, module: t.tab, doc: id, action: `Requisition ${action}`, prev: { status: old }, remarks });
    return getReq(ctx, id);
  });
}

// ---- reads ------------------------------------------------------------------------------------------------------------
export async function getReq(ctx, id) {
  if (!can(ctx.user.role, 'requisition', 'view')) throw forbidden();
  const d = await findReq(ctx, id);
  if (!visible(ctx, d.row)) throw notFound('Requisition not found');
  const mv = (await movements(ctx)).get(id); const stockOf = await currentStockMap(ctx);
  const issuing = d.row['Issuing Warehouse']; const requesting = d.row['Requesting Warehouse'];
  const lines = d.lines.map((l) => {
    const m = lineMv(mv, l['Item Code']); const approved = toNum(l['Approved Qty']); const mother = stockOf(issuing, l['Item Code']);
    const need = FLOW.has(d.st.Status) ? Math.max(0, approved - m.dispatched) : toNum(l.Quantity);
    return { ...l, 'Current Stock': stockOf(requesting, l['Item Code']), 'Mother Stock': mother, 'Dispatched Qty': m.dispatched, 'Received Qty': m.received, 'In Transit': m.inTransit, 'Remaining Qty': Math.max(0, round2(approved - m.dispatched)), Shortage: need > mother + EPS ? round2(need - mother) : 0 };
  });
  const status = statusOf(d.st, d.lines, mv); const { __row, ...st } = d.st; void __row;
  return { id, header: maskRow(ctx, d.row), lines: maskLines(ctx, lines), status: { ...st, Status: status }, transit: transitOf(requesting), history: await historyOf(ctx, REQ, id), can: reqCan(ctx, d.row, d.st, d.lines, mv) };
}

export async function listReqs(ctx, q = {}) {
  if (!can(ctx.user.role, 'requisition', 'view')) throw forbidden();
  const t = table();
  const [{ rows }, st, mvAll] = await Promise.all([ctx.store.read(t.tab), statusMap(ctx.store), movements(ctx, { fresh: false })]);
  const views = { pending: [RS.PENDING], open: [RS.APPROVED, RS.PDISP, RS.DISP, RS.PREC], all: null, draft: [RS.DRAFT] };
  const view = sstr(q.view) || 'all'; if (!(view in views)) throw bad('Unknown view');
  const wanted = sstr(q.status) ? sstr(q.status).split(',').map((x) => x.trim()) : views[view];
  const needle = sstr(q.q).toLowerCase(); const list = [];
  for (const r of rows) {
    const s = st.get(`${REQ}|${r['Document No.']}`); if (!s) continue;
    if (!visible(ctx, r)) continue;
    const lines = parseLines(r.Lines); const mv = mvAll.get(r['Document No.']); const status = statusOf(s, lines, mv);
    if (wanted && !wanted.includes(status)) continue;
    if (q.warehouse && ![r['Requesting Warehouse'], r['Issuing Warehouse']].some((w) => sstr(w).toUpperCase() === sstr(q.warehouse).toUpperCase())) continue;
    const d = normDate(r.Date); if ((q.from && d < q.from) || (q.to && d > q.to)) continue;
    if (q.item && !lines.some((l) => `${l['Item Code']} ${l.Items}`.toLowerCase().includes(sstr(q.item).toLowerCase()))) continue;
    if (needle && !`${r['Document No.']} ${r['Requesting Warehouse']} ${s['Created By']} ${lines.map((l) => `${l['Item Code']} ${l.Items}`).join(' ')}`.toLowerCase().includes(needle)) continue;
    const sum = (f) => round2(lines.reduce((a, l) => a + f(l), 0));
    list.push({
      'Document No.': r['Document No.'], Date: d, 'Requesting Warehouse': r['Requesting Warehouse'], 'Issuing Warehouse': r['Issuing Warehouse'], Priority: r.Priority, Status: status, 'Requested By': s['Created By'], 'Reviewed By': s['Reviewed By'],
      Lines: lines.length, 'Total Requested': sum((l) => toNum(l.Quantity)), 'Total Approved': sum((l) => toNum(l['Approved Qty'])),
      'Total Dispatched': sum((l) => lineMv(mv, l['Item Code']).dispatched), 'Total Received': sum((l) => lineMv(mv, l['Item Code']).received),
      'Item Summary': lines.slice(0, 2).map((l) => l.Items).join(', ') + (lines.length > 2 ? ` +${lines.length - 2} more` : ''), 'Submitted At': s['Submitted At'], actions: reqCan(ctx, r, s, lines, mv),
    });
  }
  const dir = q.dir === 'asc' ? 1 : -1; const col = ['Document No.', 'Date', 'Requesting Warehouse', 'Status', 'Priority'].includes(q.sort) ? q.sort : 'Date';
  list.sort((a, b) => dir * String(a[col]).localeCompare(String(b[col]), undefined, { numeric: true }) || dir * a['Document No.'].localeCompare(b['Document No.']));
  if (q.export) return { rows: list, total: list.length };
  return paginate(list, q);
}

export async function reqCounts(ctx, { from, to, warehouse } = {}) {
  if (!can(ctx.user.role, 'requisition', 'view')) return undefined;
  const r = await listReqs(ctx, { export: 1, from, to, warehouse });
  return { pendingApproval: r.rows.filter((x) => x.Status === RS.PENDING).length, open: r.rows.filter((x) => [RS.APPROVED, RS.PDISP, RS.DISP, RS.PREC].includes(x.Status)).length, total: r.rows.length };
}
