// The ONE place that defines the sidebar. Items only appear when the logged-in user's meta allows them.
export const DEDICATED_SLUGS = ['purchase-indent', 'purchase-indent-pending', 'purchase-order-domestic', 'purchase-order-import', 'grn-mrn', 'opening-stock', 'stock-ledger', 'purchase-requisition', 'stock-transfer', 'imprest-out-new', 'imprest-out-register', 'imprest-out-pending', 'imprest-in-new', 'imprest-in-register', 'imprest-in-pending', 'material-consumption', 'item-master', 'vendor-master', 'warehouse-master', 'customer-hospital-master'];
export const ADMIN_SLUGS = ['activity-log', 'login-sessions', 'audit-logs', 'configuration', 'security', 'backup'];

const has = (t, a) => !!t && t.actions.includes(a);

export function buildNav(meta) {
  if (!meta) return [];
  const tables = Object.fromEntries(meta.modules.flatMap((m) => m.tables.map((t) => [t.slug, t])));
  const f = meta.features || {};
  const sections = [];
  const add = (key, label, icon, items) => { items = items.filter(Boolean); if (items.length) sections.push({ key, label, icon, items }); };
  const it = (cond, to, label) => (cond ? { to, label } : null);

  if (f.dashboard) sections.push({ key: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/', items: [] });

  // Masters (item / vendor / warehouse / hospital first, then the other masters of module M03)
  const m03 = (meta.modules.find((m) => m.code === 'M03')?.tables || []).filter((t) => !DEDICATED_SLUGS.includes(t.slug));
  const mast = (slug, label) => it(has(tables[slug], 'view'), `/t/${slug}`, label);
  add('masters', 'Masters', 'db', [mast('item-master', 'Item Master'), mast('vendor-master', 'Vendor Master'), mast('warehouse-master', 'Warehouse Master'), mast('customer-hospital-master', 'Hospital / Location Master'),
    ...m03.map((t) => ({ to: `/t/${t.slug}`, label: t.title.replace(/\s{2,}/g, ' ') }))]);

  if (has(tables['opening-stock'], 'view')) sections.push({ key: 'opening', label: 'Opening Stock', icon: 'box', to: '/inventory/opening-stock', items: [] });

  const pi = tables['purchase-indent']; const po = tables['purchase-order-domestic'];
  add('purchasing', 'Purchasing', 'cart', [
    it(has(pi, 'create'), '/purchase-intent/new', 'Create Purchase Indent'),
    it(has(pi, 'view'), '/purchase-intent', 'Purchase Indents'),
    it(has(pi, 'view'), '/purchase-intent?status=Pending Review', 'Pending Purchase Indents'),
    it(has(pi, 'view'), '/purchase-intent?status=Approved', 'Approved Indents'),
    it(has(po, 'create'), '/purchasing/po/new', 'Create PO'),
    it(has(po, 'view'), '/purchasing/po?view=pending-auth', 'PO Pending Authorization'),
    it(has(po, 'view'), '/purchasing/po?view=pending', 'Pending Purchase Orders'),
    it(has(po, 'view'), '/purchasing/po?view=approved', 'PO Authorized'),
    it(has(po, 'view'), '/purchasing/po?view=all', 'All Purchase Orders'),
  ]);

  const rq = tables['purchase-requisition']; const grn = tables['grn-mrn'];
  // Warehouse operations, one section per flow
  add('wh-req', 'Requisition & Issue', 'inbox', [
    it(has(rq, 'create'), '/requisitions/new', 'Raise Requisition (to mother warehouse)'),
    it(has(rq, 'view'), '/requisitions', 'Requisition Register'),
    it(has(rq, 'view'), '/requisitions?view=pending', 'Pending Requisitions'),
    it(has(rq, 'view'), '/requisitions?view=open', 'Issue / Receive (open requisitions)'),
    it(has(tables['stock-transfer'], 'view'), '/t/stock-transfer', 'Stock Transfer'),
  ]);
  add('wh-grn', 'GRN (Purchase Receipt)', 'inbox', [
    it(has(grn, 'create'), '/grn/new', 'Create GRN'),
    it(has(grn, 'view'), '/grn', 'GRN Register'),
  ]);
  add('wh-imprest', 'Imprest & Consumption', 'inbox', [
    it(has(tables['imprest-out-new'], 'create'), '/t/imprest-out-new?new=1', 'Imprest Out — New'),
    it(has(tables['imprest-out-new'], 'view'), '/imprest/register/out', 'Imprest Out Register'),
    it(has(tables['imprest-in-new'], 'create'), '/imprest/pending', 'Imprest In — Pending'),
    it(has(tables['imprest-in-new'], 'view'), '/imprest/register/in', 'Imprest In Register'),
    it(has(tables['material-consumption'], 'view'), '/consumption/pending', 'Consumption Pending'),
    it(has(tables['material-consumption'], 'view'), '/consumption/register', 'Consumption Register'),
  ]);

  add('inventory', 'Inventory', 'box', [
    it(f.stock, '/inventory/summary', 'Live Stock Overview'),
    it(f.stock, '/inventory/batches', 'Batch-wise Stock'),
  ]);

  add('reports', 'Reports', 'chart', [
    it(f.reports, '/reports', 'All Reports'),
    it(f.reports && f.stock, '/reports/warehouse-stock', 'Stock Reports'),
    it(f.reports && has(po, 'view'), '/reports/approved-purchase-orders', 'Purchase Reports'),
    it(f.reports && has(rq, 'view'), '/reports/purchase-requisition-register', 'Warehouse Reports'),
    it(f.reports && has(tables['material-consumption'], 'view'), '/reports/consumption-register', 'Consumption Reports'),
    it(f.reports && f.stock, '/reports/stock-ledger', 'Stock Ledger'),
    it(f.dashboard, '/', 'MIS Dashboard'),
  ]);

  // Everything else, grouped by module (M03 is shown as "Masters").
  for (const m of meta.modules) {
    if (m.code === 'M03') continue;
    const items = m.tables.filter((t) => !DEDICATED_SLUGS.includes(t.slug) && !ADMIN_SLUGS.includes(t.slug)).map((t) => ({ to: `/t/${t.slug}`, label: t.title.replace(/\s{2,}/g, ' ') }));
    add(`m-${m.code}`, m.name, 'folder', items);
  }

  add('admin', 'Administration', 'gear', [
    it(f.users, '/admin/users', 'Users'),
    it(f.access, '/admin/access', 'Access Control'),
    it(f.dataQuality, '/admin/data-quality', 'Data Quality'),
    ...ADMIN_SLUGS.map((s) => it(!!tables[s], `/t/${s}`, tables[s]?.title)),
  ]);
  return sections;
}
