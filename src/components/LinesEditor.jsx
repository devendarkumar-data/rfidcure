import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Combobox from './Combobox.jsx';
import ItemPicker from './ItemPicker.jsx';

const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);

const SCOPE = { scopeOnly: '1' };
const stableCache = new Map();
const stable = (o) => { const k = JSON.stringify(o); if (!stableCache.has(k)) stableCache.set(k, o); return stableCache.get(k); };
function BatchSelect({ value, onChange, warehouse, code, disabled, auto, all }) {
  const [list, setList] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    if ((!warehouse && !all) || !code) { setList(null); return undefined; }
    let live = true;
    api.get('/api/stock/batches', all ? { code, all: '1' } : { warehouse, code }).then((r) => { if (live) { setList(r.batches || []); setErr(''); } }).catch((e) => { if (live) { setList([]); setErr(e.message); } });
    return () => { live = false; };
  }, [warehouse, code, all]);
  useEffect(() => { // pick the earliest-expiry batch from stock automatically (batch, expiry and rate then follow it)
    if (!auto || disabled || !list || !list.length) return;
    if (!value || !list.some((b) => b.batch === value)) onChange(list[0].batch, list[0]);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!warehouse && !all) return <input className="input" disabled placeholder="Choose warehouse first" />;
  return (
    <div>
      <select className="input" value={value ?? ''} disabled={disabled || !code} onChange={(e) => onChange(e.target.value, (list || []).find((b) => b.batch === e.target.value))} aria-label="Batch">
        {!auto && <option value="">Auto — earliest expiry first (FEFO)</option>}
        {auto && !(list || []).length && <option value="">{code ? 'No batch in stock' : 'Select an item first'}</option>}
        {(list || []).map((b) => <option key={b.batch} value={b.batch}>{b.batch} · exp {b.expiry || 'n/a'}{b.expired ? ' (EXPIRED)' : ''} · qty {b.qty}</option>)}
      </select>
      {err && <p className="mt-0.5 text-xs text-red-600">{err}</p>}
      {auto && code && list && !list.length && !err && <p className="mt-0.5 text-xs text-amber-700">{all ? 'No batch of this item is on record' : `No stock of this item in ${warehouse}`} — batch and expiry cannot be filled.</p>}
    </div>
  );
}

// Generic line-item grid driven by table.lineFields. batchMode: 'pick' (existing batches, outward docs) | 'enter' (free text, inward docs).
export default function LinesEditor({ lineFields, itemField, lines, onChange, getWarehouse, batchMode = 'enter', readOnly = false, errors = {}, autoBatch = false, batchFromAll = false, stockPick = false, stockWh = null, lineDefaults = null, scopeWarehouse = false }) {
  const cols = lineFields.filter((f) => f.name !== 'Item Code' && f.type !== 'calc' || (f.type === 'calc' && ['Gross', 'System Qty'].includes(f.name)));
  const idRef = useRef(1);
  const set = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = () => onChange([...lines, { _k: idRef.current++, ...(lineDefaults || {}) }]);
  const del = (i) => onChange(lines.filter((_, j) => j !== i));
  useEffect(() => { if (!lines.length && !readOnly) onChange([{ _k: idRef.current++, ...(lineDefaults || {}) }]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (f, l, i) => {
    const v = l[f.name] ?? '';
    if (stockPick && f.name === itemField) { // item + batch + expiry come from one stock record (Opening Stock / ledger) of the relevant warehouse
      const wh = stockWh ? stockWh(l) : getWarehouse?.(l);
      return <div className="min-w-[18rem]">{!wh
        ? <input className="input" disabled placeholder={stockPick === 'out' ? 'Choose warehouse first' : 'Select the hospital / imprest warehouse first'} />
        : <Combobox field="Stock Item" extraParams={stable({ warehouse: wh })} allowFree={false} disabled={readOnly || f.readonly} placeholder="Search stock: item, batch…"
            value={v ? `${l['Item Code'] || ''} — ${v}`.replace(/^ — /, '') : ''} onChange={() => {}}
            onPick={(o) => set(i, { 'Item Code': o.code, [itemField]: o.name, Batch: o.batch, _avail: o.qty, 'Expiry Date': o.expiry || '', ...(o.rate ? { Rate: o.rate } : {}), ...(o.unit ? { Units: o.unit } : {}) })} />}
      </div>;
    }
    if (stockPick && f.name === 'Batch') return <input className="input min-w-[8rem] bg-slate-50" value={v} readOnly tabIndex={-1} placeholder="from stock" aria-label="Batch" title="Filled automatically from the selected stock record" />;
    if (f.name === itemField) return <div className="min-w-[14rem]"><ItemPicker value={v ? `${l['Item Code'] || ''} — ${v}`.replace(/^ — /, '') : ''} disabled={readOnly || f.readonly} onChange={({ code, name }) => set(i, { 'Item Code': code, [itemField]: name })} /></div>;
    if (autoBatch && (f.name === 'Expiry Date' || f.name === 'Rate')) return <input className={`input ${f.name === 'Rate' ? 'min-w-[6rem] text-right' : 'min-w-[9rem]'} bg-slate-50`} value={v} readOnly tabIndex={-1} placeholder="from stock" aria-label={f.name} title="Filled automatically from the selected stock batch" />;
    if (f.name === 'Gross') return <span className="tabular-nums">{(num(l.Quantity) * num(l.Rate)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>;
    if (f.type === 'calc') return <span className="tabular-nums text-slate-500">{v}</span>;
    if (f.name === 'Batch' && batchMode === 'pick') return <div className="min-w-[14rem]"><BatchSelect value={v} warehouse={getWarehouse?.(l)} code={l['Item Code']} disabled={readOnly || f.readonly} onChange={(b, o) => set(i, { Batch: b, ...(autoBatch && o ? { 'Expiry Date': o.expiry || '', ...(o.rate ? { Rate: o.rate } : {}) } : {}) })} auto={autoBatch} all={batchFromAll} /></div>;
    if (f.options || f.yesNo) return <select className="input min-w-[7rem]" value={v} disabled={readOnly || f.readonly} onChange={(e) => set(i, { [f.name]: e.target.value })} aria-label={f.name}><option value="">—</option>{(f.options || ['Yes', 'No']).map((o) => <option key={o}>{o}</option>)}</select>;
    if (f.lookup) return <div className="min-w-[10rem]"><Combobox field={f.lookup} extraParams={scopeWarehouse && f.name === 'Warehouse' ? SCOPE : undefined} value={v} disabled={readOnly || f.readonly} onChange={(x) => set(i, { [f.name]: x, ...(f.name === 'Warehouse' ? { Batch: '', ...(stockPick === 'out' ? { 'Item Code': '', [itemField]: '', 'Expiry Date': '', Rate: '', _avail: null } : {}) } : {}) })} /></div>;
    if (stockPick && f.name === 'Quantity') return <div><input className={`input min-w-[6rem] text-right ${l._avail != null && num(v) > l._avail ? 'border-red-400' : ''}`} type="number" min="0" max={l._avail ?? undefined} step="any" value={v} disabled={readOnly || f.readonly} onChange={(e) => set(i, { Quantity: e.target.value })} aria-label="Quantity" />{l._avail != null && <p className={`mt-0.5 text-xs ${num(v) > l._avail ? 'text-red-600' : 'text-slate-500'}`}>Available: {l._avail}</p>}</div>;
    if (f.type === 'number') return <input className="input min-w-[6rem] text-right" type="number" min="0" step="any" value={v} disabled={readOnly || f.readonly} onChange={(e) => set(i, { [f.name]: e.target.value })} aria-label={f.name} />;
    if (f.type === 'date') return <input className="input min-w-[9rem]" type="date" value={v} disabled={readOnly || f.readonly} onChange={(e) => set(i, { [f.name]: e.target.value })} aria-label={f.name} />;
    return <input className="input min-w-[7rem]" value={v} disabled={readOnly || f.readonly} onChange={(e) => set(i, { [f.name]: e.target.value })} aria-label={f.name} />;
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead><tr><th className="th w-8">#</th>{cols.map((f) => <th key={f.name} className="th">{f.name}</th>)}{!readOnly && <th className="th w-10" />}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => (
              <tr key={l._k ?? i} className={errors[i] ? 'bg-red-50' : ''}>
                <td className="td text-slate-400">{i + 1}</td>
                {cols.map((f) => <td key={f.name} className="td align-top">{cell(f, l, i)}</td>)}
                {!readOnly && <td className="td align-top"><button type="button" className="btn btn-sm" onClick={() => del(i)} aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && <button type="button" className="btn btn-sm mt-2" onClick={add}>+ Add line</button>}
    </div>
  );
}
