import { useTick } from '../useTick.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Card from '../components/Card.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const n2 = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function Kpi({ label, value, sub, to, tone = 'brand' }) {
  const ring = { brand: 'border-l-brand-700', amber: 'border-l-amber-500', red: 'border-l-red-500', green: 'border-l-green-600' }[tone];
  const body = (<><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>{sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}</>);
  const cls = `card border-l-4 ${ring} block p-4`;
  return to ? <Link to={to} className={`${cls} transition hover:shadow-md`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function MiniTable({ title, cols, rows, empty }) {
  return (
    <Card title={title} pad={false}>
      {rows?.length ? (
        <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100"><thead><tr>{cols.map((c) => <th key={c.k} className={`th ${c.num ? 'text-right' : ''}`}>{c.h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.k} className={`td ${c.num ? 'text-right tabular-nums' : ''}`}>{c.f ? c.f(r[c.k]) : r[c.k]}</td>)}</tr>)}</tbody></table></div>
      ) : <p className="p-4 text-sm text-slate-500">{empty}</p>}
    </Card>
  );
}

export default function Dashboard() {
  const { user, tables } = useAuth();
  const [f, setF] = useState({ from: '', to: '', warehouse: '' });
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [whs, setWhs] = useState([]);
  useEffect(() => { api.get('/api/lookup', { field: 'Warehouse' }).then((r) => setWhs((r.options || []).filter((o) => o.inScope !== false))).catch(() => {}); }, []);
  const tick = useTick();
  useEffect(() => {
    let live = true; setErr('');
    api.get('/api/dashboard', f).then((r) => { if (live) setD(r); }).catch((e) => { if (live) { setErr(e.message); setD(null); } });
    return () => { live = false; };
  }, [f, tick]);

  const k = d?.kpis || {};
  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} subtitle={d ? `Data from ${d.range.from} to ${d.range.to}${d.warehouse ? ` · warehouse ${d.warehouse}` : ''}` : undefined} />
      <FilterBar onReset={() => setF({ from: '', to: '', warehouse: '' })}>
        <FilterItem label="From"><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></FilterItem>
        <FilterItem label="To"><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></FilterItem>
        <FilterItem label="Warehouse"><select className="input" value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}><option value="">All permitted</option>{whs.map((w) => <option key={w.value}>{w.value}</option>)}</select></FilterItem>
      </FilterBar>
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {!d && !err && <Spinner />}
      {d && (
        <div className="space-y-4">
          {d.cards && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Total items" value={(d.cards.totalItems || 0).toLocaleString()} to="/t/item-master" />
              {d.cards.openingStock && <Kpi label="Opening stock" value={n2(d.cards.openingStock.qty)} sub={`${d.cards.openingStock.rows} rows`} to="/inventory/opening-stock" />}
              {d.cards.currentStock && <Kpi label="Current stock" value={n2(d.cards.currentStock.qty)} sub={inr(d.cards.currentStock.value)} tone="green" to="/reports/warehouse-stock" />}
              {(d.cards.warehouses || []).map((w) => <Kpi key={w.warehouse} label={`${w.warehouse} stock`} value={n2(w.qty)} sub={w.items !== undefined ? `${w.items} items` : undefined} to={`/reports/warehouse-stock?warehouse=${encodeURIComponent(w.warehouse)}`} />)}
              {d.cards.virtualStock && <Kpi label="Hospital / virtual stock" value={n2(d.cards.virtualStock.qty)} sub={`${d.cards.virtualStock.locations} locations`} to="/reports/virtual-stock" />}
              {d.cards.inTransit && <Kpi label="In transit (requisitions)" value={n2(d.cards.inTransit.qty)} tone="amber" to="/requisitions?view=open" />}
              {d.cards.consumption && <Kpi label="Consumption" value={n2(d.cards.consumption.qty)} to="/reports/consumption-register" />}
              {d.cards.lowStockItems !== undefined && <Kpi label="Low-stock items" value={d.cards.lowStockItems} tone={d.cards.lowStockItems ? 'red' : 'green'} to="/reports/low-stock" />}
            </div>
          )}
          {d.workflow && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {d.workflow.intents && <Kpi label="Intents pending review" value={d.workflow.intents.pendingReview} sub={`${d.workflow.intents.approved} approved · ${d.workflow.intents.total} total`} tone="amber" to="/purchase-intent?status=Pending Review" />}
              {d.workflow.pos && <Kpi label="POs pending authorization" value={d.workflow.pos.pendingAuthorization} tone="amber" to="/purchasing/po?view=pending-auth" />}
              {d.workflow.pos && <Kpi label="Approved POs awaiting receipt" value={d.workflow.pos.pending} sub={`${d.workflow.pos.approved} approved · ${inr(d.workflow.pos.value)}`} to="/purchasing/po?view=pending" />}
              {d.workflow.requisitions && <Kpi label="Requisitions pending approval" value={d.workflow.requisitions.pendingApproval ?? 0} sub={`${d.workflow.requisitions.open ?? 0} open · ${d.workflow.requisitions.total ?? 0} total`} tone="amber" to="/requisitions?view=pending" />}
              {d.workflow.grns && <Kpi label="GRNs in period" value={d.workflow.grns.created ?? 0} tone="green" to="/grn" />}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Stock value" value={inr(k.stockValue)} to="/inventory/batches" />
            {k.totalQuantity !== undefined && <Kpi label="Total quantity" value={n2(k.totalQuantity)} sub={`${(k.batchesInStock || 0).toLocaleString()} batches in stock`} to="/inventory/summary" />}
            {k.distinctItems !== undefined && <Kpi label="Items in stock" value={(k.distinctItems || 0).toLocaleString()} to="/inventory/summary" tone="green" />}
            <Kpi label="Expiring in 90 days" value={`${k.expiring90?.batches ?? 0} batches`} sub={inr(k.expiring90?.value)} tone="amber" to="/inventory/batches?flag=Expiring" />
            <Kpi label="Expired, still in stock" value={`${k.expired?.batches ?? 0} batches`} sub={inr(k.expired?.value)} tone="red" to="/inventory/batches?flag=Expired" />
            <Kpi label="Negative-stock batches" value={k.negativeBatches ?? 0} tone={k.negativeBatches ? 'red' : 'green'} to="/inventory/batches?flag=Negative" />
          </div>

          {!!d.documents?.length && (
            <Card title="Documents in period">
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {d.documents.map((x) => (
                  <Link key={x.slug} to={tables[x.slug] ? `/t/${x.slug}` : '#'} className="rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
                    <div className="text-xs text-slate-500">{x.table.replace(/\s{2,}/g, ' ')}</div><div className="text-xl font-semibold tabular-nums">{x.count}</div>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Stock value by warehouse">
              {d.byWarehouse?.length ? (
                <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={d.byWarehouse}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="warehouse" /><YAxis tickFormatter={(v) => `${(v / 1e5).toFixed(0)}L`} width={48} /><Tooltip formatter={(v) => inr(v)} /><Bar dataKey="value" name="Stock value" fill="#0b4a8f" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
              ) : <p className="text-sm text-slate-500">No stock in your warehouses.</p>}
            </Card>
            {d.movementByWarehouse?.length > 0 && (
              <Card title="Inward / outward by warehouse (period)">
                <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={d.movementByWarehouse}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="warehouse" /><YAxis width={48} /><Tooltip /><Legend /><Bar dataKey="inward" name="Inward" fill="#16a34a" radius={[4, 4, 0, 0]} /><Bar dataKey="outward" name="Outward" fill="#dc2626" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
              </Card>
            )}
            {d.movements ? (
              <Card title="Stock movement by month (quantity)">
                {d.movements.length ? (
                  <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={d.movements}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" /><YAxis width={48} /><Tooltip /><Legend /><Bar dataKey="inward" name="Inward" fill="#16a34a" radius={[4, 4, 0, 0]} /><Bar dataKey="outward" name="Outward" fill="#dc2626" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
                ) : <p className="text-sm text-slate-500">No stock movements posted in this period.</p>}
              </Card>
            ) : (
              <Card title="Stock movements">{d.movementTypes?.length ? <ul className="text-sm">{d.movementTypes.map((m) => <li key={m.type} className="flex justify-between border-b border-slate-100 py-1"><span>{m.type}</span><span className="tabular-nums">{m.count}</span></li>)}</ul> : <p className="text-sm text-slate-500">No stock movements posted in this period.</p>}</Card>
            )}
          </div>

          {d.recent && <MiniTable title="Recent stock transactions" empty="No transactions yet." rows={d.recent} cols={[{ k: 'date', h: 'Date' }, { k: 'type', h: 'Type' }, { k: 'doc', h: 'Doc' }, { k: 'warehouse', h: 'WH' }, { k: 'itemCode', h: 'Item' }, { k: 'qty', h: 'Qty', num: true }]} />}
          <div className="grid gap-4 lg:grid-cols-2">
            {d.expiringSoon && <MiniTable title="Expiring soon" empty="Nothing expiring in the next 90 days." rows={d.expiringSoon} cols={[{ k: 'warehouse', h: 'WH' }, { k: 'itemCode', h: 'Item' }, { k: 'batch', h: 'Batch' }, { k: 'expiry', h: 'Expiry' }, { k: 'qty', h: 'Qty', num: true }]} />}
            {d.belowMinimum && <MiniTable title="Below minimum stock level" empty="No items are below their minimum level (set Min Stock Level in Item Master)." rows={d.belowMinimum} cols={[{ k: 'itemCode', h: 'Item' }, { k: 'itemName', h: 'Name' }, { k: 'qty', h: 'On hand', num: true }, { k: 'min', h: 'Minimum', num: true }]} />}
            {d.topItems && <MiniTable title="Top items by stock value" empty="No stock." rows={d.topItems} cols={[{ k: 'itemCode', h: 'Item' }, { k: 'itemName', h: 'Name' }, { k: 'qty', h: 'Qty', num: true }, { k: 'value', h: 'Value', num: true, f: inr }]} />}
          </div>
        </div>
      )}
    </>
  );
}
