import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';

// Dispatches (Imprest Out / Stock Transfer) that do not have an E-Way Bill yet.
export default function EwayPending() {
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { api.get('/api/eway/pending').then((r) => setRows(r.rows)).catch((e) => setErr(e.message)); }, []);
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return (rows || []).filter((r) => !n || `${r.doc} ${r.type} ${r.from} ${r.to} ${r.party}`.toLowerCase().includes(n)); }, [rows, q]);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="E-Way Bill — pending" subtitle="Dispatches that do not have an E-Way Bill yet. Create the E-Way Bill from the row; it is linked through Ref. Doc and leaves this list once saved." />
      <Card>
        <div className="mb-3 max-w-xs"><input className="input" placeholder="Search document, warehouse, hospital…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr><th className="th">Document</th><th className="th">Type</th><th className="th">Date</th><th className="th">From</th><th className="th">To</th><th className="th">Hospital</th><th className="th text-right">Qty</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td className="td text-slate-500" colSpan={8}>No dispatch is waiting for an E-Way Bill.</td></tr>}
              {shown.map((r) => (
                <tr key={r.doc} className="hover:bg-slate-50">
                  <td className="td font-medium">{r.doc}</td><td className="td">{r.type}</td><td className="td">{r.date}</td><td className="td">{r.from}</td><td className="td">{r.to}</td><td className="td">{r.party}</td><td className="td text-right tabular-nums">{r.qty}</td>
                  <td className="td text-right"><Link className="btn btn-sm btn-primary" to={`/t/e-way-bill-outward?new=1&ref=${encodeURIComponent(r.doc)}`}>Create E-Way Bill</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
