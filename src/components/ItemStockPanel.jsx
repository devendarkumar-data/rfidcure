import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const n2 = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Side information while entering documents: when an item is picked on a line, shows its stock in every warehouse (read-only).
// Every user can see other warehouses' availability even though they can only transact in their own.
export default function ItemStockPanel({ codes, highlight }) {
  const prev = useRef([]); const [info, setInfo] = useState(null); const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const now = (codes || []).filter(Boolean); const before = prev.current; prev.current = now;
    const added = now.find((c, i) => c !== before[i]);
    if (!added) return;
    setHidden(false);
    api.get('/api/stock/item-warehouses', { code: added }).then(setInfo).catch(() => {});
  }, [(codes || []).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!info || hidden) return null;
  const hl = String(highlight || '').toUpperCase();
  return (
    <div className="mb-3 rounded-md border border-brand-200 bg-brand-50 p-3 text-sm" aria-live="polite">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2"><div><span className="font-semibold">{info.name || info.code}</span> <span className="text-xs text-slate-500">{info.code} · stock by warehouse</span></div><button type="button" className="text-xs text-slate-500 underline" onClick={() => setHidden(true)}>Hide</button></div>
      <div className="flex flex-wrap gap-2">{info.rows.map((w) => (
        <div key={w.warehouse} className={`min-w-[5.5rem] rounded border bg-white px-2 py-1 ${w.warehouse.toUpperCase() === hl ? 'border-brand-600' : 'border-slate-200'}`}><div className="text-[11px] text-slate-500">{w.warehouse}</div><div className="font-semibold tabular-nums">{n2(w.qty)}</div></div>))}
        <div className="min-w-[5.5rem] rounded border border-slate-300 bg-slate-100 px-2 py-1"><div className="text-[11px] text-slate-500">All warehouses</div><div className="font-semibold tabular-nums">{n2(info.total)}</div></div></div>
    </div>
  );
}
