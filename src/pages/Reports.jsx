import { useTick } from '../useTick.js';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, download } from '../api.js';
import Card from '../components/Card.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import Icon from '../components/Icon.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Pagination from '../components/Pagination.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';
import NotFound from './NotFound.jsx';

const GROUPS = ['Stock', 'Purchasing', 'Warehouse'];
const GROUP_LABEL = { Stock: 'Stock reports', Purchasing: 'Purchase reports', Warehouse: 'Warehouse & consumption reports' };

export function ReportsIndex() {
  const [rep, setRep] = useState(null); const [err, setErr] = useState(''); const [whs, setWhs] = useState([]); const [mother, setMother] = useState('');
  useEffect(() => {
    api.get('/api/reports').then((r) => setRep(r.reports)).catch((e) => setErr(e.message));
    api.get('/api/lookup', { field: 'Warehouse' }).then((r) => setWhs((r.options || []).filter((o) => o.inScope !== false).map((o) => o.value))).catch(() => {});
    api.get('/api/wf/pos/defaults').then((r) => setMother(r.location)).catch(() => {});
  }, []);
  if (err) return <div role="alert" className="text-sm text-red-600">{err}</div>;
  if (!rep) return <Spinner />;
  const has = (k) => rep.some((r) => r.key === k);
  return (
    <>
      <PageHeader title="Reports" subtitle="Every report is calculated live from the documents and the stock ledger. Search, filter, page, and export to Excel or CSV." />
      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => {
          const items = rep.filter((r) => r.group === g); if (!items.length) return null;
          return (
            <Card key={g} title={GROUP_LABEL[g]} pad={false}>
              <ul className="divide-y divide-slate-100">
                {items.map((r) => <li key={r.key}><Link className="flex items-center justify-between px-4 py-2 text-sm hover:bg-brand-50/50" to={`/reports/${r.key}`}>{r.title}<span className="text-slate-400">›</span></Link></li>)}
                {g === 'Stock' && has('warehouse-stock') && whs.map((w) => <li key={w}><Link className="flex items-center justify-between px-4 py-2 text-sm hover:bg-brand-50/50" to={`/reports/warehouse-stock?warehouse=${encodeURIComponent(w)}`}>{w === mother ? `Mother Warehouse Stock (${w})` : `${w} Warehouse Stock`}<span className="text-slate-400">›</span></Link></li>)}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}

const cell = (v, c, statusCol) => {
  if (v === '' || v === null || v === undefined) return <span className="text-slate-300">—</span>;
  if (typeof v === 'number') return <span className="tabular-nums">{v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>;
  if (c === statusCol || c === 'Flag' || c === 'Expiry Status') return <StatusBadge value={v} />;
  const s = String(v); return s.length > 70 ? <span title={s}>{s.slice(0, 70)}…</span> : s;
};
const NO_STATUS = new Set(['Status']);

export default function ReportPage() {
  const { key } = useParams(); const toast = useToast(); const [sp, setSp] = useSearchParams();
  const f = { q: sp.get('q') || '', warehouse: sp.get('warehouse') || '', item: sp.get('item') || '', status: sp.get('status') || '', from: sp.get('from') || '', to: sp.get('to') || '' };
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25); const [sort, setSort] = useState(''); const [dir, setDir] = useState('asc');
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(true); const [whs, setWhs] = useState([]); const [qq, setQq] = useState(f.q);
  const setF = (patch) => { const n = { ...f, ...patch }; setSp(Object.fromEntries(Object.entries(n).filter(([, v]) => v)), { replace: true }); setPage(1); };
  useEffect(() => { api.get('/api/lookup', { field: 'Warehouse' }).then((r) => setWhs((r.options || []).filter((o) => o.inScope !== false).map((o) => o.value))).catch(() => {}); }, []);
  useEffect(() => { setPage(1); setSort(''); setData(null); setQq(sp.get('q') || ''); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => { if (qq !== f.q) setF({ q: qq }); }, 300); return () => clearTimeout(t); }, [qq]); // eslint-disable-line react-hooks/exhaustive-deps
  const tick = useTick();
  useEffect(() => {
    let live = true; setBusy(true); setErr('');
    api.get(`/api/reports/${key}`, { ...f, page, pageSize, sort, dir }).then((r) => { if (live) setData(r); }).catch((e) => { if (live) { setErr(e.message); setData(null); } }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [key, sp, page, pageSize, sort, dir, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const exp = (fmt) => download(`/api/reports/${key}`, { ...f, export: fmt }, `${key}.${fmt}`).catch((e) => toast.error(e.message));
  if (err && /Unknown report|cannot open/.test(err)) return <NotFound />;
  const cols = data?.columns || [];
  return (
    <>
      <PageHeader back={<Link to="/reports" className="mb-1 inline-block text-sm text-brand-700 hover:underline">← Reports</Link>} title={data?.title || 'Report'}
        actions={<><button className="btn" disabled={!data} onClick={() => exp('xlsx')}><Icon name="download" className="h-4 w-4" /> Excel</button><button className="btn" disabled={!data} onClick={() => exp('csv')}><Icon name="download" className="h-4 w-4" /> CSV</button></>} />
      <FilterBar onReset={() => { setSp({}, { replace: true }); setQq(''); setPage(1); }}>
        <FilterItem label="Search" grow><input className="input" value={qq} placeholder="Search anything in this report…" onChange={(e) => setQq(e.target.value)} /></FilterItem>
        <FilterItem label="Warehouse"><select className="input" value={f.warehouse} onChange={(e) => setF({ warehouse: e.target.value })}><option value="">All</option>{whs.map((w) => <option key={w}>{w}</option>)}</select></FilterItem>
        <FilterItem label="Item"><input className="input" value={f.item} placeholder="code or name" onChange={(e) => setF({ item: e.target.value })} /></FilterItem>
        {!!data?.statuses?.length && <FilterItem label="Status"><select className="input" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="">All</option>{data.statuses.map((s) => <option key={s}>{s}</option>)}</select></FilterItem>}
        {data?.hasDate && <><FilterItem label="From"><input type="date" className="input" value={f.from} onChange={(e) => setF({ from: e.target.value })} /></FilterItem><FilterItem label="To"><input type="date" className="input" value={f.to} onChange={(e) => setF({ to: e.target.value })} /></FilterItem></>}
      </FilterBar>
      <div className="card overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead><tr>{cols.map((c) => <th key={c} className="th cursor-pointer select-none hover:text-slate-800" onClick={() => { if (sort === c) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(c); setDir('asc'); } setPage(1); }}>{c}{sort === c && <span className="ml-1">{dir === 'asc' ? '▲' : '▼'}</span>}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{(data?.rows || []).map((r, i) => <tr key={i} className="hover:bg-slate-50">{cols.map((c) => <td key={c} className={`td ${typeof r[c] === 'number' ? 'text-right' : ''}`}>{cell(r[c], c, NO_STATUS.has(c) ? 'Status' : data.statuses?.length ? 'Status' : '')}</td>)}</tr>)}</tbody>
            {data?.totals && Object.keys(data.totals).length > 0 && <tfoot><tr className="bg-slate-50 font-semibold">{cols.map((c, i) => <td key={c} className={`td ${data.totals[c] !== undefined ? 'text-right tabular-nums' : ''}`}>{i === 0 ? 'Total (all pages)' : data.totals[c] !== undefined ? data.totals[c].toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''}</td>)}</tr></tfoot>}
          </table>
          {busy && !data && <Spinner />}
          {err && <div className="p-6 text-center text-sm text-red-600">{err}</div>}
          {!busy && !err && data && !data.rows.length && <div className="p-10 text-center text-sm text-slate-500">No rows match the filters</div>}
        </div>
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
      </div>
      {key === 'low-stock' && data?.rows?.some((r) => r.Action) && (
        <Card title="Raise replenishment" className="mt-4"><p className="mb-2 text-sm text-slate-600">For an operating warehouse, raise a Purchase Requisition to the Mother Warehouse. For the Mother Warehouse itself, raise a Purchase Indent to the Purchase Department.</p>
          <div className="flex flex-wrap gap-2">{[...new Set(data.rows.filter((r) => r.Action === 'Raise Purchase Requisition').map((r) => r.Warehouse))].map((w) => (
            <Link key={w} className="btn btn-sm btn-primary" to={`/requisitions/new?warehouse=${encodeURIComponent(w)}&items=${data.rows.filter((r) => r.Warehouse === w && r.Action === 'Raise Purchase Requisition').slice(0, 30).map((r) => `${encodeURIComponent(r['Item Code'])}:${r.Shortfall}`).join(',')}`}>Requisition for {w}</Link>))}
            {data.rows.some((r) => r.Action === 'Raise Purchase Indent') && <Link className="btn btn-sm" to="/purchase-intent/new">Raise Purchase Indent</Link>}</div></Card>
      )}
    </>
  );
}
