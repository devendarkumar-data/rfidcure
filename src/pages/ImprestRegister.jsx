import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';

const TONE = { Pending: 'bg-amber-50 text-amber-800', 'Partly settled': 'bg-blue-50 text-blue-800', Settled: 'bg-green-50 text-green-800' };

// Imprest Out register (what was dispatched, with its settlement status) and Imprest In register (what was taken back) - one row per item.
export default function ImprestRegister() {
  const { type } = useParams(); const isIn = type === 'in';
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { setRows(null); api.get('/api/imprest/register', { type: isIn ? 'in' : 'out' }).then((r) => setRows(r.rows)).catch((e) => setErr(e.message)); }, [isIn]);
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return (rows || []).filter((r) => !n || `${r.no} ${r.hospital} ${r.code} ${r.name} ${r.batch} ${r.ref || ''}`.toLowerCase().includes(n)); }, [rows, q]);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title={isIn ? 'Imprest In Register' : 'Imprest Out Register'} subtitle={isIn ? 'Items taken back from hospitals. Imprest still waiting to be taken back is in Imprest In Pending.' : 'Items dispatched to hospitals, with the settlement status of each Imprest Out.'} />
      <Card>
        <div className="mb-3 max-w-xs"><input className="input" placeholder="Search document, hospital, item, batch…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr><th className="th">Document</th><th className="th">Date</th><th className="th">Hospital</th>{isIn ? <th className="th">Imprest Out</th> : <th className="th">Delivery date</th>}<th className="th">Item</th><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Qty</th>{isIn ? <th className="th">Received at</th> : <th className="th">Status</th>}<th className="th">By</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td className="td text-slate-500" colSpan={10}>No entries.</td></tr>}
              {shown.map((r, i) => (
                <tr key={`${r.no}-${i}`}>
                  <td className="td font-medium">{r.no}</td><td className="td">{r.date}</td><td className="td">{r.hospital}</td><td className="td">{isIn ? r.ref : r.deliveryDate}</td>
                  <td className="td">{r.code} — {r.name}</td><td className="td">{r.batch}</td><td className="td">{r.expiry}</td><td className="td text-right tabular-nums">{r.qty}</td>
                  <td className="td">{isIn ? r.warehouse : <span className={`rounded px-1.5 py-0.5 text-xs ${TONE[r.status] || ''}`}>{r.status}</span>}</td><td className="td">{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
