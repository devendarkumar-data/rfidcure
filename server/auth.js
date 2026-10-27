import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';
import { HttpError, istParts, toNum, sstr } from './util.js';
import { roleKey, ROLE_SCOPE } from '../shared/permissions.js';
import { activity } from './audit.js';

import { timingSafeEqual } from 'node:crypto';
const BCRYPT_COST = 10;
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
export const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_COST);
const DUMMY = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export const SETTING_DEFAULTS = {
  Security: { 'Minimum Password Length': 8, 'Password Expiry (days)': 0, 'Enable 2FA': 'No', 'Lock After Failed Attempts': 5, 'IP Whitelist': '' },
  Configuration: { 'Session Timeout (min)': 60 },
};
export async function getSettings(store, tab) {
  const { rows } = await store.read(tab);
  const row = rows[0] || {};
  const out = { ...SETTING_DEFAULTS[tab] };
  for (const [k, v] of Object.entries(row)) if (k !== '__row' && v !== '' && v !== null) out[k] = v;
  return out;
}

export function checkPasswordPolicy(pw, sec, userId = '') {
  const min = Math.max(8, toNum(sec['Minimum Password Length']) || 8);
  if (typeof pw !== 'string' || pw.length < min) throw new HttpError(400, `Password must be at least ${min} characters`);
  if (pw.length > 128) throw new HttpError(400, 'Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'Password must contain letters and numbers');
  if (userId && String(userId).length >= 5 && pw.toLowerCase().includes(String(userId).toLowerCase())) throw new HttpError(400, 'Password must not contain your user id');
}

const key = () => new TextEncoder().encode(config().sessionSecret);
export async function signSession(uid, pu, minutes) {
  return new SignJWT({ pu: String(pu || '') }).setProtectedHeader({ alg: 'HS256' }).setSubject(uid)
    .setIssuedAt().setExpirationTime(`${Math.max(5, minutes)}m`).sign(key());
}
export async function readSession(token) {
  try { const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] }); return payload; } catch { return null; }
}
export function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((c) => { const i = c.indexOf('='); return i < 0 ? [] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }).filter((x) => x.length));
}
export function sessionCookie(token, minutes, secure) {
  return `${config().cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${minutes * 60}${secure ? '; Secure' : ''}`;
}
export const clearCookie = (secure) => `${config().cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export function parseWarehouses(branch) {
  return [...new Set(String(branch || '').split(/[,;/|]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}
export function userView(row) {
  const role = roleKey(row.Role);
  const mode = role ? ROLE_SCOPE[role] : 'assigned';
  return {
    id: sstr(row['User ID']), name: sstr(row['User Name']), roleLabel: sstr(row.Role), role, branch: sstr(row.Branch),
    status: sstr(row.Status), active: /^active$/i.test(sstr(row.Status)),
    scope: { mode, warehouses: mode === 'assigned' ? parseWarehouses(row.Branch) : [] },
    __row: row.__row,
  };
}
export async function findUser(store, id) {
  const { rows } = await store.read('Users');
  const row = rows.find((r) => sstr(r['User ID']).toLowerCase() === sstr(id).toLowerCase());
  return row ? { row, user: userView(row) } : null;
}
async function findCred(store, id, fresh) {
  const { rows } = await store.read('Credentials', { fresh });
  return rows.find((r) => sstr(r['User ID']).toLowerCase() === sstr(id).toLowerCase()) || null;
}

const attempts = new Map(); // IP throttle (best effort, per warm instance) in addition to per-account lockout
function throttle(ip) {
  const now = Date.now(); const a = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  if (a.length >= 20) throw new HttpError(429, 'Too many sign-in attempts. Wait a minute and try again.');
  a.push(now); attempts.set(ip, a);
}
export const _resetThrottle = () => attempts.clear();

export async function login(store, { userId, password }, ip) {
  throttle(ip || 'unknown');
  const fail = new HttpError(401, 'Invalid user id or password');
  if (typeof userId !== 'string' || typeof password !== 'string' || !userId || !password) throw fail;
  const sec = await getSettings(store, 'Security');
  const found = await findUser(store, userId);
  let cred = found ? await findCred(store, found.user.id, true) : null;
  // A plain-text "Password" typed in the Users tab (new user, or an admin reset) is accepted ONCE: it is
  // verified, stored as a bcrypt hash in Credentials, and the cell in the Users tab is cleared.
  const sheetPw = found ? sstr(found.row.Password) : '';
  if (found && sheetPw && safeEq(password, sheetPw)) {
    let must = 'No'; try { checkPasswordPolicy(password, sec, found.user.id); } catch { must = 'Yes'; }
    const rec = { 'Password Hash': await hashPassword(password), 'Must Change Password': must, 'Failed Attempts': 0, 'Locked Until': '', 'Password Updated': new Date().toISOString() };
    if (cred) await store.updateRow('Credentials', cred.__row, rec); else await store.append('Credentials', [{ 'User ID': found.user.id, Email: '', ...rec }]);
    await store.updateRow('Users', found.row.__row, { Password: '' });
    await activity(store, { user: found.user, event: 'Password Set', module: 'M01', action: 'Login', remarks: 'From Users tab; cell cleared' });
    cred = await findCred(store, found.user.id, true);
  }
  const ok = await bcrypt.compare(password, cred?.['Password Hash'] || DUMMY); // always compare: no user-enumeration timing
  if (!found || !cred) throw fail;
  const lockMax = toNum(sec['Lock After Failed Attempts']) || 5;
  const lockedUntil = Date.parse(cred['Locked Until'] || '') || 0;
  if (lockedUntil > Date.now()) throw new HttpError(423, 'Account is temporarily locked. Try again later or ask an administrator.');
  if (!ok) {
    const n = toNum(cred['Failed Attempts']) + 1;
    const patch = { 'Failed Attempts': n };
    if (n >= lockMax) { patch['Locked Until'] = new Date(Date.now() + 15 * 60000).toISOString(); patch['Failed Attempts'] = 0; }
    await store.updateRow('Credentials', cred.__row, patch);
    await activity(store, { user: found.user, event: 'Login Failed', module: 'M01', action: 'Login', remarks: n >= lockMax ? 'Account locked for 15 minutes' : '' });
    throw fail;
  }
  const u = found.user;
  if (!u.active) throw new HttpError(403, 'This account is deactivated. Contact an administrator.');
  if (!u.role) throw new HttpError(403, 'This account has no valid role. Contact an administrator.');
  const wl = String(sec['IP Whitelist'] || '').split(/[\s,;]+/).filter(Boolean);
  if (wl.length && u.role !== 'super_admin' && !wl.includes(ip)) {
    await activity(store, { user: u, event: 'Login Blocked', module: 'M01', action: 'Login', remarks: 'IP not in whitelist' });
    throw new HttpError(403, 'Sign-in from this network is not allowed');
  }
  const expiry = toNum(sec['Password Expiry (days)']);
  const age = cred['Password Updated'] ? (Date.now() - Date.parse(cred['Password Updated'])) / 86400000 : 0;
  const mustChange = /^yes$/i.test(sstr(cred['Must Change Password'])) || (expiry > 0 && age > expiry);
  await store.updateRow('Credentials', cred.__row, { 'Failed Attempts': 0, 'Locked Until': '' });
  const t = istParts();
  await store.updateRow('Users', u.__row, { 'Last Login': `${t.date} ${t.time}` });
  await store.append('Login Sessions', [{ 'User ID': u.id, Created_Date: t.date, Login_Time: t.time, Logout_Time: '', Branch: u.branch, Status: 'Active' }]);
  await activity(store, { user: u, event: 'Login', module: 'M01', action: 'Login' });
  const cfg = await getSettings(store, 'Configuration');
  const minutes = toNum(cfg['Session Timeout (min)']) || config().defaultSessionMinutes;
  const token = await signSession(u.id, cred['Password Updated'], minutes);
  return { token, minutes, user: u, mustChange };
}

export async function logout(store, ctx) {
  if (!ctx) return;
  const { rows } = await store.read('Login Sessions', { fresh: true });
  const open = [...rows].reverse().find((r) => sstr(r['User ID']) === ctx.user.id && sstr(r.Status) === 'Active');
  if (open) await store.updateRow('Login Sessions', open.__row, { Logout_Time: istParts().time, Status: 'Closed' });
  await activity(store, { user: ctx.user, event: 'Logout', module: 'M01', action: 'Logout' });
}

// Returns {user, token?} or throws 401. Re-checks the Users sheet every request: a deactivated user is locked out
// as soon as the (short) Sheets cache expires; a changed password invalidates old sessions.
export async function authenticate(req, store) {
  const token = parseCookies(req.headers.cookie)[config().cookieName];
  if (!token) throw new HttpError(401, 'Not signed in');
  const claims = await readSession(token);
  if (!claims?.sub) throw new HttpError(401, 'Session expired - please sign in again');
  const found = await findUser(store, claims.sub);
  const cred = found ? await findCred(store, found.user.id) : null;
  if (!found || !cred || !found.user.active || !found.user.role) throw new HttpError(401, 'Account is not active');
  if (String(cred['Password Updated'] || '') !== String(claims.pu || '')) throw new HttpError(401, 'Password changed - please sign in again');
  const must = /^yes$/i.test(sstr(cred['Must Change Password']));
  let refreshed = null;
  const age = Date.now() / 1000 - (claims.iat || 0), life = (claims.exp || 0) - (claims.iat || 0);
  if (life > 0 && age > life / 4) {
    const cfg = await getSettings(store, 'Configuration');
    const minutes = toNum(cfg['Session Timeout (min)']) || config().defaultSessionMinutes;
    refreshed = { token: await signSession(found.user.id, cred['Password Updated'], minutes), minutes };
  }
  return { user: found.user, mustChange: must, refreshed, credRow: cred.__row };
}

export async function changePassword(store, ctx, { oldPassword, newPassword }) {
  const cred = await findCred(store, ctx.user.id, true);
  if (!cred || !(await bcrypt.compare(String(oldPassword || ''), cred['Password Hash']))) throw new HttpError(400, 'Current password is incorrect');
  const sec = await getSettings(store, 'Security');
  checkPasswordPolicy(newPassword, sec, ctx.user.id);
  if (await bcrypt.compare(newPassword, cred['Password Hash'])) throw new HttpError(400, 'New password must be different from the current one');
  const stamp = new Date().toISOString();
  await store.updateRow('Credentials', cred.__row, { 'Password Hash': await hashPassword(newPassword), 'Must Change Password': 'No', 'Password Updated': stamp, 'Failed Attempts': 0, 'Locked Until': '' });
  await activity(store, { user: ctx.user, event: 'Password Changed', module: 'M01', action: 'Change Password' });
  const cfg = await getSettings(store, 'Configuration');
  const minutes = toNum(cfg['Session Timeout (min)']) || config().defaultSessionMinutes;
  return { token: await signSession(ctx.user.id, stamp, minutes), minutes };
}
