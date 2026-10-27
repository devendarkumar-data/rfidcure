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
  // Added for the Purchase Intent / PO authorization workflow (not in the original matrix image - please confirm):
  purchase_manager: { intent: WA, po: WA, grn: R, requisition: R, reports: R },
  warehouse_operator: { intent: W, grn: ['view', 'create'], requisition: W, reports: R },
  // Central stock operations at the Mother Warehouse: raises indents, receives goods, approves and dispatches requisitions.
  mother_warehouse_operator: { intent: W, grn: ['view', 'create'], transfer: W, imprest: W, consumption: W, requisition: WA, reports: R },
  // Works the authorization queues (intents, POs, requisitions); does not raise documents.
  approver: { intent: AP, po: AP, requisition: AP, reports: R },
  sales: { dispatch: W, billing: W, reports: R },
  finance: { billing: W, reports: R },
  auditor: { reports: R },
  data_entry: { grn: ['view', 'create'] },                                                                   // Reports: "-"
};

export const ROLE_LABELS = {
  super_admin: 'Super Admin', admin: 'Admin', purchase_manager: 'Purchase Manager', mother_warehouse_operator: 'Mother Warehouse Operator', warehouse_operator: 'Warehouse Operator',
  approver: 'Approver', warehouse_manager: 'Warehouse Manager', purchase: 'Purchase Team',
  sales: 'Sales Team', finance: 'Finance Team', auditor: 'Auditor', data_entry: 'Data Entry Operator',
};

// Warehouse-wise access. all = every warehouse, read+write (as far as the stage allows).
// all-readonly = every warehouse but never write (Auditor "View Only"). assigned = only warehouses listed in Users.Branch.
export const ROLE_SCOPE = {
  super_admin: 'all', admin: 'all', finance: 'all', auditor: 'all-readonly', purchase_manager: 'all', approver: 'all', mother_warehouse_operator: 'assigned', warehouse_operator: 'assigned',
  warehouse_manager: 'assigned', purchase: 'assigned', sales: 'assigned', data_entry: 'assigned',
};

// Field-wise control. Groups = headings of the matrix. w = read+write, r = read only, n = hidden.
// The matrix has 9 tick columns under 7 headings; we read it as: Quantity = first of its two columns,
// GST/Tax = second of its two columns. Any other reading is a one-line change here.
const w = 'w', r = 'r', n = 'n';
export const FIELD_GROUPS = ['item', 'batch', 'expiry', 'quantity', 'customer', 'tax', 'status'];
export const ROLE_FIELD_ACCESS = {
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

export const can = (role, stage, action) => !!ROLE_STAGE_ACTIONS[role]?.[stage]?.includes(action);
export const actionsFor = (role, stage) => ROLE_STAGE_ACTIONS[role]?.[stage] || [];
export const stagesOf = (role) => Object.keys(ROLE_STAGE_ACTIONS[role] || {});
export const fieldAccess = (role, name) => {
  const g = FIELD_GROUP_OF[name];
  if (!g) return w;
  return ROLE_FIELD_ACCESS[role]?.[g] || n;
};
export const groupAccess = (role, group) => ROLE_FIELD_ACCESS[role]?.[group] || n;
