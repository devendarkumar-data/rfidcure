import { Link } from 'react-router-dom';
import { printPath } from './DocPrint.jsx';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, download } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { downloadDocPdf } from '../docPdf.js';
import { fmtDate, DATE_OPTIONS, rangeFor, natCompare, downloadCsv } from '../dateOptions.js';

const TONE = { Open: 'bg-amber-50 text-amber-800', Closed: 'bg-green-50 text-green-800' };

// Imprest Out register (what was dispatched, with its settlement status) and Imprest In register (what was taken back) - one row per item.
const TITLES = { out: 'Imprest Out Register', in: 'Imprest In Register', cons: 'Consumption Register' };
const SLUG = { out: 'imprest-out-new', in: 'imprest-in-new', cons: 'material-consumption' };
const SUB = { out: 'Items dispatched to hospitals, with the settlement status of each voucher. Columns follow the Focus register export.', in: 'Items taken back from hospitals. Imprest still waiting to be taken back is in Imprest In Pending.', cons: 'Items consumed by hospitals against Imprest Out vouchers.' };
const NUM = new Set(['Quantity', 'Net Amount', 'Rate']);

// Imprest Out / Imprest In / Consumption registers - one row per item line, with the same columns as the Focus export; each document has its own PDF.
export default function ImprestRegister({ kind }) {
  const params = useParams(); const type = kind || params.type || 'out';
  const [rows, setRows] = useState(null); const [cols, setCols] = useState([]); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  const [st, setSt] = useState(''); const [opt, setOpt] = useState('As on date'); const [wh, setWh] = useState(''); const [out, setOut] = useState('Screen');
  const [rng, setRng] = useState(rangeFor('As on date')); const pickOpt = (o) => { setOpt(o); if (o !== 'Date Range') setRng(rangeFor(o)); };
  useEffect(() => { setRows(null); setErr(''); api.get('/api/imprest/register', { type }).then((r) => { setRows(r.rows); setCols(r.columns); }).catch((e) => setErr(e.message)); }, [type]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows || []).filter((r) => (!rng.from || String(r.date) >= rng.from) && (!rng.to || String(r.date) <= rng.to) && (!wh || r['Warehouse 2'] === wh) && (!st || r.status === st)
      && (!n || cols.some((c) => String(c === 'DocNo' ? r.no : c === 'Date' ? r.date : r[c] ?? '').toLowerCase().includes(n))))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || natCompare(b.no, a.no));
  }, [rows, q, rng, wh, st, cols]);
  const whs = useMemo(() => [...new Set((rows || []).map((r) => r['Warehouse 2']).filter(Boolean))].sort(), [rows]);
  const cell = (r, c) => (c === 'DocNo' ? r.no : c === 'Date' ? r.date : r[c] ?? ''); const show = (r, c) => fmtDate(cell(r, c));
  const total = (c) => Math.round(shown.reduce((s, r) => s + (Number(r[c]) || 0), 0) * 100) / 100;
  const run = () => {
    if (out === 'Printer') window.print();
    else if (out === 'Excel (Sheet)') download('/api/imprest/register', { type, export: 'xlsx' }, `${TITLES[type].toLowerCase().replace(/ /g, '-')}.xlsx`).catch((e) => setErr(e.message));
    else if (out.startsWith('Excel')) downloadCsv(`${TITLES[type].toLowerCase().replace(/ /g, '-')}.csv`, cols, shown.map((r) => cols.map((c) => cell(r, c))));
  };
  const pdf = (no) => downloadDocPdf(type, no, (rows || []).filter((r) => r.no === no)).catch((e) => setErr(e.message));
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title={TITLES[type]} subtitle={SUB[type]} />
      <Card>
        <div className="mb-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className="label">Date option</span><select className="input" value={opt} onChange={(e) => pickOpt(e.target.value)}>{DATE_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="block"><span className="label">Start date</span><input type="date" className="input" value={rng.from} disabled={opt !== 'Date Range'} onChange={(e) => setRng((x) => ({ ...x, from: e.target.value }))} /></label>
          <label className="block"><span className="label">End date</span><input type="date" className="input" value={rng.to} disabled={opt !== 'Date Range' && opt !== 'As on date'} onChange={(e) => setRng((x) => ({ ...x, to: e.target.value }))} /></label>
          <label className="block"><span className="label">Hospital</span><select className="input" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All</option>{whs.map((w) => <option key={w}>{w}</option>)}</select></label>
          {type === 'out' && <label className="block"><span className="label">Status</span><select className="input" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All</option><option value="Open">Pending</option><option value="Closed">Closed</option></select></label>}
          <label className="block"><span className="label">Search</span><input className="input" placeholder="Document, hospital, item, batch…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
          <label className="block"><span className="label">Output</span><select className="input" value={out} onChange={(e) => setOut(e.target.value)}>{['Screen', 'Printer', 'Excel (CSV)', 'Excel (Sheet)'].map((o) => <option key={o}>{o}</option>)}</select></label>
          <div className="flex items-end"><button type="button" className="btn btn-primary" onClick={run} disabled={out === 'Screen'}>Ok</button><span className="ml-3 pb-2 text-xs text-slate-500">{shown.length} lines</span></div>
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr><th className="th">PDF</th>{cols.map((c) => <th key={c} className="th whitespace-nowrap">{c}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td className="td text-slate-500" colSpan={cols.length + 1}>No entries.</td></tr>}
              {shown.map((r, i) => (
                <tr key={`${r.no}-${i}`}>
                  <td className="td !py-1"><button type="button" className="text-brand-700 hover:underline" title="Download this document as PDF" onClick={() => pdf(r.no)}>PDF</button></td>
                  {cols.map((c) => (
                    <td key={c} className={`td !py-1 whitespace-nowrap ${NUM.has(c) ? 'text-right tabular-nums' : ''}`}>
                      {c === 'DocNo' ? <Link className="font-medium text-brand-700 hover:underline" to={printPath(SLUG[type], r.no)} title="Open / print document">{r.no}</Link> : show(r, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {!!shown.length && <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" />{cols.map((c) => <td key={c} className={`td !py-1 ${NUM.has(c) ? 'text-right tabular-nums' : ''}`}>{c === 'DocNo' ? 'Grand Total' : c === 'Quantity' || c === 'Net Amount' ? total(c) : ''}</td>)}</tr></tfoot>}
          </table>
        </div>
      </Card>
    </>
  );
}
