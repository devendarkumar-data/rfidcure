// Shared helper for the maintenance scripts: loads .env (never committed) and builds the Sheets store.
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (!m || line.trim().startsWith('#')) continue;
  process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
export async function sheetsStore() {
  const { config } = await import('../server/config.js');
  const c = config();
  for (const k of ['sheetId', 'clientEmail', 'privateKey']) if (!c[k]) { console.error('Missing GOOGLE_SHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY (see .env.example)'); process.exit(1); }
  const { SheetsStore } = await import('../server/store/sheets.js');
  return new SheetsStore({ sheetId: c.sheetId, clientEmail: c.clientEmail, privateKey: c.privateKey });
}
export const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
export const flag = (name) => process.argv.includes(`--${name}`);
export function ask(q, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}
