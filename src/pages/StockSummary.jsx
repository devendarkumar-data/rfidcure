import { useTick } from '../useTick.js';
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Pagination from '../components/Pagination.jsx';
import Spinner from '../components/Spinner.jsx';
import { fmtDate } from '../dateOptions.js';

// Opens under an item: every location (warehouse or hospital) holding it, by batch, with expiry, value and the dates it arrived / last moved.
function Where({ code, cols }) {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api.get('/api/reports/stock-by-location', { item: code, all: 1 }).then((r) => setRows(r.rows.filter((x) => x['Item Code'] === code))).catch((e) => setErr(e.message)); }, [code]);
  if (err) return <tr><td className="td text-red-600" colSpan={cols}>{err}</td></tr>;
  if (!rows) return <tr><td className="td text-slate-500" colSpan={cols}>Loading…</td></tr>;
  return (
    <tr><td className="bg-slate-50 !p-2" colSpan={cols}>
      <table className="min-w-full text-xs"><thead><tr>{['Location', 'Type', 'Batch', 'Expiry', 'Quantity', 'Rate (₹)', 'Value (₹)', 'Received on', 'Last movement'].map((h) => <th key={h} className={`th ${['Quantity', 'Rate (₹)', 'Value (₹)'].includes(h) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((r, i) => <tr key={i} className={r['Location Type'] !== 'Warehouse' ? 'bg-sky-50/60' : ''}><td className="td font-medium">{r.Location}</td><td className="td">{r['Location Type']}</td><td className="td">{r['Batch Number'] || '—'}</td><td className="td whitespace-nowrap">{fmtDate(r['Expiry Date'])}</td><td className="td text-right tabular-nums">{n(r.Quantity)}</td><td className="td text-right tabular-nums">{n(r.Rate)}</td><td className="td text-right tabular-nums">{n(r['Stock Value'])}</td><td className="td whitespace-nowrap">{fmtDate(r['Received On']) || 'Opening stock'}</td><td className="td whitespace-nowrap">{fmtDate(r['Last Movement'])}</td></tr>)}
          <tr className="font-semibold"><td className="td" colSpan={4}>Total</td><td className="td text-right tabular-nums">{n(rows.reduce((s, r) => s + r.Quantity, 0))}</td><td className="td" /><td className="td text-right tabular-nums">{n(rows.reduce((s, r) => s + r['Stock Value'], 0))}</td><td className="td" colSpan={2} /></tr></tbody></table>
    </td></tr>
  );
}

const n = (v) => (v === undefined ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

export default function StockSummary() {
  const [openRows, setOpenRows] = useState(new Set());
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [withVirtual, setWithVirtual] = useState(true); const [d, setD] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(true);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const tick = useTick();
  useEffect(() => {
    let live = true; setBusy(true); setErr('');
    api.get('/api/stock/summary', { q: dq, page, pageSize, virtual: withVirtual ? '1' : '0' }).then((r) => { if (live) setD(r); }).catch((e) => { if (live) setErr(e.message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [dq, page, pageSize, tick, withVirtual]);
  return (
    <>
      <PageHeader title="Live Stock Overview" subtitle="Quantity per item across the warehouses you can access, with the virtual (hospital) warehouses holding imprest stock shown after them." />
      <p className="mb-2 text-sm text-slate-600">Click ▸ beside an item to see <b>where it is</b>: every warehouse and hospital holding it, by batch, with expiry, value and dates. <Link className="text-brand-700 hover:underline" to="/reports/stock-by-location">Open the full report (Excel / PDF / e-mail) →</Link></p>
      <FilterBar><FilterItem label="Search item" grow><input className="input" placeholder="Item code or name" value={q} onChange={(e) => setQ(e.target.value)} /></FilterItem><FilterItem label="Virtual warehouses"><label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={withVirtual} onChange={(e) => { setWithVirtual(e.target.checked); setPage(1); }} /> Include hospital (imprest) stock</label></FilterItem></FilterBar>
      {d?.virtualValues?.length > 0 && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Stock held at hospitals / virtual warehouses — valuation</h3>
            <Link className="text-sm text-brand-700 hover:underline" to="/reports/hospital-stock-valuation">Date-wise valuation, Excel / PDF / e-mail →</Link>
          </div>
          <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th className="th">Virtual warehouse</th><th className="th text-right">Quantity</th><th className="th text-right">Value (₹)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.virtualValues.map((v) => <tr key={v.warehouse}><td className="td"><Link className="text-brand-700 hover:underline" to={`/reports/hospital-stock-valuation?q=${encodeURIComponent(v.warehouse)}`}>{v.warehouse}</Link></td><td className="td text-right tabular-nums">{n(v.qty)}</td><td className="td text-right tabular-nums">{n(v.value)}</td></tr>)}
              <tr className="bg-slate-50 font-semibold"><td className="td">Total</td><td className="td text-right tabular-nums">{n(d.virtualValues.reduce((s, v) => s + v.qty, 0))}</td><td className="td text-right tabular-nums">{n(d.virtualValues.reduce((s, v) => s + v.value, 0))}</td></tr></tbody></table></div>
        </Card>
      )}
      <Card pad={false}>
        {err && <div role="alert" className="p-4 text-sm text-red-600">{err}</div>}
        {busy && !d && <Spinner />}
        {d && (
          <>
            <div className="relative overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead><tr><th className="th">Item Code</th><th className="th">Item Name</th>{d.warehouses.map((w) => <th key={w} className={`th text-right ${d.virtual?.includes(w) ? 'bg-sky-50' : ''}`} title={d.virtual?.includes(w) ? 'Virtual (hospital) warehouse' : ''}>{w}{d.virtual?.includes(w) && <span className="block text-[10px] font-normal normal-case text-sky-700">virtual</span>}</th>)}<th className="th text-right">Total (physical)</th>{d.virtual?.length > 0 && <th className="th text-right">With hospitals</th>}<th className="th text-right">Value</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {d.rows.map((r) => (
                    <Fragment key={r.itemCode}>
                    <tr className="hover:bg-slate-50">
                      <td className="td font-medium"><button type="button" className="mr-1 text-slate-500" aria-expanded={openRows.has(r.itemCode)} aria-label={`Where is ${r.itemCode} held`} title="Show where it is held, with value and dates" onClick={() => setOpenRows((s) => { const x = new Set(s); if (x.has(r.itemCode)) x.delete(r.itemCode); else x.add(r.itemCode); return x; })}>{openRows.has(r.itemCode) ? '▾' : '▸'}</button>{r.itemCode}</td><td className="td">{r.itemName}</td>
                      {d.warehouses.map((w) => <td key={w} className="td text-right tabular-nums">{r.by[w] ? n(r.by[w]) : <span className="text-slate-300">—</span>}</td>)}
                      <td className="td text-right font-semibold tabular-nums">{n(r.total)}</td>{d.virtual?.length > 0 && <td className="td text-right tabular-nums">{n(r.all)}</td>}<td className="td text-right tabular-nums">{n(r.value)}</td>
                    </tr>
                    {openRows.has(r.itemCode) && <Where code={r.itemCode} cols={d.warehouses.length + 4 + (d.virtual?.length > 0 ? 1 : 0)} />}
                    </Fragment>
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
