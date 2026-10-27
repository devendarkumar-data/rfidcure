// Table registry: the ONLY place that decides which worksheets the API may touch, which columns they have,
// who may use them and how they are validated. Worksheet names / headers come from the approved template.
// Nothing the browser sends is ever used as a sheet name, range or spreadsheet id.

import TEMPLATE_TABS from './template-tabs.js';
import { ACCESS_TAB, ROLE_LABELS } from './permissions.js';
import { CURRENCIES, PURCHASE_TYPES } from './po-options.js';

export const slugify = (s) => String(s).toLowerCase().replace(/[—–]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Extra worksheet approved by the owner for password hashes (the Users tab is left untouched).
export const CREDENTIALS_TAB = 'Credentials';
export const CREDENTIALS_HEADERS = ['User ID', 'Email', 'Password Hash', 'Must Change Password', 'Failed Attempts', 'Locked Until', 'Password Updated'];

// Extra worksheets for the intent -> PO authorization -> GRN workflow (new; need owner approval, see README "Schema additions").
export const DOC_STATUS_TAB = 'Doc Status';
export const DOC_STATUS_HEADERS = ['Doc Type', 'Document No.', 'Status', 'Created By', 'Created At', 'Submitted At', 'Reviewed By', 'Reviewed At', 'Review Remarks', 'Source Ref', 'Warehouse', 'Subtotal', 'Tax Total', 'Grand Total', 'Updated At'];
export const DOC_HISTORY_TAB = 'Doc History';
export const DOC_HISTORY_HEADERS = ['Doc Type', 'Document No.', 'Event', 'From Status', 'To Status', 'User ID', 'Date', 'Time', 'Remarks', 'Details'];

export const WAREHOUSE_FIELDS = ['Warehouse', 'From Warehouse', 'To Warehouse', 'Requesting Warehouse', 'Issuing Warehouse', 'Mother Warehouse'];

const M = (tab, col) => ({ master: slugify(tab), col });
const STATE = M('State Master', 'Name');
const CITY = M('City Master', 'Name');
export const REFS = {
  'Customer Account': M('Customer  Hospital Master', 'Hospital Name'),
  Surgery: M('Surgeon Master', 'Surgery Name'),
  Doctor: M('Doctor Master', 'Doctor Name'),
  'Sales Executive': M('Sales Executive Master', 'Salesperson Name'),
  'Vendor Account': M('Vendor Master', 'Vendor Name'),
  'Place of Supply': STATE, 'Ship to State': STATE, 'Dispatch State': STATE,
  'Ship to City': CITY, 'Dispatch City': CITY,
  Brand: M('Brand Master', 'Name'), 'Item Group': M('Item Group Master', 'Name'),
  'Item Category': M('Item Category Master', 'Name'), Division: M('Division Master', 'Division Name'),
  'Receiving Branch': M('Receiving Branch Master', 'Branch Name'),
  Location: M('Warehouse Location Master', 'Name'),
  'Preferred Vendor': M('Vendor Master', 'Vendor Name'),
  Supplier: M('Vendor Master', 'Vendor Name'),
  Companies: { special: 'company' }, 'Business Head': { special: 'bhead' },
};
for (const f of WAREHOUSE_FIELDS) REFS[f] = { special: 'warehouse' };
REFS.Items = REFS.Item = { special: 'item' };

const YN = ['Yes', 'No'];
const INDENT_STATUS = ['Draft', 'Submitted', 'Approved', 'Partially Fulfilled', 'Fulfilled', 'Rejected'];
export { PURCHASE_TYPES, CURRENCIES };
const FIXED_OPTIONS = {
  'Type Of Purchase': PURCHASE_TYPES, Currency: CURRENCIES.map(([c]) => c),
  'Submit For Approval': YN, 'Submit for Approval': YN, 'Is IGST': YN,
  Status: ['Active', 'Inactive'],
};

// ---- tiny DSL (taken from the approved prototype's screen definitions) ----------------------------
// 'Name:Type[:options]|Name:Type' ; Type = Text Number Decimal Date Dropdown Checkbox Longtext Autogen Autofill Calculated Manual Upload
const TYPE_MAP = {
  text: 'text', number: 'number', decimal: 'number', manual: 'number', date: 'date', datepicker: 'date', dropdown: 'select',
  checkbox: 'bool', longtext: 'textarea', 'long text': 'textarea', 'alphanumeric-autogen': 'auto', alphanumeric: 'text',
  autofill: 'calc', calculated: 'calc', upload: 'text', boolean: 'bool', time: 'text',
};
export function parseDsl(str) {
  if (!str) return [];
  return str.split('|').map((part) => {
    const [name, rawType = 'Text', opt] = part.split(':');
    let t = rawType.toLowerCase();
    if (t.startsWith('default-')) t = 'text';
    const f = { name: name.trim(), type: TYPE_MAP[t] || 'text' };
    if (opt && opt.includes(',')) f.options = opt.split(',').map((x) => x.trim());
    return f;
  });
}

function decorate(f, tableOpts = {}) {
  const field = { ...f };
  if (FIXED_OPTIONS[field.name] && !field.options) { field.options = FIXED_OPTIONS[field.name]; field.type = 'select'; }
  if (field.name === 'Indent Type' && !field.options) { field.options = ['In-house', 'Dealer']; field.type = 'select'; }
  if (field.name === 'Status' && tableOpts.indentStatus) { field.options = INDENT_STATUS; field.type = 'select'; }
  if (REFS[field.name] && field.type !== 'calc' && field.type !== 'auto') { field.ref = REFS[field.name]; field.type = 'select'; }
  if (field.type === 'bool' || field.options?.join() === YN.join()) field.yesNo = true;
  return field;
}

// ---- table specifications -------------------------------------------------------------------------
const IMH = 'DocNo:Alphanumeric-Autogen|Date:Date|Customer Account:Dropdown|Surgery:Dropdown|Doctor:Dropdown|Sales Executive:Dropdown|Location:Dropdown|Companies:Dropdown|Narration / Notes:Text|Business Head:Dropdown|OT Name:Text|Place of Supply:Dropdown|Is IGST:Dropdown|Ref. Doc:Text|Ref. Date:Date|Ship to Name:Text|Ship to Address:Long text|Ship to City:Dropdown|Ship to State:Dropdown|Ship to Pin code:Text|To Warehouse:Dropdown|Dispatch Name:Text|Dispatch City:Dropdown|Dispatch Address:Text|Dispatch Pincode:Text|Dispatch State:Dropdown';
const IMH_OUT = 'DocNo:Alphanumeric-Autogen|Date:Date|Customer Account:Dropdown|Surgery:Dropdown|Doctor:Dropdown|Sales Executive:Dropdown|Location:Dropdown|Companies:Dropdown|Narration / Notes:Text|Business Head:Dropdown|OT Name:Text|Place of Supply:Dropdown|Is IGST:Dropdown|Ref. Doc:Text|Ref. Date:Date|Ship to Name:Text|Ship to Address:Long text|Ship to City:Dropdown|Ship to State:Dropdown|Ship to Pin code:Text|To Warehouse:Dropdown|Dispatch Name:Text|Dispatch City:Dropdown|Dispatch Address:Text|Dispatch Pincode:Text|Dispatch State:Dropdown|Supplier:Dropdown|Bill Code:Text';
const IML = 'Consumption Type:Dropdown:Against Consumption,Against Bill|Warehouse:Dropdown|Item:Dropdown|Description:Autofill|Units:Autofill|Quantity:Number|Rate:Number|Gross:Calculated|Batch:Text|Expiry Date:Date';
const IML_OUT = 'Consumption Type:Dropdown:Against Consumption,Against Bill|Warehouse:Dropdown|Item:Dropdown|Description:Autofill|Units:Autofill|Quantity:Number|Rate:Number|Gross:Calculated|Batch:Text|Expiry Date:Date|Delivery Date:Date';
const EWH = 'Document No.:Alphanumeric-Autogen|Date:Date|Ref. Doc:Text|Supply Type:Dropdown:Outward,Inward|Document Type:Dropdown:Tax Invoice,Delivery Challan|Transporter Name:Text|Transporter ID:Text|Transport Mode:Dropdown:Road,Rail,Air,Ship|Vehicle No.:Text|Distance (KM):Number|Ship to State:Dropdown|Dispatch State:Dropdown|E-Way Bill No.:Text|Valid Upto:Date';
const EWL = 'Item:Dropdown|HSN:Text|Quantity:Number|Taxable Value:Number|CGST:Number|SGST:Number|IGST:Number';
const RFID_LINES = null;

// kind: doc (document with Lines JSON) | list (read-only register imported into the sheet) | master | log (append-only record, no id)
//       | settings (single-row) | stockdata (opening stock / ledger, read-only for users) | audit (app-written, read-only)
export const SPECS = [
  { tab: 'Opening Stock', kind: 'stockdata', stage: 'reports', wh: ['Warehouse'] },
  { tab: 'Stock Ledger', kind: 'audit', stage: 'reports', wh: ['Warehouse'], sort: { col: 'Date', dir: 'desc' } },
  { tab: 'Activity Log', kind: 'audit', stage: 'admin', sort: { col: 'Created_Date', dir: 'desc' } },
  { tab: 'Login Sessions', kind: 'audit', stage: 'admin', sort: { col: 'Created_Date', dir: 'desc' } },
  { tab: 'Audit Logs', kind: 'audit', stage: 'admin', sort: { col: 'Created_Date', dir: 'desc' } },

  { tab: 'Purchase Indent', kind: 'doc', stage: 'intent', workflow: 'intent', prefix: 'PI', wh: ['Requesting Warehouse'], required: ['Date', 'Requesting Warehouse'], indentStatus: true,
    lines: 'Items:Dropdown|Description:Text|Units:Text|Current Stock:Number|Quantity:Number|Required By Date:Date|Priority:Dropdown:Low,Normal,High,Urgent|Reason:Text|Approved Qty:Number|Line No:Number' },
  { tab: 'Purchase Indent Pending', kind: 'list', stage: 'intent' },
  { tab: 'Purchase Requisition', kind: 'doc', stage: 'requisition', workflow: 'req', prefix: 'PR', wh: ['Requesting Warehouse', 'Issuing Warehouse'], required: ['Date', 'Requesting Warehouse'],
    form: 'Priority:Dropdown:Low,Normal,High,Urgent',
    lines: 'Items:Dropdown|Units:Text|Current Stock:Number|Mother Stock:Number|Quantity:Number|Approved Qty:Number|Reason:Text|Line No:Number' },
  { tab: 'Purchase Order — Domestic', kind: 'doc', stage: 'po', workflow: 'po', poType: 'domestic', prefix: 'PO', suffix: 'DOM', required: ['Date', 'Vendor Account'],
    lines: 'Items:Dropdown|Description:Text|Warehouse:Dropdown|Units:Text|Current Stock:Number|Reorder Level:Number|Nos. of Pcs/Box:Number|Quantity:Number|Rate:Number|SP Rate:Number|Price Type:Dropdown:Price Book,Special Book|Price Book Rate:Number|Special Rate:Number|Last PO Rate:Number|Brand:Dropdown|Item Group:Dropdown|Division:Dropdown|Other Discount:Number|GST %:Number|Gross:Calculated|Taxable Value:Calculated|CGST:Calculated|SGST:Calculated|IGST:Calculated|Line Total:Calculated|Intent No:Text|Intent Line:Number|Line No:Number' },
  { tab: 'Purchase Order — Import', kind: 'doc', stage: 'po', workflow: 'po', poType: 'import', prefix: 'PO', suffix: 'IMP', required: ['Date', 'Vendor Account'],
    lines: 'Items:Dropdown|Description:Text|Units:Text|Current Stock:Number|Quantity:Number|Rate:Number|Rate (INR):Calculated|PKG Charges:Number|Other Discount:Number|Gross:Calculated|Line Total:Calculated|Intent No:Text|Intent Line:Number|Line No:Number' },
  { tab: 'GRN  MRN', kind: 'doc', stage: 'grn', workflow: 'grn', prefix: 'GRN', post: 'grn', wh: ['Warehouse'], required: ['Date', 'Warehouse'],
    form: 'Update Stock:Checkbox|Raise Receipt:Checkbox|Attachment:Text',
    lines: 'Items:Dropdown|Description:Autofill|Quantity:Number|Rate:Number|Batch:Text|Expiry Date:Date|Gross:Calculated|Other Discount:Number|Taxable Value:Number|CGST:Number|IGST:Number|Brand:Dropdown|Item Category:Dropdown|Item Group:Dropdown|Division:Dropdown|Ordered Qty:Number|Received Qty:Number|Accepted Qty:Number|Rejected / Damaged Qty:Number|Excess Decision:Dropdown:Amend PO,Reject Excess,Arrange Return|Short Close:Dropdown:Keep Open,Close Balance (authorized)|PO Line:Number' },

  { tab: 'Imprest Out — New', kind: 'doc', stage: 'imprest', prefix: 'IIO', post: 'imprest-out', wh: ['To Warehouse'], required: ['Date', 'To Warehouse'], form: IMH_OUT, lines: IML_OUT, hide: ['Ref. Doc', 'Dispatch Name', 'Dispatch City', 'Dispatch Address', 'Dispatch Pincode', 'Dispatch State'] },
  { tab: 'Imprest Out Register', kind: 'list', stage: 'imprest', wh: ['To Warehouse'] },
  { tab: 'Imprest Out Pending', kind: 'list', stage: 'imprest', wh: ['To Warehouse'] },
  { tab: 'Imprest In — New', kind: 'doc', stage: 'imprest', prefix: 'IIN', post: 'imprest-in', wh: ['To Warehouse'], required: ['Date', 'To Warehouse'], form: IMH, lines: IML },
  { tab: 'Imprest In Register', kind: 'list', stage: 'imprest', wh: ['To Warehouse'] },
  { tab: 'Imprest In Pending', kind: 'list', stage: 'imprest', wh: ['To Warehouse'] },

  { tab: 'E-Way Bill Outward', kind: 'doc', stage: 'admin', prefix: 'EWB', required: ['Date'], form: EWH, lines: EWL },
  { tab: 'E-Way Bill Inward', kind: 'doc', stage: 'admin', prefix: 'EWI', required: ['Date'], form: EWH, lines: EWL },

  { tab: 'Material Requisition', kind: 'doc', stage: 'admin', prefix: 'MR', required: ['Date'], lines: 'Items:Dropdown|Units:Number|Rate:Number|Gross:Calculated|Discount:Number' },
  { tab: 'Material Issue', kind: 'doc', stage: 'admin', prefix: 'MI', post: 'issue', required: ['Date'], lines: 'Warehouse:Dropdown|Items:Dropdown|Units:Text|Quantity:Number|Batch:Text' },
  { tab: 'Dealer Indent', kind: 'doc', stage: 'admin', prefix: 'DI', wh: ['Mother Warehouse'], required: ['Date'], indentStatus: true,
    lines: 'Items:Dropdown|Units:Text|Requested Qty:Number|Approved Qty:Number|Fulfilled Qty:Number' },
  { tab: 'Indent Register', kind: 'list', stage: 'admin' },

  { tab: 'Stock Transfer', kind: 'doc', stage: 'transfer', prefix: 'ST', post: 'transfer', wh: ['From Warehouse', 'To Warehouse'], required: ['Date', 'From Warehouse', 'To Warehouse'],
    lines: 'Items:Dropdown|Units:Text|Quantity:Number|Batch:Text|Expiry Date:Date' },
  { tab: 'Branch Receipt', kind: 'doc', stage: 'admin', prefix: 'BR', required: ['Date'], lines: 'Items:Dropdown|Units:Text|Quantity:Number|Batch:Text|Expiry Date:Date' },
  { tab: 'Actual Stock', kind: 'doc', stage: 'admin', prefix: 'AS', post: 'actual', wh: ['Warehouse'], required: ['Date', 'Warehouse'],
    lines: 'Items:Dropdown|Batch:Text|System Qty:Autofill|Quantity:Number|Rate:Number|Gross:Calculated' },

  { tab: 'RFID Generation', kind: 'doc', stage: 'admin', prefix: 'RF', wh: ['Warehouse'], required: ['Date'] },
  { tab: 'RFID Mapping', kind: 'doc', stage: 'admin', prefix: 'RM', wh: ['Warehouse'], required: ['Date'] },
  { tab: 'RFID Scanning', kind: 'log', stage: 'admin', wh: ['Warehouse'], required: ['Scan RFID'], form: 'Purpose:Dropdown:Receipt,Issue,Stock Audit', lines: 'RFID Tag:Text|Item:Text|Batch:Text|Expiry Date:Date|Status:Text' },
  { tab: 'RFID Printing', kind: 'log', stage: 'admin', required: ['Item'], form: 'Label Format:Dropdown:Barcode,QR,RFID Tag|No. of Copies:Number' },
  { tab: 'RFID Replacement', kind: 'log', stage: 'admin', required: ['Old RFID Tag', 'New RFID Tag'], form: 'Reason:Dropdown:Damaged,Lost,Unreadable' },
  { tab: 'RFID Deactivation', kind: 'log', stage: 'admin', required: ['RFID Tag'], form: 'Reason:Dropdown:Consumed,Expired,Damaged' },

  { tab: 'Material Consumption', kind: 'doc', stage: 'consumption', prefix: 'MC', post: 'consumption', wh: ['Warehouse'], required: ['Warehouse'],
    form: 'Document No:Alphanumeric-Autogen|Customer Account:Dropdown|Location:Dropdown|Warehouse:Dropdown|Doctor:Dropdown|Sales Executive:Dropdown|Narration / Notes:Text|Business Head:Text|Submit for Approval:Dropdown',
    lines: 'Consumption Type:Text|Item:Dropdown|Description:Autofill|Units:Text|Quantity:Number|Batch:Text|Expiry Date:Date|Rate:Number|Gross:Calculated' },

  { tab: 'Master Mapping', kind: 'log', stage: 'admin', required: ['ERP Master'] },
  { tab: 'Voucher Posting', kind: 'list', stage: 'admin' },
  { tab: 'GST Mapping', kind: 'log', stage: 'admin', required: ['GST Ledger'] },
  { tab: 'Reconciliation', kind: 'list', stage: 'admin' },

  { tab: 'Configuration', kind: 'settings', stage: 'admin',
    form: 'Date Format:Dropdown:DD/MM/YYYY,YYYY-MM-DD|No. of Decimals:Dropdown:2,1,0|Session Timeout (min):Number|PO Pending Authorization Default:Checkbox|Price Override Approval Threshold (%):Number|Stack Price Meaning (to be confirmed):Dropdown:Stock price,Slab / quantity price,Other' },
  { tab: 'Security', kind: 'settings', stage: 'admin', form: 'Minimum Password Length:Number|Password Expiry (days):Number|Enable 2FA:Checkbox|Lock After Failed Attempts:Number|IP Whitelist:Longtext' },
  { tab: 'Backup', kind: 'settings', stage: 'admin', form: 'Schedule:Dropdown:Daily,Weekly,Manual|Retention (days):Number' },
];
const SPEC_BY_TAB = Object.fromEntries(SPECS.map((s) => [s.tab, s]));

const NUMERIC_MASTER_COLS = new Set(['Min Stock Level', 'MOQ', 'No. of Decimals']);
const LONG = new Set(['Narration-Notes', 'Narration / Notes', 'Payment Terms', 'Terms of Delivery', 'IP Whitelist', 'Ship to Address']);
const DATE_NAME = /(^|[ _])(date|upto)$|^(Date|Ref\. Date|Valid Upto|Invoice Date|Last Login|Last Backup)$/i;

function guessType(name) {
  if (/^(Quantity|Rate|Stock Value|Invoice Value|Exchange Rate|Distance \(KM\)|No\. of Tags|No\. of Copies|Balance|Linked_Value|Voucher_Amount|ERP Amount|Tally Amount|Min Stock Level|MOQ|No\. of Decimals|Port)$/.test(name)) return 'number';
  if (DATE_NAME.test(name)) return 'date';
  if (LONG.has(name)) return 'textarea';
  return 'text';
}

function buildTable(t) {
  const spec = SPEC_BY_TAB[t.tab] || { kind: t.type === 'Master' ? 'master' : 'list', stage: 'admin' };
  const headers = t.headers;
  const dsl = new Map(parseDsl(spec.form).map((f) => [f.name, f]));
  const fields = headers.filter((h) => h !== 'Lines').map((h) => {
    const base = dsl.get(h) || { name: h, type: guessType(h) };
    const f = decorate(base, spec);
    if (spec.kind === 'master' && NUMERIC_MASTER_COLS.has(h)) f.type = 'number';
    return f;
  });
  const idCol = spec.kind === 'master' ? 'Master Id' : spec.kind === 'doc' ? headers[0] : null;
  if (idCol) {
    const f = fields.find((x) => x.name === idCol);
    f.type = 'auto'; f.readonly = true;
  }
  const lineFields = parseDsl(spec.lines).map((f) => decorate(f));
  const itemField = lineFields.find((f) => f.name === 'Items' || f.name === 'Item')?.name || null;
  const table = {
    workflow: spec.workflow || null, poType: spec.poType || null,
    slug: slugify(t.tab), tab: t.tab, module: t.module, moduleName: t.moduleName, kind: spec.kind, stage: spec.stage,
    headers, fields, idCol, prefix: spec.prefix || null, suffix: spec.suffix || null, post: spec.post || null, wh: spec.wh || [],
    required: spec.master || spec.kind === 'master'
      ? [headers[1]].concat(t.tab === 'Item Master' ? ['Code'] : [])
      : spec.required || [],
    lineFields, itemField, hide: spec.hide || [], hasLines: headers.includes('Lines'), sort: spec.sort || null,
    writable: spec.kind === 'doc' || spec.kind === 'master' || spec.kind === 'log' || spec.kind === 'settings' || !!spec.writable,
    uniqueCol: spec.kind === 'master' ? (headers.includes('Code') ? 'Code' : headers[1]) : null,
  };
  // Document line schema: every line also carries a resolved item code
  if (table.itemField) table.lineFields.push({ name: 'Item Code', type: 'calc', readonly: true });
  return table;
}

// Tabs the app adds on top of the approved template (new worksheets, created by `npm run init-sheet`).
export const EXTRA_TABS = [
  { tab: 'Purchase Requisition', module: 'M09', moduleName: 'Inventory & Warehouse', type: 'Doc',
    headers: ['Document No.', 'Date', 'Requesting Warehouse', 'Issuing Warehouse', 'Priority', 'Narration-Notes', 'Lines'] },
];
export const TABLES = [...TEMPLATE_TABS, ...EXTRA_TABS].map(buildTable);
export const TABLE_BY_SLUG = Object.fromEntries(TABLES.map((t) => [t.slug, t]));
export const TABLE_BY_TAB = Object.fromEntries(TABLES.map((t) => [t.tab, t]));
export const MODULE_NAMES = Object.fromEntries(TEMPLATE_TABS.map((t) => [t.module, t.moduleName]));

export const TAB = {
  opening: 'Opening Stock', ledger: 'Stock Ledger', users: 'Users', activity: 'Activity Log', sessions: 'Login Sessions',
  audit: 'Audit Logs', config: 'Configuration', security: 'Security', warehouseMaster: 'Warehouse Master', itemMaster: 'Item Master',
};

export const USERS_HEADERS = TABLE_BY_TAB.Users?.headers || ['Groups', 'User Name', 'Phone', 'Email', 'Password', 'Branch', 'Status', 'Last Login', 'Warehouse'];
export const ACCESS_HEADERS = ['Tab', ...Object.values(ROLE_LABELS)];
export const ALLOWED_TABS = new Set([...TABLES.map((t) => t.tab), CREDENTIALS_TAB, DOC_STATUS_TAB, DOC_HISTORY_TAB, ACCESS_TAB]);
export const HEADERS_BY_TAB = { ...Object.fromEntries(TABLES.map((t) => [t.tab, t.headers])), [CREDENTIALS_TAB]: CREDENTIALS_HEADERS, [DOC_STATUS_TAB]: DOC_STATUS_HEADERS, [DOC_HISTORY_TAB]: DOC_HISTORY_HEADERS, [ACCESS_TAB]: ACCESS_HEADERS };
