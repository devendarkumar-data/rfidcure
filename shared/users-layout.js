// The Users worksheet layout is: Groups | User Name | Phone | Email | Password | Branch | Status | Last Login.
// The application works with a canonical user record (User ID, Role, Branch, Status, ...). These helpers translate
// between the two so the rest of the code does not care how the sheet is laid out.
//   User ID = Email (people sign in with their e-mail address)
//   Role    = first entry of the comma-separated Groups cell that is a valid role name (Admin, Sales, Sales Team, ...)
//   Branch  = Branch cell, blank means "All Branch";  Status = Status cell, blank means Active
import { roleKey, ROLE_LABELS } from './permissions.js';

export const USERS_SHEET_HEADERS = ['Groups', 'User Name', 'Phone', 'Email', 'Password', 'Branch', 'Status', 'Last Login'];
const ORDER = ['super_admin', 'admin', 'purchase_manager', 'approver', 'warehouse_manager', 'purchase', 'warehouse_operator', 'mother_warehouse_operator', 'sales', 'finance', 'auditor', 'data_entry'];

export function roleFromGroups(groups) {
  const keys = String(groups ?? '').split(/[,;|/]+/).map((t) => roleKey(t)).filter(Boolean);
  if (!keys.length) return '';
  keys.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return ROLE_LABELS[keys[0]] || '';
}

export function userFromSheet(r) {
  return {
    ...r,
    'User ID': String(r.Email ?? '').trim(), Role: roleFromGroups(r.Groups),
    Branch: String(r.Branch ?? '').trim() || 'All Branch', Status: String(r.Status ?? '').trim() || 'Active',
  };
}

// canonical -> sheet columns (full record, for append)
export function userToSheet(o) {
  return {
    Groups: o.Groups ?? o.Role ?? '', 'User Name': o['User Name'] ?? '', Phone: o.Phone ?? '', Email: o.Email || o['User ID'] || '',
    Password: o.Password ?? '', Branch: o.Branch === 'All Branch' ? '' : (o.Branch ?? ''), Status: o.Status ?? '', 'Last Login': o['Last Login'] ?? '',
  };
}

// canonical patch -> sheet patch (only the keys present)
export function patchToSheet(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (k === 'Role') out.Groups = v; else if (k === 'User ID') out.Email = v;
    else if (k === 'Branch') out.Branch = v === 'All Branch' ? '' : v;
    else out[k] = v;
  }
  return out;
}
export const expectToSheet = (e) => (e && e.col === 'User ID' ? { ...e, col: 'Email' } : e);
