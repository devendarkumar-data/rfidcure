// The Users worksheet layout is: Groups | User Name | Phone | Email | Password | Branch | Status | Last Login.
// The application works with a canonical user record (User ID, Role, Branch, Status, ...). These helpers translate
// between the two so the rest of the code does not care how the sheet is laid out.
//   User ID = Email (people sign in with their e-mail address)
//   Role    = first entry of the comma-separated Groups cell that is a valid role name (Admin, Sales, Sales Team, ...)
//   Branch  = Branch cell, blank means "All Branch";  Status = Status cell, blank means Active
import { roleKey, ROLE_LABELS } from './permissions.js';

export const USERS_SHEET_HEADERS = ['Groups', 'User Name', 'Phone', 'Email', 'Password', 'Branch', 'Status', 'Last Login', 'Warehouse'];
const ORDER = ['super_admin', 'admin', 'all', 'purchase_manager', 'approver', 'warehouse_manager', 'purchase', 'warehouse_operator', 'mother_warehouse_operator', 'sales', 'finance', 'auditor', 'data_entry'];

export function roleFromGroups(groups) {
  const keys = String(groups ?? '').split(/[,;|/]+/).map((t) => roleKey(t)).filter(Boolean);
  if (!keys.length) return '';
  keys.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return ROLE_LABELS[keys[0]] || '';
}

export function userFromSheet(r) {
  return {
    ...r,
    'User ID': String(r.Email ?? '').trim() || String(r['User Name'] ?? '').trim(), Role: roleFromGroups(r.Groups),
    Branch: String(r.Warehouse ?? '').trim() || String(r.Branch ?? '').trim() || 'All Branch', Status: String(r.Status ?? '').trim() || 'Active',
  };
}

// canonical -> sheet columns (full record, for append)
export function userToSheet(o) {
  return {
    Groups: o.Groups ?? o.Role ?? '', 'User Name': o['User Name'] ?? '', Phone: o.Phone ?? '', Email: o.Email ?? (o['User ID'] && o['User ID'] !== o['User Name'] ? o['User ID'] : ''),
    Password: o.Password ?? '', Branch: o.Branch === 'All Branch' ? '' : (o.Branch ?? ''), Warehouse: o.Branch === 'All Branch' ? '' : (o.Branch ?? o.Warehouse ?? ''), Status: o.Status ?? '', 'Last Login': o['Last Login'] ?? '',
  };
}

// canonical patch -> sheet patch (only the keys present)
export function patchToSheet(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (k === 'Role') out.Groups = v; else if (k === 'User ID') out.Email = v;
    else if (k === 'Branch') { out.Branch = v === 'All Branch' ? '' : v; out.Warehouse = out.Branch; }
    else out[k] = v;
  }
  return out;
}
export const expectToSheet = (e) => (e && e.col === 'User ID' ? { ...e, col: 'Email' } : e);

// Reference shown on the Admin > Users screen: what each Groups value gives access to.
export const ROLE_INFO = [
  ['Super Admin', 'Everything, including Billing and User management', 'All'],
  ['Admin', 'Everything except Billing, with User management', 'All'],
  ['All', 'View and edit every operational and master tab on every warehouse; no User, Access Control or Security administration', 'All'],
  ['Purchase Manager', 'Purchase Intent and PO with approve, GRN view, Requisition view, Reports', 'All'],
  ['Approver', 'Approve or reject Intents, POs and Requisitions, Reports', 'All'],
  ['Purchase Team', 'Intent view, create and edit POs, GRN, Requisition view, Reports', 'Own warehouse only'],
  ['Warehouse Manager', 'Intent, GRN, Transfer, Imprest, Consumption, Dispatch, Requisition with approve, Reports view', 'Own warehouse only'],
  ['Warehouse Operator', 'Intent, GRN create, Requisition, Reports view', 'Own warehouse only'],
  ['Mother Warehouse Operator', 'Intent, GRN create, Transfer, Imprest, Consumption, Requisition with approve and dispatch, Reports view', 'Own warehouse only'],
  ['Sales Team', 'Dispatch, Billing, Reports view', 'Own warehouse only'],
  ['Finance Team', 'Billing, Reports view', 'All'],
  ['Auditor', 'Reports view only', 'All, read only'],
  ['Data Entry Operator', 'Data entry screens you grant, no approvals', 'Own warehouse only'],
].map(([role, access, warehouse]) => ({ role, access, warehouse }));

// Core columns the Users sheet must have; optional ones are added to the header when missing. Order does not matter
// and extra columns the sheet owner added are preserved.
export const USERS_CORE = ['Groups', 'User Name', 'Phone', 'Email', 'Password'];
