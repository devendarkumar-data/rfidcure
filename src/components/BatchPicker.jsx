import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

const rq = (n) => Math.round(n * 1e6) / 1e6;
const num = (v) => Number(v) || 0;
const todayIso = () => new Date().toISOString().slice(0, 10);

// Batch window for an outward line (same idea as the Focus "Batch" window): shows the batches of the item in a warehouse,
// "Pick on FIFO" / "Pick on LIFO" fills Qty Adjusted batch by batch (earliest expiry first / latest expiry first) until the line quantity is met.
export default function BatchPicker({ open, onClose, warehouse, code, itemName, quantity, onApply }) {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  const [mode, setMode] = useState('after'); const [days, setDays] = useState(''); const [q, setQ] = useState(''); const [all, setAll] = useState(false);
  const [adj, setAdj] = useState({});
  useEffect(() => {
    if (!open) return;
    setRows(null); setErr(''); setAdj({});
    api.get('/api/stock/batches', { warehouse, code }).then((r) => setRows(r.batches || [])).catch((e) => { setErr(e.message); setRows([]); });
  }, [open, warehouse, code]);
  const shown = useMemo(() => {
    const lim = days !== '' && Number(days) >= 0 ? new Date(Date.now() + Number(days) * 864e5).toISOString().slice(0, 10) : '';
    const n = q.trim().toLowerCase();
    return (rows || []).filter((b) => (all || !b.expired)
      && (!lim || (mode === 'in' ? (b.expiry && b.expiry <= lim && b.expiry >= todayIso()) : (!b.expiry || b.expiry > lim)))
      && (!n || b.batch.toLowerCase().includes(n)));
  }, [rows, days, mode, q, all]);
  const total = num(quantity); const used = rq(Object.values(adj).reduce((s, v) => s + num(v), 0));
  const pick = (dir) => { // FIFO = earliest expiry first, LIFO = latest expiry first
    const order = [...shown].filter((b) => !b.expired).sort((a, b) => (String(a.expiry || '9999') > String(b.expiry || '9999') ? 1 : -1) * (dir === 'lifo' ? -1 : 1));
    let need = total; const next = {};
    for (const b of order) { if (need <= 0) break; const take = Math.min(need, b.qty); next[b.batch] = rq(take); need = rq(need - take); }
    setAdj(next);
  };
  const setOne = (b, v) => setAdj((a) => ({ ...a, [b.batch]: v === '' ? '' : Math.max(0, Math.min(num(v), b.qty)) }));
  const stock = (rows || []).reduce((s, b) => s + (b.expired ? 0 : b.qty), 0);
  const apply = () => { const picked = (rows || []).filter((b) => num(adj[b.batch]) > 0).map((b) => ({ batch: b.batch, expiry: b.expiry || '', rate: b.rate, qty: num(adj[b.batch]), stock: b.qty })); onApply(picked); onClose(); };
  if (!open) return null;
  return (
    <Modal onClose={onClose} title="Batch" wide>
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-4">
        <div className="sm:col-span-1"><span className="text-slate-500">Item: </span><b>{code}</b><div className="truncate text-xs text-slate-500" title={itemName}>{itemName}</div></div>
        <div><span className="text-slate-500">Total Qty: </span><b className="tabular-nums">{total}</b></div>
        <div><span className="text-slate-500">Adj Qty: </span><b className="tabular-nums">{used}</b></div>
        <div><span className="text-slate-500">Balance: </span><b className={`tabular-nums ${rq(total - used) !== 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{rq(total - used)}</b></div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold text-slate-700">Show batches</span>
        <label className="flex items-center gap-1"><input type="radio" checked={mode === 'in'} onChange={() => setMode('in')} /> Expiring in</label>
        <label className="flex items-center gap-1"><input type="radio" checked={mode === 'after'} onChange={() => setMode('after')} /> Expiring after</label>
        <label className="flex items-center gap-1">within <input className="input w-20" type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days" /> days</label>
        <input className="input w-48" placeholder="Search batches" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search batches" />
        <label className="flex items-center gap-1"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all available batches (incl. expired)</label>
      </div>
      {err && <p role="alert" className="mb-2 text-sm text-red-600">{err}</p>}
      <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-brand-700 text-white"><tr>{['Batch No', 'Base Quantity', 'Expiry Date', 'Qty Adjusted', 'Rate', 'Stock in Hand', 'Warehouse'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows === null && <tr><td className="px-3 py-3 text-slate-500" colSpan={7}>Loading…</td></tr>}
            {rows && !shown.length && <tr><td className="px-3 py-3 text-slate-500" colSpan={7}>No batch to show.</td></tr>}
            {shown.map((b) => (
              <tr key={b.batch} className={b.expired ? 'bg-red-50' : ''}>
                <td className="px-3 py-1.5 font-medium">{b.batch}{b.expired && <span className="ml-1 text-xs text-red-600">(expired)</span>}</td>
                <td className="px-3 py-1.5 tabular-nums">{b.qty}</td><td className="px-3 py-1.5 whitespace-nowrap">{b.expiry || '—'}</td>
                <td className="px-3 py-1.5"><input className="input w-24 text-right" type="number" min="0" max={b.qty} step="any" value={adj[b.batch] ?? ''} onChange={(e) => setOne(b, e.target.value)} aria-label={`Qty adjusted ${b.batch}`} /></td>
                <td className="px-3 py-1.5 tabular-nums">{b.rate}</td><td className="px-3 py-1.5 tabular-nums">{b.qty}</td><td className="px-3 py-1.5">{warehouse}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="bg-slate-50 font-semibold"><td className="px-3 py-1.5">Total</td><td className="px-3 py-1.5 tabular-nums">{rq(stock)}</td><td /><td className="px-3 py-1.5 tabular-nums">{used}</td><td colSpan={3} /></tr></tfoot>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={() => pick('fifo')} disabled={!(total > 0)}>Pick on FIFO</button>
        <button type="button" className="btn" onClick={() => pick('lifo')} disabled={!(total > 0)}>Pick on LIFO</button>
        <button type="button" className="btn btn-primary" onClick={apply} disabled={!(used > 0)}>Ok</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
