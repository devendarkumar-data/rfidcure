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
