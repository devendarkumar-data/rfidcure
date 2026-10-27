import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import handler from '../server/router.js';
import { setStore } from '../server/store/index.js';
import { MemoryStore } from '../server/store/memory.js';
import { _resetThrottle } from '../server/auth.js';

process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.STORE = 'memory';
export const PW = 'Test12345pass';
const OPEN = (wh, code, name, batch, qty, exp, val) => ({ Warehouse: wh, 'Item Code': code, 'Item Name': name, 'Item Category Type Name': 'DEX & BIO', 'Batch Number': batch, Quantity: qty, 'Expiry Date': exp, 'Brand Name': 'ARTHREX', 'Stock Value': val });

export async function makeApp({ store: given } = {}) {
  const store = given || new MemoryStore(); setStore(store); _resetThrottle();
  await store.replaceAll?.('Opening Stock', [
    OPEN('MWH', 'A1', 'Item A', 'B-LATE', 10, '2030-01-01', 1000),
    OPEN('MWH', 'A1', 'Item A', 'B-EARLY', 5, '2029-06-30', 600),
    OPEN('MWH', 'A1', 'Item A', 'B-OLD', 4, '2020-01-01', 400),
    OPEN('DWH', 'A1', 'Item A', 'B-LATE', 3, '2030-01-01', 300),
    OPEN('DWH', 'C3', 'Item C', 'C-1', 8, '2031-01-01', 800),
    OPEN('CWH', 'A1', 'Item A', 'B-LATE', 2, '2030-01-01', 200),
  ]);
  const users = [
    ['sa', 'Super One', 'Super Admin', ''], ['ad', 'Admin One', 'Admin', ''], ['wm', 'WM Mother', 'Warehouse Manager', 'MWH'],
    ['wm2', 'WM Delhi', 'Warehouse Manager', 'DWH'], ['pu', 'Purchase', 'Purchase Team', 'MWH'], ['sl', 'Sales', 'Sales Team', 'CWH'],
    ['fi', 'Finance', 'Finance Team', ''], ['au', 'Auditor', 'Auditor', ''], ['de', 'Data Entry', 'Data Entry Operator', 'MWH'],
    ['off', 'Left Company', 'Warehouse Manager', 'MWH'], ['mo', 'Mother Operator', 'Mother Warehouse Operator', 'MWH'], ['ap', 'Approver', 'Approver', ''], ['wo', 'Delhi Operator', 'Warehouse Operator', 'DWH'],
  ];
  const hash = bcrypt.hashSync(PW, 4);
  for (const [id, name, role, branch] of users) {
    await store.append('Users', [{ 'User ID': id, 'User Name': name, Role: role, Branch: branch, Status: id === 'off' ? 'Inactive' : 'Active' }]);
    await store.append('Credentials', [{ 'User ID': id, Email: '', 'Password Hash': hash, 'Must Change Password': 'No', 'Failed Attempts': 0, 'Locked Until': '', 'Password Updated': '2026-01-01T00:00:00.000Z' }]);
  }
  const server = createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (cookie = '') => async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'cure-erp', ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  const anon = api();
  async function as(id, password = PW) {
    const r = await anon('POST', '/api/auth/login', { userId: id, password });
    if (r.status !== 200) throw new Error(`login ${id} failed: ${r.status} ${r.text}`);
    const set = r.headers.get('set-cookie'); const cookie = set.split(';')[0];
    const call = api(cookie); call.cookie = cookie; call.meta = r.json; return call;
  }
  return { store, server, anon, as, close: () => new Promise((r) => server.close(r)) };
}
export const grn = (wh, lines, extra = {}) => ({ header: { Date: '2026-10-26', Warehouse: wh, 'Update Stock': 'Yes', ...extra }, lines });
