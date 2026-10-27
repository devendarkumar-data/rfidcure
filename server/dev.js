// Local API server (used by `npm run dev`). In production Vercel runs api/handler.js instead.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { setStore } from './store/index.js';
import { MemoryStore } from './store/memory.js';
import handler from './router.js';
import { config } from './config.js';

if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (!m || line.trim().startsWith('#')) continue;
  process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
process.env.SESSION_SECRET ||= 'dev-only-secret-change-me-dev-only-secret-0000';
const port = Number(process.env.API_PORT || 3001);

if (config().storeKind === 'memory') {
  // Dev convenience: seed the in-memory store with the opening stock and a demo Super Admin.
  const { default: bcrypt } = await import('bcryptjs');
  const s = new MemoryStore(); setStore(s);
  const rows = JSON.parse(readFileSync(new URL('../data/opening-stock.dev-seed.json', import.meta.url), 'utf8'));
  const H = ['Warehouse', 'Item Code', 'Item Name', 'Item Category Type Name', 'Batch Number', 'Quantity', 'Expiry Date', 'Brand Name', 'Stock Value'];
  await s.replaceAll('Opening Stock', rows.map((r) => Object.fromEntries(H.map((h, i) => [h, r[i]]))));
  const demo = [['admin', 'Dev Super Admin', 'Super Admin', ''], ['wm', 'Dev Warehouse Manager', 'Warehouse Manager', 'MWH'], ['audit', 'Dev Auditor', 'Auditor', ''], ['entry', 'Dev Data Entry', 'Data Entry Operator', 'MWH']];
  for (const [id, name, role, branch] of demo) {
    await s.append('Users', [{ 'User ID': id, 'User Name': name, Role: role, Branch: branch, Status: 'Active' }]);
    await s.append('Credentials', [{ 'User ID': id, Email: '', 'Password Hash': bcrypt.hashSync('Dev12345pass', 10), 'Must Change Password': 'No', 'Failed Attempts': 0, 'Password Updated': '2026-01-01T00:00:00.000Z' }]);
  }
  console.log('[dev] in-memory store seeded: 3293 opening-stock rows; users admin / wm / audit / entry, password Dev12345pass (development only)');
}
createServer((req, res) => handler(req, res)).listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
