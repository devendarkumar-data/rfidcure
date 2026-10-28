import { useEffect, useMemo, useState } from 'react';
import { api, idemKey } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
const TONE = { Pending: 'bg-amber-50 text-amber-800', 'Partly settled': 'bg-blue-50 text-blue-800', Settled: 'bg-green-50 text-green-800' };

function Trail({ data }) {
  return (
    <Card title={`Trail — ${data.position.ref}`} className="mt-4">
      <div className="mb-2 text-sm text-slate-600">{data.position.hospital} · dispatched {data.position.dispatched} · returned {data.position.returned} · consumed {data.position.consumed} · balance {data.position.balance} · <span className={`rounded px-1.5 py-0.5 text-xs ${TONE[data.position.status] || ''}`}>{data.position.status}</span></div>
      <table className="min-w-full divide-y divide-slate-200 text-sm"><thead><tr><th className="th">Step</th><th className="th">Document</th><th className="th">Date</th><th className="th text-right">Qty</th><th className="th">By</th><th className="th">Note</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.events.map((e) => <tr key={e.no}><td className="td font-medium">{e.type}</td><td className="td">{e.no}</td><td className="td">{e.date}</td><td className="td text-right tabular-nums">{e.qty}</td><td className="td">{e.by}</td><td className="td text-slate-600">{e.note}</td></tr>)}</tbody></table>
    </Card>
  );
}

export default function ImprestSettle() {
  const toast = useToast();
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  const [ref, setRef] = useState(''); const [used, setUsed] = useState({}); // key -> { on, qty }
  const [hdr, setHdr] = useState({ date: todayIST(), billNo: '', billDate: '', narration: '' });
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [key, setKey] = useState(idemKey());
  const load = () => api.get('/api/imprest/pending').then((r) => setRows(r.rows)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const cur = useMemo(() => (rows || []).find((r) => r.ref === ref), [rows, ref]);
  useEffect(() => { setUsed({}); }, [ref]);

  const lines = (cur?.lines || []).filter((l) => l.balance > 0);
  const consumed = (l) => (used[l.key]?.on ? Math.min(l.balance, num(used[l.key].qty)) : 0);
  const totC = lines.reduce((s, l) => s + consumed(l), 0); const totR = lines.reduce((s, l) => s + l.balance - consumed(l), 0);
  const toggle = (l, on) => setUsed((u) => ({ ...u, [l.key]: { on, qty: on ? (u[l.key]?.qty || l.balance) : '' } }));

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!cur) { setErr('Choose the Imprest Out to settle.'); return; }
    if (totC > 0 && !hdr.billNo.trim()) { setErr('Bill No is required for the consumed items.'); return; }
    setBusy(true);
    try {
      const r = await api.post('/api/imprest/settle', { ref, date: hdr.date, billNo: hdr.billNo, billDate: hdr.billDate, narration: hdr.narration, lines: lines.filter((l) => consumed(l) > 0).map((l) => ({ key: l.key, consumed: consumed(l) })) }, { headers: { 'Idempotency-Key': key } });
      toast.success(`Settled ${ref}: returned ${r.summary.returned}, consumed ${r.summary.consumed}`);
      setDone(r); setRef(''); setKey(idemKey()); setHdr((h) => ({ ...h, billNo: '', billDate: '', narration: '' })); load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (!rows && !err) return <Spinner />;
  return (
    <>
      <PageHeader title="Imprest In — settle pending imprest" subtitle="Pick the Imprest Out. Tick the items the hospital CONSUMED; everything not ticked is returned to the warehouse as Imprest In." />
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <form onSubmit={submit} noValidate>
        <Card title="Pending imprest">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2"><label className="label" htmlFor="im-ref">Imprest Out (pending)</label>
              <select id="im-ref" className="input" value={ref} onChange={(e) => { setRef(e.target.value); setDone(null); }}>
                <option value="">{(rows || []).length ? 'Select…' : 'No pending imprest'}</option>
                {(rows || []).map((r) => <option key={r.ref} value={r.ref}>{r.ref} · {r.hospital} · {r.date} · pending {r.balance} ({r.status})</option>)}
              </select></div>
            <div><label className="label" htmlFor="im-date">Date</label><input id="im-date" type="date" className="input" value={hdr.date} onChange={(e) => setHdr({ ...hdr, date: e.target.value })} /></div>
            <div><label className="label" htmlFor="im-bill">Bill No {totC > 0 && <span className="text-red-600">*</span>}</label><input id="im-bill" className="input" value={hdr.billNo} onChange={(e) => setHdr({ ...hdr, billNo: e.target.value })} placeholder="needed for consumed items" /></div>
            <div><label className="label" htmlFor="im-billdate">Bill Date</label><input id="im-billdate" type="date" className="input" value={hdr.billDate} onChange={(e) => setHdr({ ...hdr, billDate: e.target.value })} /></div>
            <div className="lg:col-span-3"><label className="label" htmlFor="im-note">Narration</label><input id="im-note" className="input" value={hdr.narration} onChange={(e) => setHdr({ ...hdr, narration: e.target.value })} /></div>
          </div>
        </Card>
        {cur && (
          <Card title={`${cur.ref} — ${cur.hospital}`} className="mt-4">
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead><tr><th className="th">#</th><th className="th">Item</th><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Dispatched</th><th className="th text-right">Pending</th><th className="th">Consumed?</th><th className="th text-right">Consumed qty</th><th className="th text-right">Returned (Imprest In)</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, i) => (
                    <tr key={l.key} className={used[l.key]?.on ? 'bg-amber-50/50' : ''}>
                      <td className="td text-slate-400">{i + 1}</td><td className="td">{l.code} — {l.name}</td><td className="td">{l.batch}</td><td className="td">{l.expiry}</td>
                      <td className="td text-right tabular-nums">{l.dispatched}</td><td className="td text-right tabular-nums">{l.balance}</td>
                      <td className="td"><label className="flex items-center gap-2"><input type="checkbox" checked={!!used[l.key]?.on} onChange={(e) => toggle(l, e.target.checked)} aria-label={`Consumed ${l.code}`} /> <span className="text-xs text-slate-500">{used[l.key]?.on ? 'Consumed' : 'Return'}</span></label></td>
                      <td className="td text-right"><input className="input w-24 text-right" type="number" min="0" max={l.balance} step="any" disabled={!used[l.key]?.on} value={used[l.key]?.qty ?? ''} onChange={(e) => setUsed((u) => ({ ...u, [l.key]: { on: true, qty: e.target.value } }))} aria-label={`Consumed qty ${l.code}`} /></td>
                      <td className="td text-right tabular-nums font-medium">{Math.round((l.balance - consumed(l)) * 1e6) / 1e6}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={7}>Total</td><td className="td text-right tabular-nums">{Math.round(totC * 1e6) / 1e6}</td><td className="td text-right tabular-nums">{Math.round(totR * 1e6) / 1e6}</td></tr></tfoot>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Ticked = consumed by the hospital (posted as Consumption against the bill). Not ticked = returned to the warehouse (posted as Imprest In).</p>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Settle imprest'}</button>
            </div>
          </Card>
        )}
      </form>
      {done && (<><div className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">Settled {done.ref}: returned {done.summary.returned}{done.inDoc ? ` (${done.inDoc})` : ''}, consumed {done.summary.consumed}{done.consumptionDoc ? ` (${done.consumptionDoc})` : ''}.</div><Trail data={done.trail} /></>)}
    </>
  );
}
