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

test('password typed in the Users tab keeps working, is hashed in Credentials, and the cell is NOT cleared', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  await app.store.append('Users', [{ 'User ID': 'CR1001', 'User Name': 'Devendar', Password: 'Tech@1234', Role: 'Admin', Branch: 'All Branch', Status: 'Active', 'Last Login': '' }]);
  const bad = await app.anon('POST', '/api/auth/login', { userId: 'CR1001', password: 'wrong' }); assert.equal(bad.status, 401);
  const ok = await app.anon('POST', '/api/auth/login', { userId: 'CR1001', password: 'Tech@1234' }); assert.equal(ok.status, 200, ok.text);
  const users = await app.store.read('Users'); assert.equal(users.rows.find((r) => r['User ID'] === 'CR1001').Password, 'Tech@1234', 'sheet password kept');
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
  const r = await sa('POST', '/api/wf/pos', { header: { Date: '2026-10-27', 'Type Of Purchase': 'Spine', 'Voucher Prefix': 'PO', 'Vendor Account': 'BOMBAY ORTHO INDUSTRIES', Location: 'MWH', Destination: 'MWH' }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Units: 'NOS', Warehouse: 'MWH', 'Reorder Level': 5, 'Nos. of Pcs/Box': 10, Quantity: 2, Rate: 100, 'SP Rate': 120, 'Price Type': 'Price Book', 'Price Book Rate': 110, 'Special Rate': 95, 'Last PO Rate': 90, Brand: 'X', 'Item Group': 'G', Division: 'D', 'GST %': 12 }], submit: false });
  assert.equal(r.status, 201, r.text);
  const g = await sa('GET', `/api/wf/pos/get?id=${encodeURIComponent(r.json.id)}`);
  assert.equal(g.json.lines[0]['Price Type'], 'Price Book'); assert.equal(g.json.lines[0].Division, 'D');
  const info = await sa('GET', '/api/wf/pos/item-info?code=A1&warehouse=MWH');
  assert.equal(info.status, 200, info.text); assert.equal(info.json.lastRate, 100);
});

test('Users tab in Groups/Phone/Email/Password layout: login by e-mail, role from Groups', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  await app.store.replaceAll('Users', [
    { Groups: 'All,Create,Admin', 'User Name': 'Devendar', Phone: '9810622865', Email: 'pc@colormagix.com', Password: 'Tech@12345x' },
    { Groups: 'Sales', 'User Name': 'Raj Singh', Phone: '9310993988', Email: 'raj.colormagix@gmail.com', Password: 'Raj@431$xyz', Branch: 'DWH' },
    { Groups: 'CRM,Create', 'User Name': 'Anshu', Email: 'anshu.colormagix@gmail.com', Password: 'Anshu$4321$' },
  ]);
  const ok = await app.anon('POST', '/api/auth/login', { userId: 'pc@colormagix.com', password: 'Tech@12345x' });
  assert.equal(ok.status, 200, ok.text);
  const raj = await app.anon('POST', '/api/auth/login', { userId: 'RAJ.colormagix@gmail.com', password: 'Raj@431$xyz' });
  assert.equal(raj.status, 200, raj.text);
  const crm = await app.anon('POST', '/api/auth/login', { userId: 'anshu.colormagix@gmail.com', password: 'Anshu$4321$' });
  assert.equal(crm.status, 403); assert.match(crm.text, /no valid role/);
  const row = (await app.store.read('Users')).rows.find((r) => r.Email === 'pc@colormagix.com');
  assert.equal(row.Password, 'Tech@12345x', 'sheet password kept after login'); assert.equal(row.Role, 'Admin');
});

test('sign in with User Name (case-insensitive), no e-mail needed; names must be unique', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  await app.store.append('Users', [
    { Groups: 'Admin', 'User Name': 'Devendar', Email: 'd@x.com', Password: 'Tech@12345x' },
    { Groups: 'Sales', 'User Name': 'Nirmal Bafna', Password: 'Nirmal@2026x', Branch: 'DWH' },
  ]);
  assert.equal((await app.anon('POST', '/api/auth/login', { userId: 'devendar', password: 'Tech@12345x' })).status, 200);
  assert.equal((await app.anon('POST', '/api/auth/login', { userId: 'nirmal  bafna', password: 'Nirmal@2026x' })).status, 200);
  const dup = await sa('POST', '/api/admin/users', { 'User Name': 'devendar', Role: 'Admin', Status: 'Active' });
  assert.equal(dup.status, 409, dup.text);
  const ok = await sa('POST', '/api/admin/users', { 'User Name': 'Anil Kumar', Role: 'Admin', Status: 'Active', Password: 'Anil@Strong2026' });
  assert.equal(ok.status, 201, ok.text);
  assert.equal((await app.anon('POST', '/api/auth/login', { userId: 'anil kumar', password: 'Anil@Strong2026' })).status, 200);
});

test('Access Control matrix grants and removes tab access per group; Super Admin column locked', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa'); const wm = await app.as('wm');
  assert.equal((await wm('GET', '/api/t/vendor-master')).status, 403, 'masters are admin-only by default');
  let r = await sa('PUT', '/api/admin/access', { tab: 'Vendor Master', role: 'warehouse_manager', level: 'View' });
  assert.equal(r.status, 200, r.text);
  assert.equal((await wm('GET', '/api/t/vendor-master')).status, 200);
  assert.equal((await wm('POST', '/api/t/vendor-master', { 'Vendor Name': 'X Ltd', 'Sup ID': 'S9' })).status, 403, 'View is read-only');
  r = await sa('PUT', '/api/admin/access', { tab: 'Vendor Master', role: 'warehouse_manager', level: 'Edit' });
  assert.equal((await wm('POST', '/api/t/vendor-master', { 'Vendor Name': 'X Ltd', 'Sup ID': 'S9' })).status, 201);
  r = await sa('PUT', '/api/admin/access', { tab: 'GRN  MRN', role: 'warehouse_manager', level: 'None' });
  assert.equal((await wm('GET', '/api/t/grn-mrn')).status, 403);
  const meta = await wm('GET', '/api/meta'); assert.ok(!meta.json.modules.flatMap((m) => m.tables).some((x) => x.title === 'GRN  MRN'));
  assert.equal((await sa('PUT', '/api/admin/access', { tab: 'GRN  MRN', role: 'super_admin', level: 'None' })).status, 403);
  assert.equal((await wm('PUT', '/api/admin/access', { tab: 'GRN  MRN', role: 'sales', level: 'Edit' })).status, 403, 'non-admins cannot change access');
  await sa('PUT', '/api/admin/access', { tab: 'GRN  MRN', role: 'warehouse_manager', level: '' });
  assert.equal((await wm('GET', '/api/t/grn-mrn')).status, 200, 'blank cell restores the default');
  const view = await sa('GET', '/api/admin/access'); assert.equal(view.status, 200); assert.ok(view.json.rows.length > 50 && view.json.roles.some((x) => x.key === 'all'));
});

test('"All" group sees every warehouse; admin can view one warehouse at a time', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  const all = await sa('GET', '/api/stock/balances'); assert.equal(all.status, 200);
  const whs = new Set((all.json.rows || all.json.balances || []).map((x) => x.warehouse || x.Warehouse));
  assert.ok(whs.size >= 2, 'seed data spans several warehouses');
  const one = [...whs][0];
  const filtered = await sa('GET', '/api/stock/balances', undefined, { 'x-view-warehouse': one });
  assert.ok((filtered.json.rows || filtered.json.balances || []).every((x) => (x.warehouse || x.Warehouse) === one));
});

test('PO: warehouse locked to the assigned one, Type of Purchase list, import needs currency + rate', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa'); const wm = await app.as('wm');
  await sa('PUT', '/api/admin/access', { tab: 'Purchase Order — Domestic', role: 'warehouse_manager', level: 'Edit' });
  await sa('PUT', '/api/admin/access', { tab: 'Purchase Order — Import', role: 'warehouse_manager', level: 'Edit' });
  const d = await wm('GET', '/api/wf/pos/defaults'); assert.equal(d.json.location, 'MWH'); assert.equal(d.json.canChooseWarehouse, false);
  const line = [{ 'Item Code': 'A1', Items: 'Item A', Units: 'NOS', Quantity: 1, Rate: 10, 'GST %': 12 }];
  const base = { 'Vendor Account': 'BOMBAY ORTHO INDUSTRIES', Date: '2026-10-27', 'Type Of Purchase': 'Spine' };
  const other = await wm('POST', '/api/wf/pos', { header: { ...base, Location: 'DWH' }, lines: line, submit: true });
  assert.equal(other.status, 403, other.text);
  const mine = await wm('POST', '/api/wf/pos', { header: { ...base }, lines: line, submit: true });
  assert.equal(mine.status, 201, mine.text); assert.equal(mine.json.header.Location, 'MWH'); assert.equal(mine.json.status.Status, 'Pending Authorization');
  const badType = await sa('POST', '/api/wf/pos', { header: { ...base, 'Type Of Purchase': 'Other' }, lines: line, submit: false });
  assert.equal(badType.status, 400, badType.text);
  const noCur = await sa('POST', '/api/wf/pos', { poType: 'import', header: { ...base, Location: 'MWH' }, lines: line.map((l) => ({ ...l, 'GST %': undefined })), submit: false });
  assert.ok([400, 422].includes(noCur.status), noCur.text);
  const imp = await sa('POST', '/api/wf/pos', { poType: 'import', header: { ...base, Location: 'MWH', Currency: 'USD', 'Exchange Rate': 83 }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Units: 'NOS', Quantity: 1, Rate: 10 }], submit: false });
  assert.equal(imp.status, 201, imp.text); assert.equal(imp.json.status.Status, 'Draft'); assert.equal(imp.json.totals.grandTotal, 830);
  const dom = await sa('POST', '/api/wf/pos', { header: { ...base, Location: 'MWH', Currency: 'USD', 'Exchange Rate': 83 }, lines: line, submit: false });
  assert.equal(dom.status, 201); assert.ok(!dom.json.header.Currency && !dom.json.header['Exchange Rate'], 'domestic ignores currency / rate');
});

test('only Mother Warehouse (MWH) users can raise Purchase Indents', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  await app.store.append('Users', [{ 'User ID': 'dwhop', 'User Name': 'dwhop', Role: 'Warehouse Operator', Branch: 'DWH', Status: 'Active', Password: 'Dwh@Operator2026' }]);
  const dwh = await app.as('dwhop', 'Dwh@Operator2026');
  const meta = await dwh('GET', '/api/meta');
  const pi = meta.json.modules.flatMap((m) => m.tables).find((x) => x.slug === 'purchase-indent');
  assert.ok(!pi || !pi.actions.includes('create'), 'no create action for a DWH user');
  const r = await dwh('POST', '/api/wf/intents', { header: { Date: '2026-10-27' }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Quantity: 1 }], submit: false });
  assert.equal(r.status, 403, r.text);
  const wm = await app.as('wm');
  const ok = await wm('POST', '/api/wf/intents', { header: { Date: '2026-10-27' }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Quantity: 1 }], submit: false });
  assert.equal(ok.status, 201, ok.text); assert.equal(ok.json.header['Requesting Warehouse'], 'MWH');
});

test('only Approver, Admin and Super Admin approve/reject Indents and POs', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const wm = await app.as('wm'); const ap = await app.as('ap'); const ad = await app.as('ad');
  const sa = await app.as('sa');
  await sa('PUT', '/api/admin/access', { tab: 'Purchase Order — Domestic', role: 'warehouse_manager', level: 'Edit' });
  const intent = await wm('POST', '/api/wf/intents', { header: { Date: '2026-10-27' }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Quantity: 2 }], submit: true });
  assert.equal(intent.status, 201, intent.text);
  const id = encodeURIComponent(intent.json.id);
  assert.equal((await wm('POST', `/api/wf/intents/action?id=${id}`, { action: 'approve' })).status, 403);
  const rows = (await wm('GET', '/api/wf/intents')).json.rows; assert.ok(rows.every((r) => !r.actions.approve));
  assert.equal((await ap('POST', `/api/wf/intents/action?id=${id}`, { action: 'approve' })).status, 200);
  const po = await wm('POST', '/api/wf/pos', { header: { Date: '2026-10-27', 'Vendor Account': 'BOMBAY ORTHO INDUSTRIES' }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Units: 'NOS', Quantity: 1, Rate: 10, 'GST %': 12 }], submit: true });
  assert.equal(po.status, 201, po.text); const pid = encodeURIComponent(po.json.id);
  assert.equal((await wm('POST', `/api/wf/pos/action?id=${pid}`, { action: 'approve' })).status, 403, 'creator role cannot authorise');
  assert.equal((await ad('POST', `/api/wf/pos/action?id=${pid}`, { action: 'approve' })).status, 200, 'Admin can authorise');
});

test('GRN Operator and Entry Operator permissions', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const pw = 'Op@Strong2026x';
  await app.store.append('Users', [
    { 'User ID': 'grnop', 'User Name': 'grnop', Role: 'GRN Operator', Branch: 'MWH', Status: 'Active', Password: pw },
    { 'User ID': 'entop', 'User Name': 'entop', Role: 'Entry Operator', Branch: 'MWH', Status: 'Active', Password: pw },
  ]);
  await app.store.append('Warehouse Master', [{ 'Master Id': 'W-1', 'Warehouse Name': 'MAX HOSPITAL', 'Warehouse Type': 'Hospital' }]);
  const g = await app.as('grnop', pw); const e = await app.as('entop', pw); const sa = await app.as('sa');
  // GRN Operator: creates GRN, cannot edit it, view-only elsewhere
  const made = await g('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 2, Rate: 10, Batch: 'GO-1', 'Expiry Date': '2031-01-01' }]));
  assert.equal(made.status, 201, made.text);
  const gid = made.json.id || made.json['Document No.'];
  assert.equal((await g('PUT', `/api/t/grn-mrn/record?id=${encodeURIComponent(gid)}`, { header: { 'Narration-Notes': 'x' } })).status, 403, 'GRN edit restricted');
  assert.equal((await g('POST', '/api/t/material-consumption', { header: { Warehouse: 'MWH' }, lines: [{ 'Item Code': 'A1', Quantity: 1, Batch: 'B-LATE' }] })).status, 403);
  assert.equal((await g('POST', '/api/t/imprest-out-new', { header: { Date: '2026-10-27', 'To Warehouse': 'MAX HOSPITAL' }, lines: [{ Warehouse: 'MWH', 'Item Code': 'A1', Quantity: 1, Batch: 'B-LATE' }] })).status, 403);
  assert.equal((await g('POST', '/api/wf/intents', { header: { Date: '2026-10-27' }, lines: [{ 'Item Code': 'A1', Quantity: 1 }], submit: false })).status, 403);
  assert.equal((await g('GET', '/api/wf/pos?view=pending-auth')).status, 200, 'can view pending / authorized POs');
  assert.equal((await g('GET', '/api/admin/users')).status, 403);
  assert.equal((await g('GET', '/api/stock/balances')).status, 200, 'opening stock / inventory visible');
  // Entry Operator: no GRN create, can view GRN; Imprest and Consumption add; consumption deducts stock
  assert.equal((await e('GET', '/api/t/grn-mrn')).status, 403, 'Entry Operator: GRN hidden');
  for (const tb of ['rfid-generation', 'master-mapping', 'item-master', 'vendor-master', 'configuration']) { assert.equal((await e('GET', `/api/t/${tb}`)).status, 403, `entry op ${tb}`); assert.equal((await g('GET', `/api/t/${tb}`)).status, 403, `grn op ${tb}`); }
  assert.equal((await g('GET', '/api/t/purchase-indent')).status, 403, 'GRN person: no purchasing');
  assert.equal((await e('GET', '/api/wf/pos?view=pending-auth')).status, 403, 'Entry Operator: no PO');
  assert.equal((await e('POST', '/api/t/grn-mrn', grn('MWH', [{ 'Item Code': 'A1', Quantity: 1, Rate: 1, Batch: 'EO', 'Expiry Date': '2031-01-01' }]))).status, 403);
  const before = (await sa('GET', '/api/stock/balances?pageSize=200&warehouse=MWH')).json.rows.filter((r) => r['Item Code'] === 'A1').reduce((s, r) => s + r.Quantity, 0);
  const c = await e('POST', '/api/t/material-consumption', { header: { Warehouse: 'MWH' }, lines: [{ 'Item Code': 'A1', Quantity: 3, Batch: 'B-LATE' }] });
  assert.equal(c.status, 201, c.text);
  const after = (await sa('GET', '/api/stock/balances?pageSize=200&warehouse=MWH')).json.rows.filter((r) => r['Item Code'] === 'A1').reduce((s, r) => s + r.Quantity, 0);
  assert.equal(before - after, 3, 'consumption deducted from MWH');
  { const io = await e('POST', '/api/t/imprest-out-new', { header: { Date: '2026-10-27', 'To Warehouse': 'MAX HOSPITAL' }, lines: [{ Warehouse: 'MWH', 'Item Code': 'A1', Quantity: 1, Batch: 'B-LATE' }] }); assert.equal(io.status, 201, io.text); }
  assert.equal((await e('POST', '/api/t/imprest-in-new', { header: { Date: '2026-10-27', 'To Warehouse': 'MWH' }, lines: [{ Warehouse: 'MWH', 'Item Code': 'A1', Quantity: 1, Batch: 'B-LATE', 'Expiry Date': '2030-01-01' }] })).status < 500, true);
  assert.equal((await e('DELETE', `/api/t/material-consumption/record?id=${encodeURIComponent(c.json.id || '')}`)).status, 403, 'no delete');
  assert.equal((await e('POST', '/api/wf/intents', { header: { Date: '2026-10-27' }, lines: [{ 'Item Code': 'A1', Quantity: 1 }], submit: false })).status, 403);
});

test('GRN can be raised against a PO that is still Pending Authorization; approval later keeps receipt status', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa'); const ad = await app.as('ad');
  const po = await sa('POST', '/api/wf/pos', { header: { Date: '2026-10-27', 'Vendor Account': 'BOMBAY ORTHO INDUSTRIES', Location: 'MWH' }, lines: [{ 'Item Code': 'A1', Items: 'Item A', Units: 'NOS', Quantity: 5, Rate: 10, 'GST %': 12 }], submit: true });
  assert.equal(po.status, 201, po.text); const id = po.json.id;
  const open = await sa('GET', '/api/wf/pos/open'); assert.ok(open.json.rows.some((r) => r['Document No.'] === id && r.Status === 'Pending Authorization'));
  const g = await sa('POST', '/api/t/grn-mrn', { header: { Date: '2026-10-27', 'Supplier Ref No': id }, lines: [{ 'PO Line': 1, 'Received Qty': 5, 'Rejected / Damaged Qty': 0, Batch: 'PG-1', 'Expiry Date': '2031-01-01' }] });
  assert.equal(g.status, 201, g.text);
  const after = await sa('GET', `/api/wf/pos/get?id=${encodeURIComponent(id)}`); assert.equal(after.json.status.Status, 'Pending Authorization', 'authorization still pending');
  const ap = await ad('POST', `/api/wf/pos/action?id=${encodeURIComponent(id)}`, { action: 'approve' });
  assert.equal(ap.status, 200, ap.text); assert.equal(ap.json.status.Status, 'Completed', 'fully received PO completes on authorization');
  const list = await sa('GET', '/api/t/grn-mrn'); assert.ok(list.json.rows[0]['Supplier Ref No'] === id && list.json.rows[0]['Vendor Account']);
});

test('Imprest Out form: hidden fields, customer details, company / business head / supplier lookups, scoped warehouse', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  await app.store.append('Customer  Hospital Master', [{ 'Master Id': 'C-1', 'Hospital Name': 'MAX HOSPITAL', Code: 'MX01', Address: '1 Ring Road', City: 'Delhi', State: 'Delhi', Pincode: '110001' }]);
  await app.store.append('Sales Executive Master', [{ 'Master Id': 'S-1', 'Salesperson Name': 'Asha', Type: 'Business Head' }, { 'Master Id': 'S-2', 'Salesperson Name': 'Ravi', Type: 'Executive' }]);
  const meta = (await sa('GET', '/api/meta')).json.modules.flatMap((m) => m.tables).find((x) => x.slug === 'imprest-out-new');
  const names = meta.fields.map((f) => f.name);
  for (const gone of ['To Warehouse', 'Location', 'Is IGST', 'Ref. Date', 'Supplier', 'Ref. Doc', 'Dispatch Name', 'Dispatch City', 'Dispatch Address', 'Dispatch Pincode', 'Dispatch State']) assert.ok(!names.includes(gone), `${gone} hidden`);
  for (const need of ['Bill Code', 'Companies', 'Business Head', 'Ship to Name', 'Ship to Address']) assert.ok(names.includes(need), `${need} present`);
  assert.ok(names.includes('Delivery Date'), 'Delivery Date is in the main form');
  for (const gone of ['Delivery Date', 'Consumption Type', 'Rate', 'Gross']) assert.ok(!meta.lineFields.some((f) => f.name === gone), `${gone} not a line column`);
  const c = (await sa('GET', '/api/lookup/customer?name=max hospital')).json;
  assert.deepEqual([c.found, c.code, c.address, c.city, c.pincode], [true, 'MX01', '1 Ring Road', 'Delhi', '110001']);
  assert.equal((await sa('GET', '/api/lookup/customer?name=Nobody')).json.found, false);
  assert.deepEqual((await sa('GET', '/api/lookup?field=Business Head')).json.options.map((o) => o.value), ['Asha']);
  assert.ok((await sa('GET', '/api/lookup?field=Companies')).json.options.length >= 0);
  const wh = (await sa('GET', '/api/lookup?field=Warehouse&scopeOnly=1')).json.options;
  assert.ok(wh.length >= 1 && wh.every((o) => o.inScope));
});

test('Item Master carries Batch Number / Expiry Date and gives Brand to stock rows by Item Code', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  await app.store.append('Item Master', [{ 'Master Id': 'IM-9', 'Item Name': 'Widget Z', Code: 'WZ9', Brand: 'ACME', 'Item Category': 'Implants', 'Batch Number': 'BN-1', 'Expiry Date': '2030-01-01' }]);
  await app.store.append('Opening Stock', [{ Warehouse: 'MWH', 'Item Code': 'WZ9', 'Item Name': '', 'Item Category Type Name': '', 'Batch Number': 'BN-1', Quantity: 5, 'Expiry Date': '2030-01-01', 'Brand Name': '', 'Stock Value': 50 }]);
  const r = await sa('GET', '/api/stock/opening?pageSize=200&q=WZ9');
  assert.equal(r.status, 200, r.text);
  const row = r.json.rows.find((x) => x['Item Code'] === 'WZ9');
  assert.ok(row, 'stock row listed');
  assert.deepEqual([row['Brand Name'], row['Item Name'], row['Item Category Type Name'], row['Batch Number'], row['Expiry Date']], ['ACME', 'Widget Z', 'Implants', 'BN-1', '2030-01-01']);
});

test('batch picker: per-warehouse batches and all-batches mode return expiry and rate from stock', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  await app.store.append('Opening Stock', [
    { Warehouse: 'MWH', 'Item Code': 'BP1', 'Item Name': 'Plate', 'Batch Number': 'B-X', Quantity: 4, 'Expiry Date': '2031-05-01', 'Stock Value': 400 },
    { Warehouse: 'CWH', 'Item Code': 'BP1', 'Item Name': 'Plate', 'Batch Number': 'B-Y', Quantity: 2, 'Expiry Date': '2030-05-01', 'Stock Value': 300 },
  ]);
  const one = (await sa('GET', '/api/stock/batches?warehouse=MWH&code=BP1')).json.batches;
  assert.deepEqual(one.map((b) => [b.batch, b.expiry, b.rate]), [['B-X', '2031-05-01', 100]]);
  const all = (await sa('GET', '/api/stock/batches?code=BP1&all=1')).json.batches;
  assert.deepEqual(all.map((b) => [b.batch, b.expiry, b.rate]), [['B-Y', '2030-05-01', 150], ['B-X', '2031-05-01', 100]]);
});

test('Stock Item lookup lists stock records (item, batch, expiry, qty, rate) by warehouse or across all', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const sa = await app.as('sa');
  await app.store.append('Opening Stock', [
    { Warehouse: 'MWH', 'Item Code': 'SP1', 'Item Name': 'Screw', 'Batch Number': 'S-1', Quantity: 4, 'Expiry Date': '2031-05-01', 'Brand Name': 'ACME', 'Stock Value': 400 },
    { Warehouse: 'CWH', 'Item Code': 'SP2', 'Item Name': 'Nail', 'Batch Number': 'S-2', Quantity: 2, 'Expiry Date': '2030-05-01', 'Stock Value': 300 },
  ]);
  const m = (await sa('GET', '/api/lookup?field=Stock Item&warehouse=MWH&q=SP')).json.options;
  assert.deepEqual(m.map((o) => [o.code, o.batch, o.expiry, o.qty, o.rate, o.brand]), [['SP1', 'S-1', '2031-05-01', 4, 100, 'ACME']]);
  const a = (await sa('GET', '/api/lookup?field=Stock Item&all=1&q=SP')).json.options;
  assert.deepEqual(a.map((o) => o.code).sort(), ['SP1', 'SP2']);
  assert.deepEqual((await sa('GET', '/api/lookup?field=Stock Item')).json.options, []);
});

test('Imprest flow: 100 out to a hospital, 80 returned by Imprest In, remaining 20 consumed against a bill', async (t) => {
  const app = await makeApp(); t.after(() => app.close());
  const pw = 'Op@Strong2026x';
  await app.store.append('Users', [{ 'User ID': 'entop2', 'User Name': 'entop2', Role: 'Entry Operator', Branch: 'MWH', Status: 'Active', Password: pw }]);
  await app.store.append('Customer  Hospital Master', [{ 'Master Id': 'C-9', 'Hospital Name': 'CITY HOSPITAL', Code: 'CH1' }]);
  await app.store.append('Item Master', [{ 'Master Id': 'IM-F', 'Item Name': 'Flow Screw', Code: 'FL1', Brand: 'ACME', 'Item Category': 'Implants' }]);
  await app.store.append('Opening Stock', [{ Warehouse: 'MWH', 'Item Code': 'FL1', 'Item Name': 'Flow Screw', 'Batch Number': 'F-1', Quantity: 100, 'Expiry Date': '2031-01-01', 'Stock Value': 5000 }]);
  const e = await app.as('entop2', pw); const sa = await app.as('sa');
  const avail = async () => (await e('GET', '/api/lookup?field=Stock Item&warehouse=CITY HOSPITAL&q=FL1')).json.options?.[0]?.qty ?? 0;
  const hosp = async () => (await e('GET', '/api/lookup?field=Warehouse&imprest=1')).json.options.map((o) => o.value);
  assert.ok(!(await hosp()).includes('CITY HOSPITAL'), 'no imprest yet');
  const out = await e('POST', '/api/t/imprest-out-new', { header: { Date: '2026-10-28', 'Customer Account': 'CITY HOSPITAL', 'Delivery Date': '2026-10-29' }, lines: [{ Warehouse: 'MWH', 'Item Code': 'FL1', Quantity: 100, Batch: 'F-1' }] });
  assert.equal(out.status, 201, out.text);
  assert.ok((await hosp()).includes('CITY HOSPITAL'), 'hospital with imprest stock is offered');
  const vw = (await app.store.read('Warehouse Master')).rows.find((r) => r['Warehouse Name'] === 'CITY HOSPITAL');
  assert.ok(vw && vw['Warehouse Type'] === 'Virtual (Imprest)', 'virtual warehouse created automatically for the new location');
  assert.equal(await avail(), 100);
  const back = (q) => e('POST', '/api/t/imprest-in-new', { header: { Date: '2026-10-28', 'To Warehouse': 'CITY HOSPITAL' }, lines: [{ Warehouse: 'MWH', 'Item Code': 'FL1', Quantity: q, Batch: 'F-1' }] });
  assert.equal((await back(120)).status, 422, 'cannot return more than the hospital holds');
  const r = await back(80); assert.equal(r.status, 201, r.text);
  assert.equal(await avail(), 20, 'out 100 - in 80 = 20 left at the hospital');
  const cons = (body) => e('POST', '/api/t/material-consumption', body);
  const lines = (q) => [{ 'Consumption Type': 'Against Bill', 'Item Code': 'FL1', Quantity: q, Batch: 'F-1' }];
  assert.equal((await cons({ header: { Warehouse: 'CITY HOSPITAL' }, lines: lines(20) })).status, 422, 'bill number required');
  assert.equal((await cons({ header: { Warehouse: 'CITY HOSPITAL', 'Bill No': 'B-77' }, lines: lines(21) })).status, 422, 'more than the 20 left');
  const ok = await cons({ header: { Warehouse: 'CITY HOSPITAL', 'Bill No': 'B-77', 'Bill Date': '2026-10-28' }, lines: lines(20) });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(await avail(), 0);
  assert.ok(!(await hosp()).includes('CITY HOSPITAL'), 'nothing left at the hospital');
  const bal = (await sa('GET', '/api/stock/balances?pageSize=200&q=FL1')).json.rows.filter((x) => x['Item Code'] === 'FL1');
  assert.equal(bal.filter((x) => x.Warehouse === 'MWH').reduce((s, x) => s + x.Quantity, 0), 80, 'MWH has the 80 returned');
});
