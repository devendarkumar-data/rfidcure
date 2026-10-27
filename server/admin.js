// User administration (Users + Credentials tabs). Only Super Admin / Admin (stage 'admin').
import { randomBytes } from 'node:crypto';
import { can, ROLE_LABELS, roleKey } from '../shared/permissions.js';
import { ROLE_INFO } from '../shared/users-layout.js';

import { audit, activity } from './audit.js';
import { checkPasswordPolicy, getSettings, hashPassword, parseWarehouses } from './auth.js';
import { warehouseList } from './crud.js';
import { bad, conflict, forbidden, notFound, sstr, withLock } from './util.js';

const adminOnly = (ctx, action) => { if (!can(ctx.user.role, 'admin', action)) throw forbidden('Only administrators can manage users'); if (ctx.user.scope.mode === 'all-readonly') throw forbidden(); };
export const tempPassword = () => `Cs-${randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')}9`;
const ID_RE = /^[A-Za-z0-9._+@-]{3,60}$/;

function pub(row, cred) {
  return { 'User ID': sstr(row['User ID']), 'User Name': sstr(row['User Name']), Role: sstr(row.Role), Branch: sstr(row.Branch), Status: sstr(row.Status), 'Last Login': sstr(row['Last Login']),
    Phone: sstr(row.Phone), Email: sstr(row.Email) || sstr(cred?.Email), Groups: sstr(row.Groups), 'Password Status': sstr(row.Password) ? 'Pending first login' : cred?.['Password Hash'] ? 'Set' : 'Not set', 'Must Change Password': sstr(cred?.['Must Change Password']), Locked: !!(cred && Date.parse(cred['Locked Until'] || '') > Date.now()) };
}
// An Admin must never be able to create, change or lock out a Super Admin (privilege escalation).
function assertMayTouch(ctx, targetRoleLabel, newRoleLabel) {
  const isSuper = ctx.user.role === 'super_admin';
  if (!isSuper && (roleKey(targetRoleLabel) === 'super_admin' || roleKey(newRoleLabel) === 'super_admin')) throw forbidden('Only a Super Admin can manage Super Admin accounts');
}

export async function listUsers(ctx) {
  adminOnly(ctx, 'view');
  const [u, c, wh] = await Promise.all([ctx.store.read('Users'), ctx.store.read('Credentials'), warehouseList(ctx.store)]);
  const creds = new Map(c.rows.map((r) => [sstr(r['User ID']).toLowerCase(), r]));
  return { rows: u.rows.map((r) => pub(r, creds.get(sstr(r['User ID']).toLowerCase()))), roles: Object.values(ROLE_LABELS), roleInfo: ROLE_INFO, warehouses: wh };
}

async function validateUser(ctx, b, { creating }) {
  const roleLabel = sstr(b.Role);
  if (!roleKey(roleLabel)) throw bad(`Role must be one of: ${Object.values(ROLE_LABELS).join(', ')}`);
  const canonical = ROLE_LABELS[roleKey(roleLabel)];
  const name = sstr(b['User Name']); if (!name || name.length > 80) throw bad('User Name is required (max 80 characters)');
  const status = sstr(b.Status || 'Active'); if (!/^(active|inactive)$/i.test(status)) throw bad('Status must be Active or Inactive');
  const branch = /^\s*all(\s+branch(es)?)?\s*$/i.test(sstr(b.Branch)) ? '' : parseWarehouses(b.Branch).join(', ');
  const key = roleKey(canonical);
  const wl = (await warehouseList(ctx.store)).map((x) => x.toUpperCase());
  const bad_ = parseWarehouses(branch).filter((w) => wl.length && !wl.includes(w));
  if (bad_.length) throw bad(`Unknown warehouse(s) in Branch: ${bad_.join(', ')}`);
  if (key && !['super_admin', 'admin', 'finance', 'auditor'].includes(key) && !branch) throw bad(`${canonical} needs at least one assigned warehouse in Branch`);
  const email = sstr(b.Email); if (creating && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email is not valid');
  return { 'User Name': name, Role: canonical, Branch: branch, Status: status[0].toUpperCase() + status.slice(1).toLowerCase(), Email: email, Phone: sstr(b.Phone).slice(0, 20) };
}

export async function createUser(ctx, b) {
  adminOnly(ctx, 'create');
  return withLock('users', async () => {
    const id = sstr(b['User ID'] || b.Email); if (!ID_RE.test(id)) throw bad('User ID (e-mail) must be 3-60 letters, numbers or . _ + - @');
    const v = await validateUser(ctx, b, { creating: true });
    assertMayTouch(ctx, '', v.Role);
    const { rows } = await ctx.store.read('Users', { fresh: true });
    if (rows.some((r) => sstr(r['User ID']).toLowerCase() === id.toLowerCase())) throw conflict('User ID already exists');
    const pw = sstr(b.Password) || tempPassword();
    checkPasswordPolicy(pw, await getSettings(ctx.store, 'Security'), id);
    await ctx.store.append('Users', [{ 'User ID': id, 'User Name': v['User Name'], Phone: v.Phone, Email: v.Email || id, Role: v.Role, Branch: v.Branch, Status: v.Status, 'Last Login': '' }]);
    await ctx.store.append('Credentials', [{ 'User ID': id, Email: v.Email, 'Password Hash': await hashPassword(pw), 'Must Change Password': 'Yes', 'Failed Attempts': 0, 'Locked Until': '', 'Password Updated': new Date().toISOString() }]);
    await audit(ctx.store, { user: ctx.user, module: 'Users', doc: id, action: 'Create', next: { ...v } });
    return { id, temporaryPassword: pw };
  });
}

export async function updateUser(ctx, id, b) {
  adminOnly(ctx, 'edit');
  return withLock('users', async () => {
    const { rows } = await ctx.store.read('Users', { fresh: true });
    const row = rows.find((r) => sstr(r['User ID']).toLowerCase() === sstr(id).toLowerCase());
    if (!row) throw notFound('User not found');
    const v = await validateUser(ctx, { ...pub(row), ...b }, { creating: false });
    assertMayTouch(ctx, row.Role, v.Role);
    if (sstr(row['User ID']).toLowerCase() === ctx.user.id.toLowerCase() && (/inactive/i.test(v.Status) || roleKey(v.Role) !== ctx.user.role)) throw forbidden('You cannot deactivate yourself or change your own role');
    if (roleKey(row.Role) === 'super_admin' && (/inactive/i.test(v.Status) || roleKey(v.Role) !== 'super_admin')) {
      const others = rows.filter((r) => roleKey(r.Role) === 'super_admin' && /^active$/i.test(sstr(r.Status)) && r !== row);
      if (!others.length) throw conflict('At least one active Super Admin must remain');
    }
    await ctx.store.updateRow('Users', row.__row, { 'User Name': v['User Name'], Phone: v.Phone, Role: v.Role, Branch: v.Branch, Status: v.Status }, { col: 'User ID', val: row['User ID'] });
    if (false) {
      const c = (await ctx.store.read('Credentials', { fresh: true })).rows.find((r) => sstr(r['User ID']).toLowerCase() === sstr(id).toLowerCase());
      if (c) await ctx.store.updateRow('Credentials', c.__row, { Email: v.Email });
    }
    await audit(ctx.store, { user: ctx.user, module: 'Users', doc: row['User ID'], action: 'Update', prev: { 'User Name': row['User Name'], Role: row.Role, Branch: row.Branch, Status: row.Status }, next: { 'User Name': v['User Name'], Role: v.Role, Branch: v.Branch, Status: v.Status } });
    return { ok: true };
  });
}

// No e-mail service is configured, so a reset issues a one-time temporary password the administrator hands over.
export async function resetPassword(ctx, id) {
  adminOnly(ctx, 'edit');
  return withLock('users', async () => {
    const { rows } = await ctx.store.read('Users', { fresh: true });
    const row = rows.find((r) => sstr(r['User ID']).toLowerCase() === sstr(id).toLowerCase());
    if (!row) throw notFound('User not found');
    assertMayTouch(ctx, row.Role, '');
    const cred = (await ctx.store.read('Credentials', { fresh: true })).rows.find((r) => sstr(r['User ID']).toLowerCase() === sstr(id).toLowerCase());
    const pw = tempPassword();
    const patch = { 'Password Hash': await hashPassword(pw), 'Must Change Password': 'Yes', 'Failed Attempts': 0, 'Locked Until': '', 'Password Updated': new Date().toISOString() };
    if (cred) await ctx.store.updateRow('Credentials', cred.__row, patch);
    else await ctx.store.append('Credentials', [{ 'User ID': row['User ID'], Email: '', ...patch }]);
    await audit(ctx.store, { user: ctx.user, module: 'Users', doc: row['User ID'], action: 'Reset Password' });
    await activity(ctx.store, { user: ctx.user, event: 'Password Reset', module: 'M01', doc: row['User ID'], action: 'Reset Password' });
    return { id: row['User ID'], temporaryPassword: pw };
  });
}
