import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';

test('purchase requisition: internal replenishment Mother Warehouse -> operating warehouse', async (t) => {
  const app = await makeApp(); t.after(app.close);
  const sa = await app.as('sa'), wm = await app.as('wm'), wm2 = await app.as('wm2'), wo = await app.as('wo'), mo = await app.as('mo'), ap = await app.as('ap');
  const bal = async (wh, code = 'A1') => (await sa('GET', `/api/stock/balances?pageSize=200&showZero=1&warehouse=${wh}`)).json.rows.filter((r) => r['Item Code'] === code);
  const sum = (rows) => rows.reduce((s, r) => s + r.Quantity, 0);
  const mk = (c, qty = 8, extra = {}) => c('POST', '/api/wf/reqs', { header: { Date: '2026-10-26', 'Requesting Warehouse': 'DWH', ...extra }, lines: [{ 'Item Code': 'A1', Quantity: qty, Reason: 'low' }], submit: true });
  let id;

  await t.test('operating warehouse raises it; issuing defaults to the Mother Warehouse; own-warehouse only', async () => {
    const r = await mk(wo); assert.equal(r.status, 201, r.text); id = r.json.id; assert.match(id, /^PR\/26-27\/00001$/);
    assert.equal(r.json.header['Issuing Warehouse'], 'MWH'); assert.equal(r.json.status.Status, 'Pending Approval');
    assert.equal(r.json.lines[0]['Mother Stock'], 19); // includes the expired batch (not usable)
    assert.equal((await mk(wm)).status, 403); // MWH manager cannot raise one for DWH
    assert.equal((await mk(wo, 1, { 'Issuing Warehouse': 'DWH' })).status, 400); // same warehouse
    const dup = await wo('POST', '/api/wf/reqs', { header: { Date: '2026-10-26', 'Requesting Warehouse': 'DWH' }, lines: [{ 'Item Code': 'A1', Quantity: 1 }, { 'Item Code': 'A1', Quantity: 2 }] });
    assert.equal(dup.status, 400); assert.match(dup.json.error, /already on this requisition/);
  });
  await t.test('generic table API cannot bypass the workflow; stock is untouched so far', async () => {
    assert.equal((await wo('POST', '/api/t/purchase-requisition', { header: { Date: '2026-10-26', 'Requesting Warehouse': 'DWH' }, lines: [{ 'Item Code': 'A1', Quantity: 1 }] })).status, 405);
    assert.equal(sum(await bal('MWH')), 19);
  });
  await t.test('only someone at the issuing warehouse (not the requester) can approve; approver role needs scope all', async () => {
    assert.equal((await wm2('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'approve' })).status, 403);
    assert.equal((await wo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'approve' })).status, 403);
    assert.equal((await wm('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'dispatch' })).status, 403); // not approved yet
  });
  await t.test('approve (reduced qty), dispatch uses FEFO and skips expired stock', async () => {
    const a = await wm('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'approve', lines: [{ lineNo: 1, approvedQty: 7 }] });
    assert.equal(a.status, 200, a.text); assert.equal(a.json.status.Status, 'Approved');
    assert.equal((await ap('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'dispatch' })).status, 403); // approver cannot move stock
    const d = await mo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'dispatch' });
    assert.equal(d.status, 200, d.text); assert.equal(d.json.status.Status, 'Dispatched'); assert.equal(d.json.lines[0]['Dispatched Qty'], 7);
    const m = await bal('MWH'); assert.equal(m.find((r) => r['Batch Number'] === 'B-EARLY').Quantity, 0); assert.equal(m.find((r) => r['Batch Number'] === 'B-LATE').Quantity, 8); assert.equal(m.find((r) => r['Batch Number'] === 'B-OLD').Quantity, 4);
    const tr = await bal('TRANSIT-DWH'); assert.equal(sum(tr), 7); assert.equal(sum(await bal('DWH')), 3); // not yet at DWH
  });
  await t.test('receiving warehouse confirms in two steps; totals stay consistent', async () => {
    assert.equal((await mo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'receive' })).status, 403); // not at the requesting warehouse
    const r1 = await wo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'receive', lines: [{ lineNo: 1, quantity: 5 }] });
    assert.equal(r1.status, 200, r1.text); assert.equal(r1.json.status.Status, 'Partially Received'); assert.equal(r1.json.lines[0]['In Transit'], 2);
    assert.equal((await wo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'receive', lines: [{ lineNo: 1, quantity: 3 }] })).status, 422);
    const r2 = await wo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'receive' });
    assert.equal(r2.json.status.Status, 'Received');
    assert.equal(sum(await bal('DWH')), 10); assert.equal(sum(await bal('TRANSIT-DWH')), 0); assert.equal(sum(await bal('MWH')), 12);
    assert.equal((await bal('DWH')).find((r) => r['Batch Number'] === 'B-EARLY').Quantity, 5); // batch identity preserved
    assert.equal((await wo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action: 'receive' })).status, 403); // nothing left
    assert.ok(r2.json.history.some((h) => h.Event === 'Dispatched') && r2.json.history.some((h) => h.Event === 'Received'));
  });
  await t.test('shortage: warning on the document, dispatch refused, partial dispatch allowed', async () => {
    const r = await mk(wo, 40); const id2 = r.json.id;
    await ap('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id2)}`, { action: 'approve' });
    const g = (await wm('GET', `/api/wf/reqs/get?id=${encodeURIComponent(id2)}`)).json; assert.ok(g.lines[0].Shortage > 0, 'shortage flagged');
    const d = await mo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id2)}`, { action: 'dispatch' }); assert.equal(d.status, 422); assert.match(d.json.error, /usable stock/);
    const p = await mo('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id2)}`, { action: 'dispatch', lines: [{ lineNo: 1, quantity: 4 }] }); assert.equal(p.json.status.Status, 'Partially Dispatched');
    assert.equal((await wm('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id2)}`, { action: 'cancel', remarks: 'x' })).status, 403); // stock already moved
  });
  await t.test('reject needs remarks; lists and visibility by warehouse', async () => {
    const r = await mk(wo, 2); const id3 = r.json.id;
    assert.equal((await wm('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id3)}`, { action: 'reject' })).status, 400);
    assert.equal((await wm('POST', `/api/wf/reqs/action?id=${encodeURIComponent(id3)}`, { action: 'reject', remarks: 'no' })).json.status.Status, 'Rejected');
    assert.equal((await wm('GET', '/api/wf/reqs?view=pending')).json.total, 0);
    assert.equal((await wm('GET', '/api/wf/reqs?view=open')).json.total, 1);
    const other = await app.as('sl'); assert.equal((await other('GET', '/api/wf/reqs')).status, 403); // Sales has no access
  });
});
