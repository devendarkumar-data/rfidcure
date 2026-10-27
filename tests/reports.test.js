import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { makeApp, grn } from './helpers.js';

test('report engine: filters, scope, export, virtual stock', async (t) => {
  const app = await makeApp(); t.after(app.close);
  const sa = await app.as('sa'), wm = await app.as('wm'), au = await app.as('au'), wo = await app.as('wo'), mo = await app.as('mo');
  const rep = (c, k, q = '') => c('GET', `/api/reports/${k}${q}`);

  await t.test('catalogue depends on role', async () => {
    const all = (await sa('GET', '/api/reports')).json.reports.map((r) => r.key); assert.ok(all.length >= 18, `got ${all.length}`);
    const wmk = (await wm('GET', '/api/reports')).json.reports.map((r) => r.key); assert.ok(!wmk.includes('pending-po-authorization')); assert.ok(wmk.includes('warehouse-stock'));
    assert.equal((await rep(wm, 'pending-po-authorization')).status, 403);
    assert.equal((await rep(au, 'warehouse-stock')).status, 403); // auditor: no quantities
    assert.equal((await rep(sa, 'nope')).status, 404);
  });
  await t.test('warehouse stock: scope, warehouse + item + status filters, pagination, totals', async () => {
    const r = (await rep(sa, 'warehouse-stock', '?pageSize=2')).json; assert.equal(r.total, 6); assert.equal(r.rows.length, 2); assert.equal(r.pages, 3);
    assert.equal((await rep(sa, 'warehouse-stock', '?warehouse=DWH')).json.total, 2);
    assert.equal((await rep(sa, 'warehouse-stock', '?item=C3')).json.total, 1);
    assert.equal((await rep(sa, 'warehouse-stock', '?status=Expired')).json.total, 1);
    assert.equal((await rep(wm, 'warehouse-stock')).json.total, 3); // MWH only
    assert.equal((await rep(sa, 'warehouse-stock', '?q=early')).json.total, 1);
    assert.equal((await rep(sa, 'warehouse-stock')).json.totals.Quantity, 32);
  });
  await t.test('item-wise stock has one column per warehouse', async () => {
    const r = (await rep(sa, 'item-wise-stock')).json; assert.ok(['MWH', 'DWH', 'CWH'].every((w) => r.columns.includes(w)));
    assert.equal(r.rows.find((x) => x['Item Code'] === 'A1')['Total Qty'], 24);
  });
  await t.test('hospital delivery creates virtual stock; consumption deducts it once', async () => {
    await app.store.append('Warehouse Master', [{ 'Master Id': 'W-1', 'Warehouse Name': 'MAX HOSPITAL', 'Warehouse Type': 'Virtual / Hospital' }]);
    const d = await mo('POST', '/api/t/imprest-out-new', { header: { Date: '2026-10-26', 'To Warehouse': 'MAX HOSPITAL' }, lines: [{ Warehouse: 'MWH', 'Item Code': 'A1', Quantity: 6, Batch: 'B-LATE' }] });
    assert.equal(d.status, 201, d.text);
    const v = (await rep(sa, 'virtual-stock')).json; assert.equal(v.total, 1); assert.equal(v.rows[0].Location, 'MAX HOSPITAL'); assert.equal(v.rows[0]['Location Type'], 'Hospital / virtual'); assert.equal(v.rows[0].Quantity, 6);
    assert.equal((await rep(sa, 'warehouse-stock', '?warehouse=MWH&item=A1')).json.totals.Quantity, 13); // physical shrank by 6, nothing else
    const c = await sa('POST', '/api/t/material-consumption', { header: { Warehouse: 'MAX HOSPITAL' }, lines: [{ 'Item Code': 'A1', Quantity: 5, Batch: 'B-LATE' }] });
    assert.equal(c.status, 201, c.text);
    assert.equal((await rep(sa, 'virtual-stock')).json.rows[0].Quantity, 1);
    assert.equal((await rep(sa, 'item-wise-stock')).json.rows.find((x) => x['Item Code'] === 'A1')['Total Qty'], 18); // 24 minus the 6 sent to the hospital; virtual stock is excluded from warehouse totals
    assert.equal((await sa('POST', '/api/t/material-consumption', { header: { Warehouse: 'MAX HOSPITAL' }, lines: [{ 'Item Code': 'A1', Quantity: 2, Batch: 'B-LATE' }] })).status, 422); // only 1 left
    assert.equal((await rep(sa, 'consumption-register')).json.total, 1);
    assert.equal((await rep(sa, 'hospital-delivery-register')).json.total, 1);
  });
  await t.test('stock ledger report, date filter, GRN register', async () => {
    await wm('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 2, Rate: 10, Batch: 'G1', 'Expiry Date': '2031-01-01' }]));
    assert.ok((await rep(sa, 'stock-ledger')).json.total >= 3);
    assert.equal((await rep(sa, 'stock-ledger', '?from=2099-01-01')).json.total, 0);
    assert.equal((await rep(sa, 'grn-register')).json.total, 1);
    assert.equal((await rep(wo, 'grn-register')).json.total, 0); // DWH operator sees nothing of MWH's GRN
  });
  await t.test('low stock uses Item Master minimum level', async () => {
    await app.store.append('Item Master', [{ 'Master Id': 'IM-1', 'Item Name': 'Item A', Code: 'A1', 'Min Stock Level': 20 }]);
    const r = (await rep(sa, 'low-stock')).json; const row = r.rows.find((x) => x.Warehouse === 'DWH' && x['Item Code'] === 'A1');
    assert.ok(row, JSON.stringify(r.rows)); assert.equal(row.Shortfall, 17); assert.equal(row.Action, 'Raise Purchase Requisition');
  });
  await t.test('CSV and Excel export of any report; export audited', async () => {
    const base = `http://127.0.0.1:${app.server.address().port}`; const h = { cookie: sa.cookie, 'x-requested-with': 'cure-erp' };
    const c = await fetch(`${base}/api/reports/warehouse-stock?export=csv&warehouse=DWH`, { headers: h }); assert.match(await c.text(), /Item Code/);
    const x = await fetch(`${base}/api/reports/warehouse-stock?export=xlsx`, { headers: h }); assert.match(x.headers.get('content-type'), /spreadsheetml/);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await x.arrayBuffer())); assert.ok(wb.worksheets[0].rowCount > 5);
    assert.ok((await app.store.read('Audit Logs')).rows.some((r) => /Report/.test(r.Module) && r.Action === 'Export'));
  });
});

test('dashboard cards come from live data', async (t) => {
  const app = await makeApp(); t.after(app.close);
  const sa = await app.as('sa'), wm = await app.as('wm');
  await app.store.append('Warehouse Master', [{ 'Master Id': 'W-1', 'Warehouse Name': 'MAX HOSPITAL', 'Warehouse Type': 'Hospital' }]);
  let d = (await sa('GET', '/api/dashboard')).json.cards;
  assert.equal(d.currentStock.qty, 32); assert.equal(d.openingStock.qty, 32); assert.equal(d.virtualStock.qty, 0); assert.deepEqual(d.warehouses.map((w) => w.warehouse), ['CWH', 'DWH', 'MWH']);
  await wm('POST', '/api/t/imprest-out-new', { header: { Date: '2026-10-26', 'To Warehouse': 'MAX HOSPITAL' }, lines: [{ Warehouse: 'MWH', 'Item Code': 'A1', Quantity: 4, Batch: 'B-LATE' }] });
  await sa('POST', '/api/t/material-consumption', { header: { Warehouse: 'MAX HOSPITAL' }, lines: [{ 'Item Code': 'A1', Quantity: 1, Batch: 'B-LATE' }] });
  const full = (await sa('GET', '/api/dashboard?from=2020-01-01&to=2099-01-01')).json; d = full.cards;
  assert.equal(d.currentStock.qty, 28); assert.equal(d.virtualStock.qty, 3); assert.equal(d.consumption.qty, 1); assert.ok(full.recent.length >= 3);
  assert.equal(d.currentStock.qty + d.virtualStock.qty + d.consumption.qty, 32); // nothing lost or double counted
  assert.ok(full.workflow.requisitions);
});
