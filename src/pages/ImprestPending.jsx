import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';

const OVERDUE_DAYS = 30;
const TONE = { 'Pending Return': 'bg-amber-50 text-amber-800', 'Pending Consumption': 'bg-blue-50 text-blue-800', Closed: 'bg-green-50 text-green-800' };
const daysSince = (d) => (d ? Math.max(0, Math.floor((Date.now() - Date.parse(`${d}T00:00:00+05:30`)) / 86400000)) : 0);

export default function ImprestPending() {
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { api.get('/api/imprest/pending').then((r) => setRows(r.rows)).catch((e) => setErr(e.message)); }, []);
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return (rows || []).filter((r) => !n || `${r.ref} ${r.hospital} ${r.customer}`.toLowerCase().includes(n)); }, [rows, q]);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Imprest In — pending imprest" subtitle="Imprest Outs waiting for the quantity taken back. Open one and enter only what was returned (Imprest In); the rest is then entered in Consumption Pending." />
      <Card>
        <div className="mb-3 max-w-xs"><input className="input" placeholder="Search imprest no. or hospital…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr><th className="th">Imprest No.</th><th className="th">Date</th><th className="th">Hospital</th><th className="th text-right">Dispatched</th><th className="th">Status</th><th className="th text-right">Days open</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td className="td text-slate-500" colSpan={7}>No pending imprest.</td></tr>}
              {shown.map((r) => { const d = daysSince(r.date); return (
                <tr key={r.ref} className="hover:bg-slate-50">
                  <td className="td font-medium"><Link className="text-brand-700 hover:underline" to={`/imprest/settle/${encodeURIComponent(r.ref)}`}>{r.ref}</Link></td><td className="td">{r.date}</td><td className="td">{r.hospital}</td>
                  <td className="td text-right tabular-nums">{r.dispatched}</td>
                  <td className="td"><span className={`rounded px-1.5 py-0.5 text-xs ${TONE[r.status] || ''}`}>{r.status}</span></td>
                  <td className={`td text-right tabular-nums ${d > OVERDUE_DAYS ? 'font-semibold text-red-600' : ''}`} title={d > OVERDUE_DAYS ? `Open for more than ${OVERDUE_DAYS} days` : ''}>{d}</td>
                  <td className="td text-right"><Link className="btn btn-sm btn-primary" to={`/imprest/settle/${encodeURIComponent(r.ref)}`}>Enter Imprest In</Link></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
