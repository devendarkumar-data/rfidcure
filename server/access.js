// Server-side authorisation: stage permissions, warehouse scope and field-level control.
// Every protected route goes through these helpers. The UI hides things too, but this is the real gate.
import { canTab, fieldAccess } from '../shared/permissions.js';
import { forbidden, sstr } from './util.js';

export function assertCan(ctx, table, action) {
  if (!canTab(ctx.user.role, table.stage, table.tab, action)) throw forbidden(`Your role (${ctx.user.roleLabel}) cannot ${action} ${table.tab}`);
  if (['create', 'edit', 'delete', 'approve'].includes(action) && ctx.user.scope.mode === 'all-readonly') throw forbidden('Your account is read-only');
}
export const canDo = (ctx, table, action) => {
  try { assertCan(ctx, table, action); return true; } catch { return false; }
};

const norm = (v) => sstr(v).toUpperCase();
export const inScope = (ctx, wh) => {
  const s = ctx.user.scope;
  if (s.mode === 'all' || s.mode === 'all-readonly') return true;
  return s.warehouses.includes(norm(wh));
};
export function assertWarehouses(ctx, list, what = 'warehouse') {
  for (const w of list) {
    if (!sstr(w)) continue;
    if (!inScope(ctx, w)) throw forbidden(`You are not assigned to ${what} ${w}`);
  }
}

// Rows visible to the user for a table. Tables without a warehouse column are not warehouse-restricted.
export function rowVisible(ctx, table, row, lines) {
  const s = ctx.user.scope;
  if (s.mode !== 'assigned') return true;
  const hasWhCols = table.wh.length || table.lineFields.some((f) => f.name === 'Warehouse');
  if (!hasWhCols) return true;
  if (table.wh.some((c) => inScope(ctx, row[c]))) return true;
  if (table.lineFields.some((f) => f.name === 'Warehouse')) {
    const ls = lines ?? parseLines(row.Lines);
    return ls.some((l) => inScope(ctx, l.Warehouse));
  }
  return false;
}

export function parseLines(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

// Remove fields the role may not see (field-wise control), including inside line items.
export function maskRow(ctx, row, { keepInternal = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === '__row') { if (keepInternal) out[k] = v; continue; }
    if (k === 'Lines') continue;
    if (fieldAccess(ctx.user.role, k) === 'n') continue;
    out[k] = v;
  }
  return out;
}
export const maskLines = (ctx, lines) => lines.map((l) => {
  const o = {};
  for (const [k, v] of Object.entries(l)) if (fieldAccess(ctx.user.role, k) !== 'n') o[k] = v;
  return o;
});
export const canWriteField = (ctx, name) => fieldAccess(ctx.user.role, name) === 'w';
export const hiddenFields = (ctx, names) => names.filter((n) => fieldAccess(ctx.user.role, n) === 'n');
