import { Link } from 'react-router-dom';
import { printPath } from './DocPrint.jsx';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { DATE_OPTIONS, rangeFor, natCompare, downloadCsv } from '../dateOptions.js';

const TONE = { Open: 'bg-amber-50 text-amber-800', Closed: 'bg-green-50 text-green-800' };

// Imprest Out register (what was dispatched, with its settlement status) and Imprest In register (what was taken back) - one row per item.
export default function ImprestRegister() {
  const { type } = useParams(); const isIn = type === 'in';
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  const [opt, setOpt] = useState('As on date'); const [wh, setWh] = useState(''); const [out, setOut] = useState('Screen');
  const [rng, setRng] = useState(rangeFor('As on date')); const pickOpt = (o) => { setOpt(o); if (o !== 'Date Range') setRng(rangeFor(o)); };
  useEffect(() => { setRows(null); api.get('/api/imprest/register', { type: isIn ? 'in' : 'out' }).then((r) => setRows(r.rows)).catch((e) => setErr(e.message)); }, [isIn]);
  const shown = useMemo(() => { // newest date first, then highest document number first
    const n = q.trim().toLowerCase();
    return (rows || []).filter((r) => (!rng.from || String(r.date) >= rng.from) && (!rng.to || String(r.date) <= rng.to) && (!wh || (isIn ? r.warehouse : r.hospital) === wh)
      && (!n || `${r.no} ${r.hospital} ${r.code} ${r.name} ${r.batch} ${r.ref || ''}`.toLowerCase().includes(n)))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || natCompare(b.no, a.no));
  }, [rows, q, rng, wh, isIn]);
  const whs = useMemo(() => [...new Set((rows || []).map((r) => (isIn ? r.warehouse : r.hospital)).filter(Boolean))].sort(), [rows, isIn]);
  const run = () => {
    if (out === 'Printer') window.print();
    else if (out.startsWith('Excel')) downloadCsv(`${isIn ? 'imprest-in' : 'imprest-out'}-register.csv`, ['Document', 'Date', 'Hospital', isIn ? 'Imprest Out' : 'Delivery date', 'Item Code', 'Item', 'Batch', 'Expiry', 'Qty', isIn ? 'Warehouse' : 'Status', 'By'], shown.map((r) => [r.no, r.date, r.hospital, isIn ? r.ref : r.deliveryDate, r.code, r.name, r.batch, r.expiry, r.qty, isIn ? r.warehouse : r.status, r.by]));
  };
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title={isIn ? 'Imprest In Register' : 'Imprest Out Register'} subtitle={isIn ? 'Items taken back from hospitals. Imprest still waiting to be taken back is in Imprest In Pending.' : 'Items dispatched to hospitals, with the settlement status of each Imprest Out.'} />
      <Card>
        <div className="mb-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className="label">Date option</span><select className="input" value={opt} onChange={(e) => pickOpt(e.target.value)}>{DATE_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="block"><span className="label">Start date</span><input type="date" className="input" value={rng.from} disabled={opt !== 'Date Range'} onChange={(e) => setRng((x) => ({ ...x, from: e.target.value }))} /></label>
          <label className="block"><span className="label">End date</span><input type="date" className="input" value={rng.to} disabled={opt !== 'Date Range' && opt !== 'As on date'} onChange={(e) => setRng((x) => ({ ...x, to: e.target.value }))} /></label>
          <label className="block"><span className="label">{isIn ? 'Warehouse' : 'Hospital'}</span><select className="input" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All</option>{whs.map((w) => <option key={w}>{w}</option>)}</select></label>
          <label className="block"><span className="label">Search</span><input className="input" placeholder="Document, hospital, item, batch…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
          <label className="block"><span className="label">Output</span><select className="input" value={out} onChange={(e) => setOut(e.target.value)}>{['Screen', 'Printer', 'Excel (CSV)'].map((o) => <option key={o}>{o}</option>)}</select></label>
          <div className="flex items-end"><button type="button" className="btn btn-primary" onClick={run} disabled={out === 'Screen'}>Ok</button><span className="ml-3 pb-2 text-xs text-slate-500">{shown.length} lines</span></div>
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr><th className="th">Document</th><th className="th">Date</th><th className="th">Hospital</th>{isIn ? <th className="th">Imprest Out</th> : <th className="th">Delivery date</th>}<th className="th">Item</th><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Qty</th>{isIn ? <th className="th">Received at</th> : <th className="th">Status</th>}<th className="th">By</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td className="td text-slate-500" colSpan={10}>No entries.</td></tr>}
              {shown.map((r, i) => (
                <tr key={`${r.no}-${i}`}>
                  <td className="td !py-1 whitespace-nowrap font-medium"><Link className="text-brand-700 hover:underline" to={printPath(isIn ? 'imprest-in-new' : 'imprest-out-new', r.no)} title="Open / print document">{r.no}</Link></td><td className="td !py-1 whitespace-nowrap">{r.date}</td><td className="td">{r.hospital}</td><td className="td">{isIn ? r.ref : r.deliveryDate}</td>
                  <td className="td !py-1 min-w-[18rem]">{r.code} — {r.name}</td><td className="td !py-1 whitespace-nowrap">{r.batch}</td><td className="td !py-1 whitespace-nowrap">{r.expiry}</td><td className="td !py-1 text-right tabular-nums">{r.qty}</td>
                  <td className="td !py-1">{isIn ? r.warehouse : <span className={`rounded px-1.5 py-0.5 text-xs ${TONE[r.status] || ''}`}>{r.status === 'Open' ? 'Pending' : r.status}</span>}</td><td className="td !py-1 max-w-[12rem] truncate" title={r.by}>{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
