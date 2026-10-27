import { useTick } from '../useTick.js';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Pagination from '../components/Pagination.jsx';
import Spinner from '../components/Spinner.jsx';

const n = (v) => (v === undefined ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

export default function StockSummary() {
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(true);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const tick = useTick();
  useEffect(() => {
    let live = true; setBusy(true); setErr('');
    api.get('/api/stock/summary', { q: dq, page, pageSize }).then((r) => { if (live) setD(r); }).catch((e) => { if (live) setErr(e.message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [dq, page, pageSize, tick]);
  return (
    <>
      <PageHeader title="Live Stock Overview" subtitle="Quantity per item across the warehouses you can access (opening stock + posted movements)." />
      <FilterBar><FilterItem label="Search item" grow><input className="input" placeholder="Item code or name" value={q} onChange={(e) => setQ(e.target.value)} /></FilterItem></FilterBar>
      <Card pad={false}>
        {err && <div role="alert" className="p-4 text-sm text-red-600">{err}</div>}
        {busy && !d && <Spinner />}
        {d && (
          <>
            <div className="relative overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead><tr><th className="th">Item Code</th><th className="th">Item Name</th>{d.warehouses.map((w) => <th key={w} className="th text-right">{w}</th>)}<th className="th text-right">Total</th><th className="th text-right">Value</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {d.rows.map((r) => (
                    <tr key={r.itemCode} className="hover:bg-slate-50">
                      <td className="td font-medium">{r.itemCode}</td><td className="td">{r.itemName}</td>
                      {d.warehouses.map((w) => <td key={w} className="td text-right tabular-nums">{r.by[w] ? n(r.by[w]) : <span className="text-slate-300">—</span>}</td>)}
                      <td className="td text-right font-semibold tabular-nums">{n(r.total)}</td><td className="td text-right tabular-nums">{n(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {busy && <div className="absolute inset-0 bg-white/50" aria-hidden="true" />}
              {!d.rows.length && <p className="p-8 text-center text-sm text-slate-500">No stock found.</p>}
            </div>
            <Pagination page={d.page} pages={d.pages} total={d.total} pageSize={d.pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </Card>
    </>
  );
}
