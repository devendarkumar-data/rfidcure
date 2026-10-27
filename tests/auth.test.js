import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, PW } from './helpers.js';

test('auth flows', async (t) => {
  const app = await makeApp(); t.after(app.close);
  await t.test('no session -> 401 everywhere', async () => {
    for (const p of ['/api/meta', '/api/t/grn-mrn', '/api/stock/balances', '/api/dashboard', '/api/admin/users', '/api/lookup?field=Doctor']) assert.equal((await app.anon('GET', p)).status, 401, p);
  });
  await t.test('CSRF header required on writes', async () => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'sa', password: PW }) });
    assert.equal(r.status, 403);
  });
  await t.test('cross-origin write blocked', async () => {
    const r = await app.anon('POST', '/api/auth/login', { userId: 'sa', password: PW }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  });
  await t.test('wrong password and unknown user give the same message', async () => {
    const a = await app.anon('POST', '/api/auth/login', { userId: 'sa', password: 'nope' });
    const b = await app.anon('POST', '/api/auth/login', { userId: 'ghost', password: 'nope' });
    assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.json.error, b.json.error);
  });
  await t.test('deactivated user cannot sign in', async () => {
    const r = await app.anon('POST', '/api/auth/login', { userId: 'off', password: PW });
    assert.equal(r.status, 403);
  });
  await t.test('cookie is HttpOnly + SameSite and no hash leaks', async () => {
    const r = await app.anon('POST', '/api/auth/login', { userId: 'sa', password: PW });
    const c = r.headers.get('set-cookie'); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/);
    assert.ok(!JSON.stringify(r.json).includes('$2'));
  });
  await t.test('deactivating a user kills their existing session', async () => {
    const c = await app.as('de'); assert.equal((await c('GET', '/api/meta')).status, 200);
    const sa = await app.as('sa');
    await sa('PUT', '/api/admin/users?id=de', { Status: 'Inactive' });
    assert.equal((await c('GET', '/api/meta')).status, 401);
  });
  await t.test('account locks after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await app.anon('POST', '/api/auth/login', { userId: 'pu', password: 'bad' + i });
    const r = await app.anon('POST', '/api/auth/login', { userId: 'pu', password: PW });
    assert.equal(r.status, 423);
  });
  await t.test('password change invalidates other sessions; policy enforced', async () => {
    const a = await app.as('fi'), b = await app.as('fi');
    assert.equal((await a('POST', '/api/auth/change-password', { oldPassword: PW, newPassword: 'short1' })).status, 400);
    assert.equal((await a('POST', '/api/auth/change-password', { oldPassword: 'wrong', newPassword: 'Brandnew123' })).status, 400);
    assert.equal((await a('POST', '/api/auth/change-password', { oldPassword: PW, newPassword: 'Brandnew123' })).status, 200);
    assert.equal((await b('GET', '/api/meta')).status, 401);
    await app.as('fi', 'Brandnew123');
  });
  await t.test('admin reset forces a password change before anything else', async () => {
    const sa = await app.as('sa');
    const r = await sa('POST', '/api/admin/users/reset?id=au'); assert.equal(r.status, 200); assert.ok(r.json.temporaryPassword);
    const au = await app.as('au', r.json.temporaryPassword);
    assert.equal(au.meta.user.mustChange, true);
    assert.equal((await au('GET', '/api/t/opening-stock')).status, 403);
    assert.equal((await au('POST', '/api/auth/change-password', { oldPassword: r.json.temporaryPassword, newPassword: 'Auditor2026ok' })).status, 200);
  });
  await t.test('logout closes the session row', async () => {
    const c = await app.as('wm'); await c('POST', '/api/auth/logout');
    const rows = (await app.store.read('Login Sessions')).rows.filter((r) => r['User ID'] === 'wm');
    assert.equal(rows.at(-1).Status, 'Closed');
  });
});
