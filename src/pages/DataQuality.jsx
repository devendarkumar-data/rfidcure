import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';

const SECTIONS = [
  { k: 'negative', title: 'Negative opening quantities', note: 'Often a correction keyed against a different expiry; net them against the matching batch before import.', cols: ['warehouse', 'itemCode', 'itemName', 'batch', 'qty', 'expiry'] },
  { k: 'duplicates', title: 'Duplicate warehouse + item + batch rows', note: 'Same batch appears more than once; the engine adds them together.', cols: ['warehouse', 'itemCode', 'batch', 'rows', 'netQty', 'detail'] },
  { k: 'blankValue', title: 'Blank or zero stock value', note: 'These batches are valued at 0 in stock-value totals.', cols: ['warehouse', 'itemCode', 'itemName', 'batch', 'qty'] },
  { k: 'blankExpiry', title: 'Missing expiry date', note: 'FEFO cannot order these and expiry alerts skip them.', cols: ['warehouse', 'itemCode', 'itemName', 'batch', 'qty'] },
  { k: 'blankBatch', title: 'Missing batch number', cols: ['warehouse', 'itemCode', 'itemName', 'qty'] },
  { k: 'negativeBalances', title: 'Current negative balances (after postings)', note: 'Should be zero once opening stock is cleaned.', cols: ['warehouse', 'itemCode', 'itemName', 'batch', 'qty'] },
];

export default function DataQuality() {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [open, setOpen] = useState('negative');
  useEffect(() => { api.get('/api/data-quality').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!d) return <Spinner />;
  const sec = SECTIONS.find((s) => s.k === open);
  const part = d[open];
  return (
    <>
      <PageHeader title="Data Quality" subtitle={`Scan of ${d.openingRows.toLocaleString()} Opening Stock rows plus current balances.`} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const c = d[s.k]?.count ?? 0;
          return (
            <button key={s.k} onClick={() => setOpen(s.k)} className={`card p-4 text-left transition hover:shadow-md ${open === s.k ? 'ring-2 ring-brand-600' : ''}`} aria-pressed={open === s.k}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</div>
              <div className={`mt-1 text-2xl font-semibold tabular-nums ${c ? 'text-amber-600' : 'text-green-600'}`}>{c.toLocaleString()}</div>
            </button>
          );
        })}
      </div>
      <Card title={sec.title} pad={false}>
        {sec.note && <p className="px-4 pt-3 text-sm text-slate-500">{sec.note}</p>}
        {part.count > part.sample.length && <p className="px-4 pt-2 text-xs text-slate-500">Showing the first {part.sample.length} of {part.count.toLocaleString()}.</p>}
        {part.sample.length ? (
          <div className="mt-2 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200"><thead><tr>{sec.cols.map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{part.sample.map((r, i) => <tr key={i}>{sec.cols.map((c) => <td key={c} className="td">{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div>
        ) : <p className="p-6 text-center text-sm text-green-700">No issues found.</p>}
      </Card>
    </>
  );
}
