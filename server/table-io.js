// Import / export / template for master tables (Item Master, Vendor Master, Warehouse Master ...).
// Import is validated row by row with the same rules as the single-record form; nothing is written until the
// caller confirms and the whole file is error-free (all-or-nothing).
import { assertCan, canWriteField } from './access.js';
import { audit } from './audit.js';
import { nextMasterId, validateHeader } from './crud.js';
import { readFile } from './opening.js';
import { HttpError, bad, isBlank, sstr, withLock } from './util.js';

const importable = (table) => table.fields.filter((f) => !f.readonly && f.type !== 'auto' && f.type !== 'calc' && f.name !== table.idCol && f.name !== 'Lines');
export const importColumns = (table) => importable(table).map((f) => f.name);

export async function importTable(ctx, table, body) {
  if (table.kind !== 'master') throw new HttpError(405, `${table.tab} does not support file import`);
  assertCan(ctx, table, 'create');
  const grid = await readFile(body?.filename, body?.content, table.tab);
  if (grid.length < 2) throw bad('The file has no data rows');
  const cols = importable(table).filter((f) => canWriteField(ctx, f.name));
  const head = grid[0].map((h) => sstr(h).toLowerCase());
  const idx = Object.fromEntries(cols.map((f) => [f.name, head.indexOf(f.name.toLowerCase())]));
  const missing = table.required.filter((r) => r in idx && idx[r] < 0);
  if (missing.length) throw bad(`Missing required column(s): ${missing.join(', ')}. Expected headers: ${cols.map((f) => f.name).join(', ')}`);
  const col = table.uniqueCol;
  const { rows: existing } = await ctx.store.read(table.tab, { fresh: true });
  const have = new Set(existing.map((r) => sstr(r[col]).toLowerCase()).filter(Boolean));
  const skipExisting = !!body?.skipExisting;
  const errors = []; const rows = []; const seen = new Map(); let skipped = 0;
  const err = (row, message) => { if (errors.length < 2000) errors.push({ row, message }); };
  for (let i = 1; i < grid.length; i++) {
    const n = i + 1; const g = grid[i];
    const input = {};
    for (const f of cols) { if (idx[f.name] < 0) continue; let v = g[idx[f.name]] ?? ''; if (typeof v === 'string') v = v.trim(); if (!isBlank(v)) input[f.name] = v; }
    if (!Object.keys(input).length) continue;
    let header;
    try { header = await validateHeader(ctx, table, input); } catch (e) { err(n, e instanceof HttpError ? e.message : 'Invalid row'); continue; }
    const key = sstr(header[col]).toLowerCase();
    if (key) {
      if (have.has(key)) { if (skipExisting) { skipped++; continue; } err(n, `${col} "${header[col]}" already exists in ${table.tab}`); continue; }
      if (seen.has(key)) { err(n, `${col} "${header[col]}" is repeated (also on row ${seen.get(key)})`); continue; }
      seen.set(key, n);
    }
    rows.push(header);
  }
  if (!rows.length && !errors.length && !skipped) throw bad('The file has no data rows');
  const counts = { rows: rows.length, errors: errors.length, skipped };
  if (!body?.confirm || errors.length || !rows.length) return { committed: false, counts, errors, sample: rows.slice(0, 10) };
  return withLock(`t:${table.tab}`, async () => {
    const { rows: now } = await ctx.store.read(table.tab, { fresh: true });
    const taken = new Set(now.map((r) => sstr(r[col]).toLowerCase()).filter(Boolean));
    const clash = rows.find((r) => taken.has(sstr(r[col]).toLowerCase()));
    if (clash) throw new HttpError(409, `${col} "${clash[col]}" was added by someone else while you were importing. Check the file again.`);
    let first = await nextMasterId(ctx.store, table); const m = /^(.*-)(\d+)$/.exec(first); let n = Number(m[2]);
    const out = rows.map((r) => ({ ...r, [table.idCol]: `${m[1]}${String(n++).padStart(4, '0')}` }));
    for (let i = 0; i < out.length; i += 400) await ctx.store.append(table.tab, out.slice(i, i + 400));
    await audit(ctx.store, { user: ctx.user, module: table.tab, action: 'Import', remarks: `${out.length} rows added, ${skipped} skipped` });
    return { committed: true, counts, errors: [], sample: [] };
  });
}
