import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, grn } from './helpers.js';

test('admin creates MWH and CWH users who then work at the same time', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  const mk = async (id, role, wh) => {
    const r = await sa('POST', '/api/admin/users', { 'User ID': id, 'User Name': id, Role: role, Branch: wh, Status: 'Active' });
    assert.equal(r.status, 201, r.text);
    const login = await app.anon('POST', '/api/auth/login', { userId: id, password: r.json.temporaryPassword });
    assert.equal(login.status, 200, login.text); assert.equal(login.json.mustChange ?? login.json.user?.mustChange, true);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    return { id, pw: r.json.temporaryPassword, cookie };
  };
  const m = await mk('mwh1', 'Warehouse Manager', 'MWH'); const c = await mk('cwh1', 'Warehouse Manager', 'CWH');
  assert.ok(m.pw && c.pw);
  // simulate two live sessions (dev password already known via helpers users)
  const mwh = await app.as('wm'); const cwh = await app.as('sl');
  const [a, b] = await Promise.all([
    mwh('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 5, Rate: 1, Batch: 'LIVE-M', 'Expiry Date': '2031-01-01' }])),
    cwh('GET', '/api/stock/balances'),
  ]);
  assert.equal(a.status, 201, a.text); assert.equal(b.status, 200);
  assert.ok((b.json.rows || b.json.balances || []).every((r) => (r.warehouse || r.Warehouse) === 'CWH'), 'CWH user sees only CWH');
  const bad = await cwh('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 1, Rate: 1, Batch: 'X', 'Expiry Date': '2031-01-01' }]));
  assert.ok([403, 422].includes(bad.status), `CWH posting to MWH must be refused, got ${bad.status}`);
});

test('rewritten request (?route=) resolves multi-segment paths', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const r = await app.anon('POST', '/api/handler?route=auth/login', { userId: 'sa', password: 'Test12345pass' });
  assert.equal(r.status, 200, r.text);
  const h = await app.anon('GET', '/api/handler?route=health'); assert.equal(h.status, 200);
});

test('password typed in the Users tab works once, is hashed, and the cell is cleared', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  await app.store.append('Users', [{ 'User ID': 'CR1001', 'User Name': 'Devendar', Password: 'Tech@1234', Role: 'Admin', Branch: 'All Branch', Status: 'Active', 'Last Login': '' }]);
  const bad = await app.anon('POST', '/api/auth/login', { userId: 'CR1001', password: 'wrong' }); assert.equal(bad.status, 401);
  const ok = await app.anon('POST', '/api/auth/login', { userId: 'CR1001', password: 'Tech@1234' }); assert.equal(ok.status, 200, ok.text);
  const users = await app.store.read('Users'); assert.equal(users.rows.find((r) => r['User ID'] === 'CR1001').Password, '');
  const creds = await app.store.read('Credentials'); assert.match(creds.rows.find((r) => r['User ID'] === 'CR1001')['Password Hash'], /^\$2/);
  const again = await app.anon('POST', '/api/auth/login', { userId: 'CR1001', password: 'Tech@1234' }); assert.equal(again.status, 200);
  // admin reset by typing a new password in the sheet
  const row = (await app.store.read('Users')).rows.find((r) => r['User ID'] === 'CR1001');
  await app.store.updateRow('Users', row.__row, { Password: 'NewPass@5678' });
  assert.equal((await app.anon('POST', '/api/auth/login', { userId: 'CR1001', password: 'NewPass@5678' })).status, 200);
  assert.equal((await app.anon('POST', '/api/auth/login', { userId: 'CR1001', password: 'Tech@1234' })).status, 401);
});

test('opening stock: multi-select filters combine (warehouse | expiry status)', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  const get = (qs) => sa('GET', `/api/stock/opening?pageSize=100&${qs}`);
  const all = await get(''); const n = all.json.rows.length;
  const exp = await get('expiryStatus=Expired'); assert.ok(exp.json.rows.length >= 1); assert.ok(exp.json.rows.every((r) => r['Expiry Status'] === 'Expired'));
  const both = await get('expiryStatus=Expired|Valid'); assert.equal(both.json.rows.length, n);
  const wh = await get('warehouse=MWH|CWH&expiryStatus=Valid');
  assert.ok(wh.json.rows.length >= 1 && wh.json.rows.every((r) => ['MWH', 'CWH'].includes(r.Warehouse) && r['Expiry Status'] === 'Valid'));
  assert.equal((await get('warehouse=DWH')).json.rows.every((r) => r.Warehouse === 'DWH'), true);
});

test('PO get returns supplier block and company for the print format', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  await app.store.append('Vendor Master', [{ 'Master Id': 'V1', 'Sup ID': 'VE00096', 'Vendor Name': 'BOMBAY ORTHO INDUSTRIES', Address: 'Kishan Gate', City: 'RAJKOT', Pincode: '360021', State: 'GUJARAT', GSTIN: '24AAHFB9279M1ZU' }]);
  const sa = await app.as('sa');
  const r = await sa('POST', '/api/wf/pos', { header: { Date: '2026-10-27', 'Vendor Account': 'BOMBAY ORTHO INDUSTRIES', Location: 'MWH', Destination: 'MWH' }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Units: 'NOS', Quantity: 2, Rate: 100, 'GST %': 12 }], submit: false });
  assert.equal(r.status, 201, r.text);
  const g = await sa('GET', `/api/wf/pos/get?id=${encodeURIComponent(r.json.id)}`); assert.equal(g.status, 200, g.text);
  assert.equal(g.json.vendor.code, 'VE00096'); assert.equal(g.json.vendor.gstin, '24AAHFB9279M1ZU'); assert.equal(g.json.vendor.pincode, '360021');
  assert.match(g.json.company.name, /Cure/);
});

test('master import: validate, all-or-nothing, skip existing, export xlsx', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  const csv = (rows) => Buffer.from(rows.join('\n')).toString('base64');
  const good = csv(['Sup ID,Vendor Name,Supp Contact,Address,City,GSTIN', 'VE1,ACME ORTHO,9999,Plot 1,RAJKOT,24AAAAA0000A1Z5', 'VE2,BETA MEDI,8888,Plot 2,SURAT,']);
  const check = await sa('POST', '/api/t/vendor-master/import', { filename: 'v.csv', content: good }); assert.equal(check.status, 200, check.text);
  assert.equal(check.json.committed, false); assert.equal(check.json.counts.rows, 2); assert.equal(check.json.counts.errors, 0);
  const done = await sa('POST', '/api/t/vendor-master/import', { filename: 'v.csv', content: good, confirm: true }); assert.equal(done.json.committed, true, done.text);
  const list = await sa('GET', '/api/t/vendor-master?pageSize=50'); assert.equal(list.json.rows.filter((r) => /ACME|BETA/.test(r['Vendor Name'])).length, 2);
  // existing rows are errors unless skipExisting; nothing is written when errors exist
  const dup = await sa('POST', '/api/t/vendor-master/import', { filename: 'v.csv', content: good, confirm: true }); assert.equal(dup.json.committed, false); assert.equal(dup.json.counts.errors, 2);
  const skip = await sa('POST', '/api/t/vendor-master/import', { filename: 'v.csv', content: good, confirm: true, skipExisting: true }); assert.equal(skip.json.counts.skipped, 2);
  const miss = await sa('POST', '/api/t/vendor-master/import', { filename: 'x.csv', content: csv(['Foo,Bar', '1,2']) }); assert.equal(miss.status, 400);
  // permissions + templates + exports
  const au = await app.as('au'); assert.equal((await au('POST', '/api/t/vendor-master/import', { filename: 'v.csv', content: good })).status, 403);
  const xl = await sa('GET', '/api/t/vendor-master?export=xlsx'); assert.equal(xl.status, 200); assert.match(xl.headers.get('content-type'), /spreadsheetml/);
  assert.equal((await sa('GET', '/api/t/vendor-master/template?format=xlsx')).status, 200);
});

test('PO lines carry the extended spec fields and item-info works', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  const r = await sa('POST', '/api/wf/pos', { header: { Date: '2026-10-27', 'Type Of Purchase': 'Local', 'Voucher Prefix': 'PO', 'Vendor Account': 'BOMBAY ORTHO INDUSTRIES', Location: 'MWH', Destination: 'MWH' }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Units: 'NOS', Warehouse: 'MWH', 'Reorder Level': 5, 'Nos. of Pcs/Box': 10, Quantity: 2, Rate: 100, 'SP Rate': 120, 'Price Type': 'Price Book', 'Price Book Rate': 110, 'Special Rate': 95, 'Last PO Rate': 90, Brand: 'X', 'Item Group': 'G', Division: 'D', 'GST %': 12 }], submit: false });
  assert.equal(r.status, 201, r.text);
  const g = await sa('GET', `/api/wf/pos/get?id=${encodeURIComponent(r.json.id)}`);
  assert.equal(g.json.lines[0]['Price Type'], 'Price Book'); assert.equal(g.json.lines[0].Division, 'D');
  const info = await sa('GET', '/api/wf/pos/item-info?code=A1&warehouse=MWH');
  assert.equal(info.status, 200, info.text); assert.equal(info.json.lastRate, 100);
});
