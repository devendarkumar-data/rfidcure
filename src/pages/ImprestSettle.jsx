import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, idemKey } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
const TONE = { 'Pending Return': 'bg-amber-50 text-amber-800', 'Pending Consumption': 'bg-blue-50 text-blue-800', Closed: 'bg-green-50 text-green-800' };

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
  const { ref: refParam } = useParams(); const ref = decodeURIComponent(refParam || '');
  const toast = useToast();
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const [back, setBack] = useState({}); // key -> quantity TAKEN BACK (text)
  const [hdr, setHdr] = useState({ date: todayIST(), narration: '' });
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [key, setKey] = useState(idemKey());
  const load = () => api.get('/api/imprest/trail', { ref }).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setDone(null); setBack({}); load(); }, [ref]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = data?.position;
  const lines = (cur?.lines || []).filter((l) => l.balance > 0);
  const returned = (l) => Math.min(l.balance, Math.max(0, num(back[l.key])));
    const totR = lines.reduce((s, l) => s + returned(l), 0);
  const [none, setNone] = useState(false);
  const over = lines.find((l) => num(back[l.key]) > l.balance);

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!none && over) { setErr(`${over.code}: returned quantity cannot be more than the ${over.balance} pending.`); return; }
    setBusy(true);
    try {
      const r = await api.post('/api/imprest/return', { ref, date: hdr.date, narration: hdr.narration, noReturn: none, lines: lines.map((l) => ({ key: l.key, returned: returned(l) })) }, { headers: { 'Idempotency-Key': key } });
      toast.success(none ? `${ref}: nothing returned - enter consumption` : `Imprest In ${r.inDoc} saved: ${r.summary.returned} taken back`);
      setDone(r); setKey(idemKey());
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (!data && !err) return <Spinner />;
  return (
    <>
      <Link to="/imprest/pending" className="mb-1 inline-block text-sm text-brand-700 hover:underline">← Imprest In Pending</Link>
      <PageHeader title={`Imprest In — ${ref}`} subtitle={cur ? `${cur.hospital} · dispatched ${cur.dispatched}` : ''} />
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {done && <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{done.inDoc ? `Imprest In ${done.inDoc} saved: ${done.summary.returned} taken back. ` : 'Marked as nothing returned. '}{done.summary.toConsume > 0 && <>Remaining {done.summary.toConsume} is waiting in <Link className="underline" to="/consumption/pending">Consumption Pending</Link> for the consumption entry. </>}<Link className="underline" to="/imprest/pending">Back to Imprest In Pending</Link></div>}
      {cur && lines.length > 0 && !done && (
        <form onSubmit={submit} noValidate>
          <Card title="How much was taken back?">
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead><tr><th className="th">#</th><th className="th">Item</th><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Dispatched</th><th className="th text-right">Taken back (Imprest In qty)</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td className="td text-slate-400">{i + 1}</td><td className="td">{l.code} — {l.name}</td><td className="td">{l.batch}</td><td className="td">{l.expiry}</td>
                      <td className="td text-right tabular-nums">{l.dispatched}</td>
                      <td className="td text-right"><input className={`input w-24 text-right ${num(back[l.key]) > l.balance ? 'border-red-400' : ''}`} type="number" min="0" max={l.balance} step="any" placeholder="0" value={back[l.key] ?? ''} onChange={(e) => setBack((u) => ({ ...u, [l.key]: e.target.value }))} aria-label={`Returned qty ${l.code}`} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={5}>Total</td><td className="td text-right tabular-nums">{Math.round(totR * 1e6) / 1e6}</td></tr></tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Enter only the quantity taken back (e.g. 80 of 100). The remaining quantity is not posted here - it appears in <b>Consumption Pending</b>, where the consumption is entered manually.</p>
          </Card>
          <Card title="Date" className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="label" htmlFor="im-date">Date</label><input id="im-date" type="date" className="input" value={hdr.date} onChange={(e) => setHdr({ ...hdr, date: e.target.value })} /></div>
              <div className="lg:col-span-2"><label className="label" htmlFor="im-note">Narration</label><input id="im-note" className="input" value={hdr.narration} onChange={(e) => setHdr({ ...hdr, narration: e.target.value })} /></div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} /> Nothing was returned (everything goes to consumption)</label>
            <div className="mt-3 flex justify-end"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : none ? 'Save: nothing returned' : `Save Imprest In (${Math.round(totR * 1e6) / 1e6})`}</button></div>
          </Card>
        </form>
      )}
      {cur && !lines.length && !done && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{ref} is closed.</div>}
      {(done?.trail || data) && <Trail data={done?.trail || data} />}
    </>
  );
}
