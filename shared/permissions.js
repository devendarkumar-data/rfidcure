// Single source of truth for the access matrix (stage-wise, warehouse-wise, field-wise).
// Transcribed from the "Access Control Design" image. Change access here and nowhere else.
//
// Stages = columns of the matrix. 'admin' is an extra stage that covers every tab the matrix does not
// mention (masters, RFID, E-Way Bill, indents, Tally, configuration, audit ...). By decision it is
// Super Admin / Admin only.

export const STAGES = ['intent', 'po', 'grn', 'transfer', 'imprest', 'consumption', 'dispatch', 'billing', 'requisition', 'reports', 'admin'];

export const STAGE_LABELS = {
  intent: 'Purchase Intent', po: 'PO', grn: 'GRN', transfer: 'Stock Transfer', imprest: 'Imprest In/Out', consumption: 'Material Consumption',
  dispatch: 'Dispatch', billing: 'Billing', requisition: 'Purchase Requisition', reports: 'Reports', admin: 'Administration & other modules',
};

const R = ['view', 'export'];
const W = ['view', 'create', 'edit', 'export'];
const WA = [...W, 'approve'];
const ALL = [...WA, 'delete'];
const AP = ['view', 'approve', 'export']; // approver: sees the queue and decides, does not create

// role -> stage -> allowed actions. A missing stage means no access ("-" in the matrix).
export const ROLE_STAGE_ACTIONS = {
  super_admin: { intent: ALL, po: ALL, grn: ALL, transfer: ALL, imprest: ALL, consumption: ALL, dispatch: ALL, billing: ALL, requisition: ALL, reports: ALL, admin: ALL },
  admin: { intent: WA, po: WA, grn: WA, transfer: WA, imprest: WA, consumption: WA, dispatch: WA, requisition: WA, reports: WA, admin: ALL }, // Billing: "-"
  warehouse_manager: { intent: W, grn: WA, transfer: WA, imprest: WA, consumption: WA, dispatch: WA, requisition: WA, reports: R },        // PO: "-", Billing: "-"
  purchase: { intent: R, po: W, grn: W, requisition: R, reports: R },
  // Purchase Indents and POs are approved / rejected / authorised ONLY by Super Admin, Admin and Approver. Everyone else who raises them has W (no 'approve').
// Added for the Purchase Intent / PO authorization workflow (not in the original matrix image - please confirm):
  purchase_manager: { intent: W, po: W, grn: R, requisition: R, reports: R },
  warehouse_operator: { intent: W, grn: ['view', 'create'], requisition: W, reports: R },
  // Central stock operations at the Mother Warehouse: raises indents, receives goods, approves and dispatches requisitions.
  mother_warehouse_operator: { intent: W, grn: ['view', 'create'], transfer: W, imprest: W, consumption: W, requisition: WA, reports: R },
  // Works the authorization queues (intents, POs, requisitions); does not raise documents.
  approver: { intent: AP, po: AP, requisition: AP, reports: R },
  sales: { dispatch: W, billing: W, reports: R },
  finance: { billing: W, reports: R },
  auditor: { reports: R },
  // 'All': every warehouse, view + edit on all operational and master tabs. User/security administration stays with Admin / Super Admin.
  all: { intent: [...W, 'delete'], po: [...W, 'delete'], grn: ALL, transfer: ALL, imprest: ALL, consumption: ALL, dispatch: ALL, billing: ALL, requisition: ALL, reports: ALL, admin: WA },
  data_entry: { grn: ['view', 'create'] },                                                                   // Reports: "-"
};

export const ROLE_LABELS = {
  super_admin: 'Super Admin', admin: 'Admin', purchase_manager: 'Purchase Manager', mother_warehouse_operator: 'Mother Warehouse Operator', warehouse_operator: 'Warehouse Operator',
  approver: 'Approver', warehouse_manager: 'Warehouse Manager', purchase: 'Purchase Team',
  sales: 'Sales Team', finance: 'Finance Team', auditor: 'Auditor', data_entry: 'Data Entry Operator', all: 'All',
};

// Warehouse-wise access. all = every warehouse, read+write (as far as the stage allows).
// all-readonly = every warehouse but never write (Auditor "View Only"). assigned = only warehouses listed in Users.Branch.
export const ROLE_SCOPE = {
  super_admin: 'all', admin: 'all', all: 'all', finance: 'all', auditor: 'all-readonly', purchase_manager: 'all', approver: 'all', mother_warehouse_operator: 'assigned', warehouse_operator: 'assigned',
  warehouse_manager: 'assigned', purchase: 'assigned', sales: 'assigned', data_entry: 'assigned',
};

// Field-wise control. Groups = headings of the matrix. w = read+write, r = read only, n = hidden.
// The matrix has 9 tick columns under 7 headings; we read it as: Quantity = first of its two columns,
// GST/Tax = second of its two columns. Any other reading is a one-line change here.
const w = 'w', r = 'r', n = 'n';
export const FIELD_GROUPS = ['item', 'batch', 'expiry', 'quantity', 'customer', 'tax', 'status'];
export const ROLE_FIELD_ACCESS = {
  all:               { item: w, batch: w, expiry: w, quantity: w, customer: w, tax: w, status: w },
  super_admin:       { item: w, batch: w, expiry: w, quantity: w, customer: w, tax: w, status: w },
  admin:             { item: w, batch: w, expiry: w, quantity: w, customer: w, tax: w, status: w },
  warehouse_manager: { item: w, batch: w, expiry: w, quantity: w, customer: n, tax: n, status: w },
  purchase:          { item: w, batch: w, expiry: w, quantity: w, customer: n, tax: n, status: w },
  sales:             { item: w, batch: w, expiry: w, quantity: w, customer: w, tax: w, status: w },
  finance:           { item: n, batch: n, expiry: n, quantity: n, customer: w, tax: w, status: w },
  auditor:           { item: n, batch: n, expiry: n, quantity: n, customer: n, tax: n, status: r },
  data_entry:        { item: w, batch: w, expiry: w, quantity: w, customer: n, tax: n, status: n },
  purchase_manager:  { item: w, batch: w, expiry: w, quantity: w, customer: n, tax: w, status: w },
  warehouse_operator: { item: w, batch: w, expiry: w, quantity: w, customer: n, tax: n, status: w },
  mother_warehouse_operator: { item: w, batch: w, expiry: w, quantity: w, customer: n, tax: n, status: w },
  approver:          { item: r, batch: r, expiry: r, quantity: r, customer: n, tax: r, status: r },
};

// Column / line-field names that belong to each group.
export const FIELD_GROUP_OF = {};
const add = (g, names) => names.forEach((nm) => (FIELD_GROUP_OF[nm] = g));
add('item', ['Item Code', 'Item Name', 'Items', 'Item', 'Description', 'Brand Name', 'Item Category Type Name']);
add('batch', ['Batch Number', 'Batch']);
add('expiry', ['Expiry Date']);
add('quantity', ['Quantity', 'Accepted Qty', 'Received Qty', 'Ordered Qty', 'Rejected / Damaged Qty', 'System Qty', 'Closing Stock',
  'Requested Qty', 'Approved Qty', 'Fulfilled Qty', 'Pending Qty', 'Excess Qty']);
add('customer', ['Customer Account', 'Customer']);
add('tax', ['CGST', 'SGST', 'IGST', 'HSN', 'Is IGST']);
add('status', ['Status', 'Authorization_Status', 'Link_Status', 'Receipt Status', 'Submit For Approval', 'Submit for Approval']);

export function roleKey(label) {
  const s = String(label || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!s) return null;
  if (s === 'all') return 'all';
  if (s.startsWith('super')) return 'super_admin';
  if (s.startsWith('admin')) return 'admin';
  if (s.startsWith('purchase manager')) return 'purchase_manager';
  if (s.startsWith('purchase')) return 'purchase';
  if (s.startsWith('mother warehouse')) return 'mother_warehouse_operator';
  if (s.startsWith('approver')) return 'approver';
  if (s.startsWith('warehouse operator')) return 'warehouse_operator';
  if (s.startsWith('sales')) return 'sales';
  if (s.startsWith('warehouse')) return 'warehouse_manager';
  if (s.startsWith('finance')) return 'finance';
  if (s.startsWith('audit')) return 'auditor';
  if (s.startsWith('data entry')) return 'data_entry';
  return null;
}

// ---- tab-level access matrix (Administration > Access Control) -----------------------------------------------------
// Explicit cells (None / View / Edit per group per tab) override the stage defaults above. The matrix lives in the
// "Access Control" worksheet; the server loads it on every request and calls setAccessMatrix().
export const ACCESS_LEVELS = ['None', 'View', 'Edit'];
export const ACCESS_TAB = 'Access Control';
// Workflow code checks permissions per stage; these tabs stand in for their stage.
export const STAGE_REP = { intent: 'Purchase Indent', po: 'Purchase Order — Domestic', grn: 'GRN  MRN', transfer: 'Stock Transfer', imprest: 'Imprest Out — New', consumption: 'Material Consumption', requisition: 'Purchase Requisition', admin: 'Users' };
// Built-in defaults: the 'All' group does not manage users or security unless the matrix says so.
const DEFAULT_NONE = { all: new Set(['Users', ACCESS_TAB, 'Security', 'Backup', 'Configuration', 'Audit Logs']) };
let MATRIX = {};
export const setAccessMatrix = (m) => { MATRIX = m || {}; };
export const explicitLevel = (role, tab) => MATRIX[role]?.[tab] || null;
function applyLevel(role, base, tab) {
  if (role === 'super_admin' || !tab) return base;
  const lvl = MATRIX[role]?.[tab] || (DEFAULT_NONE[role]?.has(tab) ? 'None' : null);
  if (!lvl) return base;
  if (lvl === 'None') return [];
  if (lvl === 'View') return ['view', 'export'];
  return [...new Set([...base, 'view', 'create', 'edit', 'export'])];
}
export const actionsForTab = (role, stage, tab) => applyLevel(role, ROLE_STAGE_ACTIONS[role]?.[stage] || [], tab);
export const actionsFor = (role, stage) => applyLevel(role, ROLE_STAGE_ACTIONS[role]?.[stage] || [], STAGE_REP[stage]);
export const can = (role, stage, action) => actionsFor(role, stage).includes(action);
export const canTab = (role, stage, tab, action) => actionsForTab(role, stage, tab).includes(action);
// level a role has by default (no explicit matrix cell) on a tab of the given stage
export function defaultLevel(role, stage, tab) {
  if (DEFAULT_NONE[role]?.has(tab)) return 'None';
  const a = ROLE_STAGE_ACTIONS[role]?.[stage] || [];
  return a.includes('create') || a.includes('edit') ? 'Edit' : a.includes('view') ? 'View' : 'None';
}
export const stagesOf = (role) => Object.keys(ROLE_STAGE_ACTIONS[role] || {});
export const fieldAccess = (role, name) => {
  const g = FIELD_GROUP_OF[name];
  if (!g) return w;
  return ROLE_FIELD_ACCESS[role]?.[g] || n;
};
export const groupAccess = (role, group) => ROLE_FIELD_ACCESS[role]?.[group] || n;
