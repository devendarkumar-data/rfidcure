import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';

const L = (code, qty, extra = {}) => ({ 'Item Code': code, Quantity: qty, ...extra });
const stockOf = async (c, wh, code) => (await c('GET', `/api/stock/balances?pageSize=200&showZero=1&warehouse=${wh}`)).json.rows.filter((r) => r['Item Code'] === code).reduce((s, r) => s + r.Quantity, 0);

test('Purchase Intent -> PO authorization -> GRN workflow', async (t) => {
  const app = await makeApp(); t.after(app.close);
  // dedicated users for the new roles
  for (const [id, name, role, branch] of [['pm', 'Purchase Mgr', 'Purchase Manager', ''], ['pm2', 'Purchase Mgr 2', 'Purchase Manager', ''], ['op', 'Operator', 'Warehouse Operator', 'MWH'], ['op2', 'Operator Delhi', 'Warehouse Operator', 'DWH']]) {
    await app.store.append('Users', [{ 'User ID': id, 'User Name': name, Role: role, Branch: branch, Status: 'Active' }]);
    await app.store.append('Credentials', [{ 'User ID': id, Email: '', 'Password Hash': (await app.store.read('Credentials')).rows[0]['Password Hash'], 'Must Change Password': 'No', 'Failed Attempts': 0, 'Locked Until': '', 'Password Updated': '2026-01-01T00:00:00.000Z' }]);
  }
  const op = await app.as('op'), op2 = await app.as('op2'), pm = await app.as('pm'), pm2 = await app.as('pm2'), sa = await app.as('sa'), wm = await app.as('wm'), au = await app.as('au');
  const ctx = {};
  const mkIntent = (c, lines, submit = true) => c('POST', '/api/wf/intents', { header: { Date: '2026-10-26', 'Requesting Warehouse': 'MWH', Companies: 'Cure' }, lines, submit }, { 'idempotency-key': `i${Math.random().toString(16).slice(2)}abcd` });

  await t.test('B: operator creates + submits an intent; manager sees it pending; stock unchanged', async () => {
    const before = await stockOf(sa, 'MWH', 'A1');
    const r = await mkIntent(op, [{ 'Item Code': 'A1', Quantity: 20, 'Required By Date': '2026-11-15', Priority: 'High', Reason: 'Low stock', Units: 'Nos' }, { 'Item Code': 'C3', Quantity: 5, Units: 'Nos' }]);
    assert.equal(r.status, 201, r.text); ctx.intent = r.json.id; assert.match(ctx.intent, /^PI\/26-27\/00001$/);
    assert.equal(r.json.status.Status, 'Pending Review');
    assert.equal(r.json.lines[0]['Current Stock'], 19);
    const pend = await pm('GET', '/api/wf/intents?status=Pending Review'); assert.equal(pend.json.total, 1);
    assert.equal(await stockOf(sa, 'MWH', 'A1'), before);
  });
  await t.test('operator cannot see / edit other warehouses; cannot approve own intent', async () => {
    assert.equal((await op2('GET', '/api/wf/intents')).json.total, 0);
    assert.equal((await op2('GET', `/api/wf/intents/get?id=${encodeURIComponent(ctx.intent)}`)).status, 404);
    assert.equal((await op('POST', `/api/wf/intents/action?id=${encodeURIComponent(ctx.intent)}`, { action: 'approve' })).status, 403);
    assert.equal((await op('POST', '/api/wf/intents', { header: { Date: '2026-10-26', 'Requesting Warehouse': 'DWH' }, lines: [L('A1', 1)] })).status, 403);
  });
  await t.test('return for correction needs remarks; operator edits and resubmits', async () => {
    const q = `?id=${encodeURIComponent(ctx.intent)}`;
    assert.equal((await pm('POST', '/api/wf/intents/action' + q, { action: 'return' })).status, 400);
    const r = await pm('POST', '/api/wf/intents/action' + q, { action: 'return', remarks: 'Reduce quantity' });
    assert.equal(r.json.status.Status, 'Returned for Correction');
    const got = await op('GET', '/api/wf/intents/get' + q); assert.equal(got.json.can.edit, true);
    const lines = got.json.lines.map((l) => ({ ...l, Quantity: l['Item Code'] === 'A1' ? 10 : l.Quantity }));
    const e = await op('PUT', '/api/wf/intents' + q, { header: { Date: '2026-10-26', 'Requesting Warehouse': 'MWH' }, lines, submit: true });
    assert.equal(e.status, 200, e.text); assert.equal(e.json.status.Status, 'Pending Review');
    assert.ok(e.json.history.some((h) => h.Event === 'Returned for correction' && h.Remarks === 'Reduce quantity'));
  });
  await t.test('manager approves with a reduced approved quantity', async () => {
    const q = `?id=${encodeURIComponent(ctx.intent)}`;
    assert.equal((await pm('POST', '/api/wf/intents/action' + q, { action: 'approve', lines: [{ lineNo: 1, approvedQty: 11 }] })).status, 400);
    const r = await pm('POST', '/api/wf/intents/action' + q, { action: 'approve', lines: [{ lineNo: 1, approvedQty: 8 }, { lineNo: 2, approvedQty: 5 }] });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.status.Status, 'Approved'); assert.equal(r.json.status['Reviewed By'], 'pm');
    assert.equal(r.json.lines[0]['Remaining Qty'], 8);
  });

  const poBody = (lines, extra = {}) => ({ poType: 'domestic', header: { Date: '2026-10-27', 'Vendor Account': 'Acme Surgicals', 'Is IGST': 'No', 'Payment Terms': '30 days', ...extra }, lines });
  await t.test('C: approved intent -> Draft PO; Domestic defaults; quantity cannot exceed remaining; no duplicate conversion', async () => {
    const open = await pm('GET', '/api/wf/intents/open'); assert.equal(open.json.rows.length, 1);
    const line = (n, code, qty, rate) => ({ 'Item Code': code, Quantity: qty, Rate: rate, 'GST %': 12, Units: 'Nos', 'Intent No': ctx.intent, 'Intent Line': n });
    const over = await pm('POST', '/api/wf/pos', poBody([line(1, 'A1', 9, 100)]));
    assert.equal(over.status, 422); assert.match(over.json.error, /exceeds the remaining approved quantity 8/);
    const r = await pm('POST', '/api/wf/pos', { ...poBody([line(1, 'A1', 5, 100), line(2, 'C3', 5, 40)]), submit: false }, { 'idempotency-key': 'po-key-12345678' });
    assert.equal(r.status, 201, r.text); ctx.po = r.json.id; assert.match(ctx.po, /^PO\/26-27\/00001$/);
    assert.equal(r.json.header.Location, 'MWH'); assert.equal(r.json.header.Destination, 'MWH'); // configurable default, destination follows location
    assert.equal(r.json.status.Status, 'Draft');
    // 5*100=500 @12% = 60 ; 5*40=200 @12% = 24 -> sub 700 tax 84 grand 784
    assert.deepEqual(r.json.totals, { subtotal: 700, taxTotal: 84, grandTotal: 784 });
    assert.equal(r.json.lines[0].CGST, 30); assert.equal(r.json.lines[0].SGST, 30);
    const dup = await pm('POST', '/api/wf/pos', { ...poBody([line(1, 'A1', 5, 100)]), submit: false }, { 'idempotency-key': 'po-key-12345678' });
    assert.equal(dup.json.id, ctx.po); assert.equal(dup.json.duplicate, true);
    const again = await pm('POST', '/api/wf/pos', poBody([line(1, 'A1', 4, 100)]));
    assert.equal(again.status, 422); assert.match(again.json.error, /remaining approved quantity 3/); // 5 already held by the draft PO
    assert.equal((await pm('GET', '/api/wf/intents/get?id=' + encodeURIComponent(ctx.intent))).json.status.Status, 'Partially Converted to PO');
  });
  await t.test('IGST switches the tax split; stock still unchanged by PO', async () => {
    const r = await pm('PUT', `/api/wf/pos?id=${encodeURIComponent(ctx.po)}`, { ...poBody([{ 'Item Code': 'A1', Quantity: 5, Rate: 100, 'GST %': 12, 'Intent No': ctx.intent, 'Intent Line': 1, 'Line No': 1 }, { 'Item Code': 'C3', Quantity: 5, Rate: 40, 'GST %': 12, 'Intent No': ctx.intent, 'Intent Line': 2, 'Line No': 2 }], { 'Is IGST': 'Yes' }), submit: true });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.lines[0].IGST, 60); assert.equal(r.json.lines[0].CGST, 0); assert.equal(r.json.status.Status, 'Pending Authorization');
    assert.equal(await stockOf(sa, 'MWH', 'A1'), 19);
  });
  await t.test('D: PO appears in Pending PO Authorization, not in Pending POs; creator cannot self-authorise; warehouse roles cannot authorise', async () => {
    assert.equal((await pm('GET', '/api/wf/pos?view=pending-auth')).json.total, 1);
    assert.equal((await pm('GET', '/api/wf/pos?view=pending')).json.total, 0);
    const q = `?id=${encodeURIComponent(ctx.po)}`;
    assert.equal((await pm('POST', '/api/wf/pos/action' + q, { action: 'approve' })).status, 403);
    assert.equal((await wm('POST', '/api/wf/pos/action' + q, { action: 'approve' })).status, 403);
    assert.equal((await wm('GET', '/api/wf/pos')).status, 403);
    assert.equal((await op('POST', '/api/wf/pos/action' + q, { action: 'approve' })).status, 403);
  });
  await t.test('authoriser changes a quantity: originals kept in history, totals recalculated, intent quantity re-checked', async () => {
    const q = `?id=${encodeURIComponent(ctx.po)}`;
    assert.equal((await pm2('POST', '/api/wf/pos/action' + q, { action: 'reject' })).status, 400);
    const bad = await pm2('POST', '/api/wf/pos/action' + q, { action: 'approve', lines: [{ lineNo: 1, quantity: 9 }, { lineNo: 2, quantity: 5 }] });
    assert.equal(bad.status, 422);
    const r = await pm2('POST', '/api/wf/pos/action' + q, { action: 'approve', lines: [{ lineNo: 1, quantity: 4 }, { lineNo: 2, remove: true }], remarks: 'ok' });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.status.Status, 'Approved'); assert.equal(r.json.status['Reviewed By'], 'pm2');
    assert.equal(r.json.lines.length, 1); assert.equal(r.json.totals.grandTotal, 448);
    const h = r.json.history.find((x) => x.Event === 'Approved'); assert.match(h.Details, /"from":5/); assert.match(h.Details, /"removed":true/);
    // released quantity of the removed line is available again on the intent
    const open = (await pm('GET', '/api/wf/intents/open')).json.rows[0].lines;
    assert.equal(open.find((l) => l.lineNo === 1).remaining, 4); assert.equal(open.find((l) => l.lineNo === 2).remaining, 5);
  });
  await t.test('E: approved, unreceived PO is in Pending POs and Approved POs, not in pending authorization', async () => {
    assert.equal((await pm('GET', '/api/wf/pos?view=pending')).json.total, 1);
    assert.equal((await pm('GET', '/api/wf/pos?view=approved')).json.total, 1);
    assert.equal((await pm('GET', '/api/wf/pos?view=pending-auth')).json.total, 0);
    const row = (await pm('GET', '/api/wf/pos?view=pending')).json.rows[0];
    assert.equal(row['Approved Quantity'], 4); assert.equal(row['Received Quantity'], 0); assert.equal(row['Balance Quantity'], 4);
  });

  const grnBody = (po, lines, extra = {}) => ({ header: { Date: '2026-10-28', 'Supplier Ref No': po, 'Invoice No.': 'INV-1', ...extra }, lines });
  await t.test('F: GRN against approved PO: partial receipt posts stock once and updates PO balance', async () => {
    const before = await stockOf(sa, 'MWH', 'A1');
    const body = grnBody(ctx.po, [{ 'PO Line': 1, 'Received Qty': 3, 'Rejected / Damaged Qty': 1, Batch: 'GRN-B1', 'Expiry Date': '2031-06-30' }]);
    const r = await op('POST', '/api/t/grn-mrn', body, { 'idempotency-key': 'grn-key-12345678' });
    assert.equal(r.status, 201, r.text); ctx.grn = r.json.id;
    assert.equal(await stockOf(sa, 'MWH', 'A1'), before + 2);          // accepted = received - rejected
    const dup = await op('POST', '/api/t/grn-mrn', body, { 'idempotency-key': 'grn-key-12345678' });
    assert.equal(dup.json.duplicate, true); assert.equal(await stockOf(sa, 'MWH', 'A1'), before + 2); // no double posting
    const po = (await pm('GET', `/api/wf/pos/get?id=${encodeURIComponent(ctx.po)}`)).json;
    assert.equal(po.status.Status, 'Partially Received'); assert.equal(po.lines[0]['Received Qty'], 2); assert.equal(po.lines[0]['Balance Qty'], 2);
    assert.equal((await pm('GET', '/api/wf/pos?view=pending')).json.total, 1);
    const led = (await app.store.read('Stock Ledger')).rows.filter((l) => l.Doc === ctx.grn); assert.equal(led.length, 1);
  });
  await t.test('GRN cannot exceed the PO balance, cannot use unapproved/other PO, vendor+warehouse come from the PO', async () => {
    const over = await op('POST', '/api/t/grn-mrn', grnBody(ctx.po, [{ 'PO Line': 1, 'Received Qty': 3, Batch: 'X', 'Expiry Date': '2031-06-30' }]));
    assert.equal(over.status, 422); assert.match(over.json.error, /exceeds the PO balance 2/);
    assert.equal((await op('POST', '/api/t/grn-mrn', grnBody('PO/26-27/99999', [{ 'PO Line': 1, 'Received Qty': 1, Batch: 'X' }]))).status, 422);
    assert.equal((await op('POST', '/api/t/grn-mrn', grnBody(ctx.po, [{ 'PO Line': 1, 'Received Qty': 1, Batch: 'X' }], { Warehouse: 'DWH' }))).status, 422);
    const g = (await sa('GET', `/api/t/grn-mrn/record?id=${encodeURIComponent(ctx.grn)}`)).json;
    assert.equal(g.record['Vendor Account'], 'Acme Surgicals'); assert.equal(g.record.Warehouse, 'MWH'); assert.equal(g.lines[0]['Item Code'], 'A1');
  });
  await t.test('full receipt completes the PO and removes it from Pending POs; closed intents/POs stay in All', async () => {
    const r = await op('POST', '/api/t/grn-mrn', grnBody(ctx.po, [{ 'PO Line': 1, 'Received Qty': 2, Batch: 'GRN-B2', 'Expiry Date': '2031-06-30' }]));
    assert.equal(r.status, 201, r.text);
    const po = (await pm('GET', `/api/wf/pos/get?id=${encodeURIComponent(ctx.po)}`)).json;
    assert.equal(po.status.Status, 'Completed'); assert.equal(po.grns.length, 2);
    assert.equal((await pm('GET', '/api/wf/pos?view=pending')).json.total, 0);
    assert.equal((await pm('GET', '/api/wf/pos?view=all')).json.total, 1);
    assert.equal((await op('POST', '/api/t/grn-mrn', grnBody(ctx.po, [{ 'PO Line': 1, 'Received Qty': 1, Batch: 'X' }]))).status, 422); // PO is completed
  });
  await t.test('reject releases intent quantity; return/resubmit works; short close', async () => {
    const line = (n, code, qty) => ({ 'Item Code': code, Quantity: qty, Rate: 10, 'GST %': 5, 'Intent No': ctx.intent, 'Intent Line': n });
    const p = await pm('POST', '/api/wf/pos', { ...poBody([line(2, 'C3', 5)]), submit: true }); assert.equal(p.status, 201, p.text);
    const q = `?id=${encodeURIComponent(p.json.id)}`;
    assert.deepEqual((await pm('GET', '/api/wf/intents/open')).json.rows[0].lines.map((l) => l.lineNo), [1]); // line 2 fully held by the pending PO
    const rej = await pm2('POST', '/api/wf/pos/action' + q, { action: 'reject', remarks: 'Price too high' });
    assert.equal(rej.json.status.Status, 'Rejected');
    assert.equal((await pm('GET', '/api/wf/pos?view=approved')).json.rows.some((r) => r['Document No.'] === p.json.id), false);
    assert.equal((await pm('GET', '/api/wf/intents/open')).json.rows[0].lines.find((l) => l.lineNo === 2).remaining, 5);
    assert.equal((await pm2('POST', '/api/wf/pos/action' + q, { action: 'approve' })).status, 403); // rejected PO cannot be approved
    // second PO: approve, short close
    const p2 = await pm('POST', '/api/wf/pos', { ...poBody([line(2, 'C3', 5)]), submit: true });
    const q2 = `?id=${encodeURIComponent(p2.json.id)}`;
    assert.equal((await pm2('POST', '/api/wf/pos/action' + q2, { action: 'approve' })).status, 200);
    assert.equal((await pm2('POST', '/api/wf/pos/action' + q2, { action: 'close' })).status, 400);
    assert.equal((await pm2('POST', '/api/wf/pos/action' + q2, { action: 'close', remarks: 'Supplier cancelled' })).json.status.Status, 'Closed');
    assert.equal((await pm('GET', '/api/wf/pos?view=pending')).json.total, 0);
    assert.equal((await pm('GET', '/api/wf/intents/get?id=' + encodeURIComponent(ctx.intent))).json.status.Status, 'Partially Converted to PO'); // line 1 still has 4 approved units not ordered
  });
  await t.test('I: workflow tables cannot be written through the generic API; tampering is rejected', async () => {
    for (const slug of ['purchase-indent', 'purchase-order-domestic', 'purchase-order-import']) assert.equal((await sa('POST', `/api/t/${slug}`, { header: { Date: '2026-10-26' }, lines: [] })).status, 405, slug);
    assert.equal((await pm('PUT', `/api/t/purchase-order-domestic/record?id=${encodeURIComponent(ctx.po)}`, { header: { Narration: 'x' } })).status, 405);
    assert.equal((await op('GET', '/api/wf/pos')).status, 403);
    assert.equal((await au('GET', '/api/wf/pos')).status, 403);
    assert.equal((await pm('POST', '/api/wf/pos', poBody([{ 'Item Code': 'NOPE', Quantity: 1, Rate: 1 }]))).status, 422);
    assert.equal((await op('POST', '/api/wf/intents/action?id=' + encodeURIComponent(ctx.intent), { action: 'close', remarks: 'x' })).status, 403);
  });
  await t.test('history and audit trail are complete', async () => {
    const h = (await pm('GET', `/api/wf/pos/get?id=${encodeURIComponent(ctx.po)}`)).json.history.map((x) => x.Event);
    assert.deepEqual(h.slice(0, 4), ['Created', 'Submitted for authorization', 'Approved', 'Receipt']);
    assert.ok((await app.store.read('Audit Logs')).rows.some((r) => r.Action === 'PO approve'));
  });
  await t.test('dashboard shows workflow counts from the data', async () => {
    const d = (await pm('GET', '/api/dashboard?from=2026-01-01&to=2026-12-31')).json;
    assert.equal(d.workflow.intents.total, 1); assert.equal(d.workflow.pos.total, 3); assert.equal(d.workflow.pos.pendingAuthorization, 0); assert.equal(d.workflow.grns.againstPo, 2);
  });
});
