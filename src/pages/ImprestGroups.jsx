import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { printPath } from './DocPrint.jsx';
import { DATE_OPTIONS, fmtDate, rangeFor } from '../dateOptions.js';

const SLUG = { 'Imprest Out': 'imprest-out-new', 'Imprest In': 'imprest-in-new', Consumption: 'material-consumption' };
const TONE = { 'Imprest Out': 'bg-sky-50 text-sky-800', 'Imprest In': 'bg-green-50 text-green-800', Consumption: 'bg-amber-50 text-amber-800' };
const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Imprest group register: each Imprest Out voucher is a group; under it, its Imprest In and Consumption documents date-wise.
export default function ImprestGroups() {
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState(''); const [st, setSt] = useState('');
  const [opt, setOpt] = useState('All'); const [rng, setRng] = useState({ from: '', to: '' }); const [closed, setClosed] = useState({});
  useEffect(() => { api.get('/api/imprest/groups').then((r) => setRows(r.rows)).catch((e) => setErr(e.message)); }, []);
  const pickOpt = (o) => { setOpt(o); setRng(o === 'All' ? { from: '', to: '' } : o === 'Date Range' ? rng : rangeFor(o)); };
  const shown = useMemo(() => (rows || []).filter((g) => {
    const n = q.trim().toLowerCase();
    return (!rng.from || g.date >= rng.from) && (!rng.to || g.date <= rng.to) && (!st || g.status === st)
      && (!n || `${g.ref} ${g.hospital} ${g.doctor} ${g.events.map((e) => e.no).join(' ')}`.toLowerCase().includes(n));
  }), [rows, q, rng, st]);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Imprest Group Register" subtitle="One group per Imprest Out voucher. Under it: every Imprest In and Consumption against that voucher, date-wise, with the counts and the open balance." />
      <Card>
        <div className="mb-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <label className="block"><span className="label">Search</span><input className="input" placeholder="Voucher, hospital, doctor, document…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
          <label className="block"><span className="label">Date option</span><select className="input" value={opt} onChange={(e) => pickOpt(e.target.value)}>{['All', ...DATE_OPTIONS.filter((o) => o !== 'As on date')].map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="block"><span className="label">From</span><input type="date" className="input" value={rng.from} disabled={opt !== 'Date Range'} onChange={(e) => setRng({ ...rng, from: e.target.value })} /></label>
          <label className="block"><span className="label">To</span><input type="date" className="input" value={rng.to} disabled={opt !== 'Date Range'} onChange={(e) => setRng({ ...rng, to: e.target.value })} /></label>
          <label className="block"><span className="label">Status</span><select className="input" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All</option><option value="Open">Pending</option><option value="Closed">Closed</option></select></label>
        </div>
        {!shown.length && <p className="p-4 text-sm text-slate-500">No imprest vouchers found.</p>}
        <div className="space-y-3">
          {shown.map((g) => {
            const shut = !!closed[g.ref];
            return (
              <section key={g.ref} className="rounded-md border border-slate-200">
                <header className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-50 px-3 py-2 text-sm">
                  <button type="button" className="text-slate-500" aria-expanded={!shut} aria-label={shut ? 'Show documents' : 'Hide documents'} onClick={() => setClosed((c) => ({ ...c, [g.ref]: !shut }))}>{shut ? '▸' : '▾'}</button>
                  <Link className="font-semibold text-brand-700 hover:underline" to={printPath('imprest-out-new', g.ref)}>{g.ref}</Link>
                  <span>{fmtDate(g.date)}</span><span className="font-medium">{g.hospital}</span>{g.doctor && <span className="text-slate-600">Dr. {g.doctor.replace(/^Dr\.?\s*/i, '')}</span>}
                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-800">{g.counts.out} Imprest Out</span>
                  <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-800">{g.counts.in} Imprest In</span>
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">{g.counts.cons} Consumption</span>
                  <span className="ml-auto tabular-nums text-slate-600">out {n2(g.dispatched)} · in {n2(g.returned)} · consumed {n2(g.consumed)} · <b>balance {n2(g.balance)}</b></span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${g.status === 'Open' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>{g.status === 'Open' ? 'Pending' : 'Closed'}</span>
                </header>
                {!shut && (
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead><tr><th className="th">Date</th><th className="th">Type</th><th className="th">Document No.</th><th className="th text-right">Qty</th><th className="th">By</th><th className="th">Note</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {g.events.map((e) => (
                        <tr key={`${e.type}-${e.no}`}>
                          <td className="td !py-1 whitespace-nowrap">{fmtDate(e.date)}</td>
                          <td className="td !py-1"><span className={`rounded px-1.5 py-0.5 text-xs ${TONE[e.type]}`}>{e.type}</span></td>
                          <td className="td !py-1"><Link className="text-brand-700 hover:underline" to={printPath(SLUG[e.type], e.no)}>{e.no}</Link></td>
                          <td className="td !py-1 text-right tabular-nums">{n2(e.qty)}</td><td className="td !py-1">{e.by}</td><td className="td !py-1 text-slate-600">{e.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      </Card>
    </>
  );
}
