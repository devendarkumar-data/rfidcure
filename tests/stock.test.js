import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, grn } from './helpers.js';

const bal = async (c, q = '') => (await c('GET', `/api/stock/balances?pageSize=200&showZero=1${q}`)).json.rows;
const qtyOf = (rows, wh, code, batch) => rows.find((r) => r.Warehouse === wh && r['Item Code'] === code && r['Batch Number'] === batch)?.Quantity ?? 0;

test('stock engine through the API', async (t) => {
  const app = await makeApp(); t.after(app.close);
  const sa = await app.as('sa'), wm = await app.as('wm');

  await t.test('opening balance + GRN posts inward stock, ledger row written', async () => {
    const r = await wm('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 6, Rate: 100, Batch: 'NEW-1', 'Expiry Date': '2031-05-31' }]));
    assert.equal(r.status, 201, r.text); assert.match(r.json.id, /^GRN\/26-27\/00001$/); assert.equal(r.json.posted, true);
    assert.equal(qtyOf(await bal(sa), 'MWH', 'A1', 'NEW-1'), 6);
    const led = (await app.store.read('Stock Ledger')).rows; assert.equal(led.length, 1); assert.equal(led[0].Quantity, 6); assert.equal(led[0].Type, 'GRN');
  });
  await t.test('GRN without batch is rejected and nothing is posted', async () => {
    const before = (await app.store.read('Stock Ledger')).rows.length;
    const r = await wm('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 1 }]));
    assert.equal(r.status, 422); assert.match(r.json.error, /batch/i);
    assert.equal((await app.store.read('Stock Ledger')).rows.length, before);
  });
  await t.test('unknown item is rejected', async () => {
    assert.equal((await wm('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'NOPE', Quantity: 1, Batch: 'x' }]))).status, 422);
  });
  await t.test('FEFO: consumption takes earliest non-expired batch first and splits across batches; expired never auto-issued', async () => {
    const r = await wm('POST', '/api/t/material-consumption', { header: { Warehouse: 'MWH' }, lines: [{ Item: 'A1', Quantity: 7 }] });
    assert.equal(r.status, 201, r.text);
    const rows = await bal(sa);
    assert.equal(qtyOf(rows, 'MWH', 'A1', 'B-EARLY'), 0);   // 5 taken first (expires 2029)
    assert.equal(qtyOf(rows, 'MWH', 'A1', 'B-LATE'), 8);    // then 2 from the next
    assert.equal(qtyOf(rows, 'MWH', 'A1', 'B-OLD'), 4);     // expired batch untouched
    assert.equal(r.json.lines.length, 2);                  // stored lines match the batches actually used
  });
  await t.test('insufficient usable stock -> 422 with a clear message, no partial posting', async () => {
    const before = (await app.store.read('Stock Ledger')).rows.length;
    const r = await wm('POST', '/api/t/material-consumption', { header: { Warehouse: 'MWH' }, lines: [{ Item: 'A1', Quantity: 500 }] });
    assert.equal(r.status, 422); assert.match(r.json.error, /only .* usable stock/);
    assert.equal((await app.store.read('Stock Ledger')).rows.length, before);
  });
  await t.test('explicit expired batch is allowed but warned', async () => {
    const r = await wm('POST', '/api/t/material-consumption', { header: { Warehouse: 'MWH' }, lines: [{ Item: 'A1', Quantity: 1, Batch: 'B-OLD' }] });
    assert.equal(r.status, 201); assert.ok(r.json.warnings.some((w) => /expired/.test(w)));
  });
  await t.test('stock transfer moves batch + expiry + value; From = To rejected', async () => {
    const r = await wm('POST', '/api/t/stock-transfer', { header: { Date: '2026-10-26', 'From Warehouse': 'MWH', 'To Warehouse': 'DWH' }, lines: [{ Items: 'A1', Quantity: 2, Batch: 'B-LATE' }] });
    assert.equal(r.status, 201, r.text);
    const rows = await bal(sa);
    assert.equal(qtyOf(rows, 'DWH', 'A1', 'B-LATE'), 5); assert.equal(qtyOf(rows, 'MWH', 'A1', 'B-LATE'), 6);
    const moved = rows.find((x) => x.Warehouse === 'DWH' && x['Item Code'] === 'A1');
    assert.equal(moved['Expiry Date'], '2030-01-01');
    assert.equal((await wm('POST', '/api/t/stock-transfer', { header: { Date: '2026-10-26', 'From Warehouse': 'MWH', 'To Warehouse': 'MWH' }, lines: [{ Items: 'A1', Quantity: 1 }] })).status, 422);
  });
  await t.test('warehouse scope: WM (MWH) cannot post from DWH, nor see DWH stock', async () => {
    assert.equal((await wm('POST', '/api/t/material-consumption', { header: { Warehouse: 'DWH' }, lines: [{ Item: 'C3', Quantity: 1 }] })).status, 403);
    assert.equal((await wm('GET', '/api/stock/balances?warehouse=DWH')).status, 403);
    const mine = (await wm('GET', '/api/stock/balances?pageSize=200')).json.rows; assert.ok(mine.every((r) => r.Warehouse === 'MWH'));
    const led = (await wm('GET', '/api/t/stock-ledger?pageSize=200')).json.rows; assert.ok(led.every((r) => r.Warehouse === 'MWH'));
  });
  await t.test('imprest out moves stock source -> imprest warehouse; imprest in brings it back', async () => {
    const out = await wm('POST', '/api/t/imprest-out-new', { header: { Date: '2026-10-26', 'To Warehouse': 'CWH' }, lines: [{ Warehouse: 'MWH', Item: 'A1', Quantity: 1, Batch: 'B-LATE' }] });
    assert.equal(out.status, 201, out.text);
    assert.equal(qtyOf(await bal(sa), 'CWH', 'A1', 'B-LATE'), 3);
    const back = await app.as('sa');
    const inn = await back('POST', '/api/t/imprest-in-new', { header: { Date: '2026-10-27', 'To Warehouse': 'CWH' }, lines: [{ Warehouse: 'MWH', Item: 'A1', Quantity: 1, Batch: 'B-LATE' }] });
    assert.equal(inn.status, 201, inn.text); assert.equal(qtyOf(await bal(sa), 'CWH', 'A1', 'B-LATE'), 2);
  });
  await t.test('actual stock posts only the variance (admin only)', async () => {
    assert.equal((await wm('POST', '/api/t/actual-stock', { header: { Date: '2026-10-26', Warehouse: 'MWH' }, lines: [{ Items: 'A1', Batch: 'B-LATE', Quantity: 1 }] })).status, 403);
    const sys = qtyOf(await bal(sa), 'MWH', 'A1', 'B-LATE');
    const r = await sa('POST', '/api/t/actual-stock', { header: { Date: '2026-10-26', Warehouse: 'MWH' }, lines: [{ Items: 'A1', Batch: 'B-LATE', Quantity: sys + 3 }] });
    assert.equal(r.status, 201, r.text); assert.equal(qtyOf(await bal(sa), 'MWH', 'A1', 'B-LATE'), sys + 3); assert.equal(r.json.lines[0]['System Qty'], sys);
  });
  await t.test('concurrent consumption of the same last stock: exactly one wins, never negative', async () => {
    const body = { header: { Warehouse: 'DWH' }, lines: [{ Item: 'C3', Quantity: 8 }] };
    const w2 = await app.as('wm2');
    const res = await Promise.all([w2('POST', '/api/t/material-consumption', body), w2('POST', '/api/t/material-consumption', body), sa('POST', '/api/t/material-consumption', body)]);
    assert.deepEqual(res.map((r) => r.status).sort(), [201, 422, 422]);
    assert.equal(qtyOf(await bal(sa), 'DWH', 'C3', 'C-1'), 0);
  });
  await t.test('idempotency key: double submit creates ONE document', async () => {
    const body = grn('MWH', [{ 'Item Code': 'A1', Quantity: 1, Rate: 1, Batch: 'IDEM-1', 'Expiry Date': '2031-01-01' }]);
    const h = { 'idempotency-key': 'abcdef12-3456' };
    const [a, b] = [await wm('POST', '/api/t/grn-mrn', body, h), await wm('POST', '/api/t/grn-mrn', body, h)];
    assert.equal(a.json.id, b.json.id); assert.equal(b.json.duplicate, true);
    assert.equal(qtyOf(await bal(sa), 'MWH', 'A1', 'IDEM-1'), 1);
  });
  await t.test('stock-posting documents cannot be edited or deleted', async () => {
    const id = (await wm('GET', '/api/t/grn-mrn?pageSize=1')).json.rows[0]['Document No.'];
    assert.equal((await sa('PUT', `/api/t/grn-mrn/record?id=${encodeURIComponent(id)}`, { header: { Narration: 'x' } })).status, 409);
    assert.equal((await sa('DELETE', `/api/t/grn-mrn/record?id=${encodeURIComponent(id)}`)).status, 405);
  });
  await t.test('doc numbers are sequential per tab and financial year', async () => {
    const ids = (await sa('GET', '/api/t/grn-mrn?pageSize=50&sort=Document No.&dir=asc')).json.rows.map((r) => r['Document No.']);
    ids.forEach((id, i) => assert.equal(id, `GRN/26-27/${String(i + 1).padStart(5, '0')}`));
  });
  await t.test('every write is in the audit log without secrets', async () => {
    const rows = (await app.store.read('Audit Logs')).rows;
    assert.ok(rows.some((r) => r.Module === 'GRN  MRN' && r.Action === 'Create'));
    assert.ok(!JSON.stringify(rows).match(/\$2[aby]\$/));
  });
});
