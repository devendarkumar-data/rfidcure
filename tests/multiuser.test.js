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
