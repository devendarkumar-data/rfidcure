// Tab-level access matrix: None / View / Edit per group per tab, stored in the "Access Control" worksheet
// (one row per tab, one column per group; a blank cell means "use the built-in default for that group").
import { ACCESS_LEVELS, ACCESS_TAB, ROLE_LABELS, can, defaultLevel, roleKey, setAccessMatrix } from '../shared/permissions.js';
import { TABLES } from '../shared/registry.js';
import { audit } from './audit.js';
import { bad, forbidden, sstr, withLock } from './util.js';

const LOCKED_ROLES = new Set(['super_admin']);          // always full access, never editable
const ADMIN_ONLY_COLUMNS = new Set(['admin']);           // only a Super Admin may change the Admin group's column

export async function loadAccessMatrix(store) {
  const { rows } = await store.read(ACCESS_TAB);
  const m = {};
  for (const r of rows) {
    const tab = sstr(r.Tab); if (!tab) continue;
    for (const [label] of Object.entries(r)) {
      const key = roleKey(label); if (!key || key === 'super_admin') continue;
      const v = sstr(r[label]); const lvl = ACCESS_LEVELS.find((l) => l.toLowerCase() === v.toLowerCase());
      if (lvl) (m[key] ||= {})[tab] = lvl;
    }
  }
  setAccessMatrix(m);
  return m;
}

const manage = (ctx) => { if (!can(ctx.user.role, 'admin', 'edit') || ctx.user.scope.mode === 'all-readonly') throw forbidden('Only administrators can manage access control'); };

export async function accessView(ctx, loaded) {
  if (!can(ctx.user.role, 'admin', 'view')) throw forbidden('Only administrators can view access control');
  const m = loaded || await loadAccessMatrix(ctx.store);
  const roles = Object.entries(ROLE_LABELS).map(([key, label]) => ({ key, label, locked: LOCKED_ROLES.has(key) || (ADMIN_ONLY_COLUMNS.has(key) && ctx.user.role !== 'super_admin') }));
  const rows = TABLES.filter((t) => t.slug !== 'users').map((t) => ({
    tab: t.tab, module: t.moduleName, stage: t.stage,
    levels: Object.fromEntries(roles.map((r) => {
      const explicit = m[r.key]?.[t.tab] || null;
      return [r.key, LOCKED_ROLES.has(r.key) ? { level: 'Edit', explicit: false } : { level: explicit || defaultLevel(r.key, t.stage, t.tab), explicit: !!explicit }];
    })),
  }));
  rows.push({ tab: 'Users', module: 'Login & User Management', stage: 'admin', levels: Object.fromEntries(roles.map((r) => { const e = m[r.key]?.Users || null; return [r.key, LOCKED_ROLES.has(r.key) ? { level: 'Edit', explicit: false } : { level: e || defaultLevel(r.key, 'admin', 'Users'), explicit: !!e }]; })) });
  return { roles, rows: rows.sort((a, b) => a.module.localeCompare(b.module) || a.tab.localeCompare(b.tab)), levels: ACCESS_LEVELS };
}

// level = 'None' | 'View' | 'Edit' | '' (reset to the default)
export async function setAccess(ctx, b) {
  manage(ctx);
  const tab = sstr(b.tab); const role = roleKey(b.role); const level = sstr(b.level);
  if (!tab || !role) throw bad('tab and role are required');
  if (level && !ACCESS_LEVELS.includes(level)) throw bad('level must be None, View or Edit');
  if (!TABLES.some((t) => t.tab === tab) && tab !== 'Users') throw bad('Unknown tab');
  if (LOCKED_ROLES.has(role)) throw forbidden('Super Admin always has full access');
  if (ADMIN_ONLY_COLUMNS.has(role) && ctx.user.role !== 'super_admin') throw forbidden('Only a Super Admin can change the Admin group');
  if (role === ctx.user.role && ['Users', ACCESS_TAB].includes(tab) && level === 'None') throw forbidden('You cannot remove your own access to user management');
  const label = ROLE_LABELS[role];
  return withLock('access', async () => {
    const { rows } = await ctx.store.read(ACCESS_TAB, { fresh: true });
    const row = rows.find((r) => sstr(r.Tab) === tab);
    const prev = row ? sstr(row[label]) : '';
    if (row) await ctx.store.updateRow(ACCESS_TAB, row.__row, { [label]: level }, { col: 'Tab', val: tab });
    else if (level) await ctx.store.append(ACCESS_TAB, [{ Tab: tab, [label]: level }]);
    await audit(ctx.store, { user: ctx.user, module: ACCESS_TAB, doc: tab, action: 'Update', prev: { [label]: prev }, next: { [label]: level || '(default)' } });
    await loadAccessMatrix(ctx.store);
    return { ok: true };
  });
}
