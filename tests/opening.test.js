import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { makeApp, grn } from './helpers.js';

const H = ['Warehouse', 'Item Code', 'Item Name', 'Item Category Type Name', 'Batch Number', 'Quantity', 'Expiry Date', 'Brand Name', 'Stock Value'];
const csv = (rows) => Buffer.from([H.join(','), ...rows.map((r) => r.join(','))].join('\n')).toString('base64');
const imp = (c, rows, extra = {}) => c('POST', '/api/stock/opening/import', { filename: 'o.csv', content: csv(rows), ...extra });

test('opening stock view, filters, export and import', async (t) => {
  const app = await makeApp(); t.after(app.close);
  const sa = await app.as('sa'), wm = await app.as('wm'), au = await app.as('au');

  await t.test('view with filters and warehouse scope', async () => {
    const all = (await sa('GET', '/api/stock/opening?pageSize=200')).json; assert.equal(all.total, 6); assert.equal(all.canImport, true);
    assert.equal((await sa('GET', '/api/stock/opening?warehouse=DWH')).json.total, 2);
    assert.equal((await sa('GET', '/api/stock/opening?expiryStatus=Expired')).json.total, 1);
    assert.equal((await sa('GET', '/api/stock/opening?batch=early')).json.total, 1);
    const mine = (await wm('GET', '/api/stock/opening')).json; assert.equal(mine.total, 3); assert.equal(mine.canImport, false);
    assert.equal((await wm('GET', '/api/stock/opening?warehouse=DWH')).status, 403);
    assert.equal((await au('GET', '/api/stock/opening')).status, 403); // auditor: field-wise, no quantities
  });
  await t.test('"as on date" adds later postings', async () => {
    await wm('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 6, Rate: 100, Batch: 'B-LATE', 'Expiry Date': '2030-01-01' }]));
    const now = (await sa('GET', '/api/stock/opening?warehouse=MWH&batch=B-LATE')).json.rows[0];
    assert.equal(now['Opening Qty'], 10); assert.equal(now['Qty As On Date'], 16);
    const past = (await sa('GET', '/api/stock/opening?warehouse=MWH&batch=B-LATE&asOn=2020-01-01')).json.rows[0];
    assert.equal(past['Qty As On Date'], 10);
  });
  await t.test('CSV export', async () => {
    const r = await sa('GET', '/api/stock/opening?export=1&warehouse=DWH'); assert.equal(r.status, 200); assert.match(r.text, /Qty As On Date/); assert.equal(r.text.trim().split(/\r?\n/).length, 3);
    assert.equal((await wm('GET', '/api/stock/opening?export=1')).status, 200);
  });
  await t.test('import permissions', async () => {
    assert.equal((await imp(wm, [['MWH', 'Z', 'Z', 'c', 'b', 1, '2030-01-01', 'x', 1]])).status, 403);
  });
  await t.test('validation: negatives, duplicates, bad warehouse/date, missing columns', async () => {
    const r = await imp(sa, [['MWH', 'Z1', 'Z', 'c', 'b1', -2, '2030-01-01', 'x', 1], ['MWH', 'Z2', 'Z', 'c', 'b1', 3, 'not-a-date', 'x', 1], ['MWH', 'Z2', 'Z', 'c', 'b1', 3, '2030-01-01', 'x', 1], ['MWH', 'Z3', 'Z', 'c', 'b1', 'abc', '', 'x', 1]], { mode: 'append' });
    assert.equal(r.status, 200); assert.equal(r.json.committed, false);
    const msgs = r.json.errors.map((e) => e.message).join('\n');
    assert.match(msgs, /Negative quantity/); assert.match(msgs, /not a valid date/); assert.match(msgs, /Duplicate of row/); assert.match(msgs, /not a number/);
    const c = await imp(sa, [['MWH', 'Z1', 'Z', 'c', 'b1', -2, '', 'x', 1]], { mode: 'append', confirm: true }); assert.equal(c.status, 422);
    const m = await sa('POST', '/api/stock/opening/import', { filename: 'o.csv', content: Buffer.from('Foo,Bar\n1,2').toString('base64') }); assert.equal(m.status, 400);
    assert.equal((await sa('GET', '/api/stock/opening')).json.total, 6); // nothing written
  });
  await t.test('append: existing combination refused, new rows added', async () => {
    const dup = await imp(sa, [['MWH', 'A1', 'Item A', 'DEX & BIO', 'B-LATE', 1, '2030-01-01', 'ARTHREX', 100]], { mode: 'append' });
    assert.match(dup.json.errors[0].message, /already exists/);
    const ok = await imp(sa, [['MWH', 'N1', 'New', 'cat', 'NB', 7, '2031-01-01', 'br', 700]], { mode: 'append', confirm: true });
    assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.committed, true);
    assert.equal((await sa('GET', '/api/stock/opening?item=N1')).json.rows[0]['Opening Qty'], 7);
  });
  await t.test('replace is refused once the ledger has postings', async () => {
    const r = await imp(sa, [['MWH', 'N2', 'New', 'cat', 'NB', 1, '2031-01-01', 'br', 1]], { confirm: true });
    assert.equal(r.status, 409); assert.match(r.json.error, /Stock Ledger already has/);
  });
  await t.test('replace works on a fresh system, xlsx accepted', async () => {
    const fresh = await makeApp(); t.after(fresh.close); const s2 = await fresh.as('sa');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Opening Stock'); ws.addRow(H); ws.addRow(['MWH', 'X1', 'X', 'c', 'XB', 12, new Date('2030-03-31'), 'b', 1200]);
    const content = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const r = await s2('POST', '/api/stock/opening/import', { filename: 'o.xlsx', content, mode: 'replace', confirm: true });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.committed, true);
    const v = (await s2('GET', '/api/stock/opening')).json; assert.equal(v.total, 1); assert.equal(v.rows[0]['Expiry Date'], '2030-03-31');
    const aud = (await fresh.store.read('Audit Logs')).rows.find((x) => /Import/.test(x.Action)); assert.ok(aud);
  });
});

test('opening stock add row, edit row, xlsx export', async (t) => {
  const app = await makeApp(); t.after(app.close);
  const sa = await app.as('sa'), wm = await app.as('wm');
  const add = (c, row) => c('POST', '/api/stock/opening/row', { row });
  await t.test('add one row; duplicate and non-admin refused', async () => {
    const r = await add(sa, { Warehouse: 'MWH', 'Item Code': 'N9', 'Item Name': 'New', Quantity: 4, 'Batch Number': 'NB', 'Expiry Date': '2031-01-01' });
    assert.equal(r.status, 201, r.text);
    assert.equal((await add(sa, { Warehouse: 'MWH', 'Item Code': 'N9', Quantity: 1, 'Batch Number': 'NB' })).status, 422);
    assert.equal((await add(wm, { Warehouse: 'MWH', 'Item Code': 'N8', Quantity: 1, 'Batch Number': 'x' })).status, 403);
  });
  await t.test('edit quantity needs a reason, is audited, respects ledger postings', async () => {
    const body = { warehouse: 'MWH', itemCode: 'A1', batch: 'B-LATE', quantity: 12 };
    assert.equal((await sa('PUT', '/api/stock/opening/row', body)).status, 400);
    assert.equal((await sa('PUT', '/api/stock/opening/row', { ...body, reason: 'recount' })).status, 200);
    assert.equal((await sa('GET', '/api/stock/opening?warehouse=MWH&batch=B-LATE')).json.rows[0]['Opening Qty'], 12);
    assert.ok((await app.store.read('Audit Logs')).rows.some((x) => x.Action === 'Edit row' && x.Remarks === 'recount'));
    await wm('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 1, Rate: 1, Batch: 'B-LATE', 'Expiry Date': '2030-01-01' }]));
    await wm('POST', '/api/t/material-consumption', { header: { Warehouse: 'MWH' }, lines: [{ 'Item Code': 'A1', Quantity: 13, Batch: 'B-LATE' }] });
    const low = await sa('PUT', '/api/stock/opening/row', { ...body, quantity: 5, reason: 'x' });
    assert.equal(low.status, 422, low.text);
  });
  await t.test('Excel export is a real xlsx', async () => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}/api/stock/opening?export=xlsx`, { headers: { cookie: sa.cookie, 'x-requested-with': 'cure-erp' } });
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /spreadsheetml/);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); assert.ok(wb.worksheets[0].rowCount >= 7);
  });
});
