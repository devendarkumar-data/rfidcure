import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, idemKey } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
const TONE = { Open: 'bg-amber-50 text-amber-800', Closed: 'bg-green-50 text-green-800' };

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
  const [conv, setConv] = useState({}); // key -> quantity to CONVERT INTO CONSUMPTION (text)
  const [mode, setMode] = useState('both'); // both = one transaction (Imprest In + Consumption) | in = Imprest In only | cons = Consumption only
  const showIn = mode !== 'cons'; const showCons = mode !== 'in';
  const [hdr, setHdr] = useState({ date: todayIST(), narration: '' });
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [key, setKey] = useState(idemKey());
  const load = () => api.get('/api/imprest/trail', { ref }).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setDone(null); setBack({}); setConv({}); load(); }, [ref]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = data?.position;
  const lines = (cur?.lines || []).filter((l) => l.balance > 0);
  const returned = (l) => (showIn ? Math.min(l.balance, Math.max(0, num(back[l.key]))) : 0);
    const totR = lines.reduce((s, l) => s + returned(l), 0);
  const over = lines.find((l) => num(back[l.key]) > l.balance);
  const cons = (l) => (showCons ? Math.max(0, num(conv[l.key])) : 0);
  const totC = lines.reduce((s, l) => s + cons(l), 0);
  const overAll = lines.find((l) => returned(l) + cons(l) > l.balance + 1e-9);
  const fill = (kind) => { // quick fills: everything back / everything consumed / consumed entered -> the rest comes back
    if (kind === 'allback') { setBack(Object.fromEntries(lines.map((l) => [l.key, String(l.balance)]))); setConv({}); }
    else if (kind === 'allcons') { setConv(Object.fromEntries(lines.map((l) => [l.key, String(l.balance)]))); setBack({}); }
    else setBack(Object.fromEntries(lines.map((l) => [l.key, String(Math.max(0, Math.round((l.balance - cons(l)) * 1e6) / 1e6))])));
  };
  const submit = async (e) => { // one save: Imprest In for what came back + Consumption for what the hospital used
    e.preventDefault(); setErr('');
    if (overAll) { setErr(`${overAll.code}: taken back + consumed cannot be more than the ${overAll.balance} open.`); return; }
    if (!(totR > 0 || totC > 0)) { setErr('Enter the quantity taken back and/or consumed.'); return; }
    setBusy(true);
    try {
      const r = await api.post('/api/imprest/settle', { ref, date: hdr.date, narration: hdr.narration, lines: lines.map((l) => ({ key: l.key, returned: returned(l), consumed: cons(l) })) }, { headers: { 'Idempotency-Key': key } });
      toast.success([r.inDoc && `Imprest In ${r.inDoc}`, r.consumptionDoc && `Consumption ${r.consumptionDoc}`].filter(Boolean).join(' + ') + (r.groupDoc ? ` saved — Group Doc No ${r.groupDoc}` : ' saved'));
      setBack({}); setConv({}); setKey(idemKey()); setData(r.trail); setDone(null); load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (!data && !err) return <Spinner />;
  return (
    <>
      <Link to="/imprest/pending" className="mb-1 inline-block text-sm text-brand-700 hover:underline">← Imprest In Pending</Link>
      <PageHeader title={`Imprest In — ${ref}`} subtitle={cur ? `${cur.hospital} · dispatched ${cur.dispatched}` : ''} />
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {done && <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{done.inDoc ? `Imprest In ${done.inDoc} saved: ${done.summary.returned} taken back. ` : 'Marked as nothing returned. '}{done.summary.toConsume > 0 && <>{done.summary.toConsume} is still open: it can be returned later (Imprest In again) or entered as consumption in <Link className="underline" to="/consumption/pending">Consumption Pending</Link>. </>}<Link className="underline" to="/imprest/pending">Back to Imprest In Pending</Link></div>}
      {cur && lines.length > 0 && !done && (
        <form onSubmit={submit} noValidate>
          <Card title="Taken back and consumed">
            <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" role="radiogroup" aria-label="How to save">
              {[['both', 'One transaction — Imprest In + Consumption'], ['in', 'Imprest In only (take it back)'], ['cons', 'Consumption only']].map(([v, t]) => <label key={v} className="flex items-center gap-1.5"><input type="radio" name="settle-mode" checked={mode === v} onChange={() => setMode(v)} /> {t}</label>)}
              <span className="ml-auto flex flex-wrap gap-2">
                {showIn && <button type="button" className="btn btn-sm" onClick={() => fill('allback')}>Take all back</button>}
                {showCons && <button type="button" className="btn btn-sm" onClick={() => fill('allcons')}>Consume all</button>}
                {mode === 'both' && <button type="button" className="btn btn-sm" onClick={() => fill('rest')} title="After typing the consumed quantities: the remaining open quantity is filled in as taken back">Rest comes back</button>}
              </span>
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead><tr><th className="th">#</th><th className="th">Item</th><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Open</th>{showIn && <th className="th text-right">Taken back (Imprest In qty)</th>}{showCons && <th className="th text-right">Consumed (Consumption qty)</th>}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td className="td text-slate-400">{i + 1}</td><td className="td">{l.code} — {l.name}</td><td className="td">{l.batch}</td><td className="td">{l.expiry}</td>
                      <td className="td text-right tabular-nums">{l.balance}{l.balance !== l.dispatched && <span className="text-xs text-slate-400"> / {l.dispatched}</span>}</td>
                      {showIn && <td className="td text-right"><input className={`input w-24 text-right ${num(back[l.key]) > l.balance ? 'border-red-400' : ''}`} type="number" min="0" max={l.balance} step="any" placeholder="0" value={back[l.key] ?? ''} onChange={(e) => setBack((u) => ({ ...u, [l.key]: e.target.value }))} aria-label={`Returned qty ${l.code}`} /></td>}
                      {showCons && <td className="td text-right"><input className={`input w-24 text-right ${num(back[l.key]) + num(conv[l.key]) > l.balance + 1e-9 ? 'border-red-400' : ''}`} type="number" min="0" max={l.balance} step="any" placeholder="0" aria-label={`Convert into consumption ${l.code}`} value={conv[l.key] ?? ''} onChange={(e) => setConv((u) => ({ ...u, [l.key]: e.target.value }))} /></td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={5}>Total</td>{showIn && <td className="td text-right tabular-nums">{Math.round(totR * 1e6) / 1e6}</td>}{showCons && <td className="td text-right tabular-nums">{Math.round(totC * 1e6) / 1e6}</td>}</tr></tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Enter only the quantity actually taken back (e.g. 50 of 100 now, the rest on another day, or all 100 at once). What the hospital used goes in the last column. One <b>Save</b> posts the Imprest In and the Consumption together; anything left open stays pending. Nothing is consumed automatically.</p>
          </Card>
          <Card title="Date" className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="label" htmlFor="im-date">Date</label><input id="im-date" type="date" className="input" value={hdr.date} onChange={(e) => setHdr({ ...hdr, date: e.target.value })} /></div>
              <div className="lg:col-span-2"><label className="label" htmlFor="im-note">Narration</label><input id="im-note" className="input" value={hdr.narration} onChange={(e) => setHdr({ ...hdr, narration: e.target.value })} /></div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : (mode === 'in' ? `Save Imprest In (${Math.round(totR * 1e6) / 1e6})` : mode === 'cons' ? `Save Consumption (${Math.round(totC * 1e6) / 1e6})` : `Save — Imprest In ${Math.round(totR * 1e6) / 1e6} + Consumption ${Math.round(totC * 1e6) / 1e6}`)}</button></div>
          </Card>
        </form>
      )}
      {cur && !lines.length && !done && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{ref} is closed.</div>}
      {(done?.trail || data) && <Trail data={done?.trail || data} />}
    </>
  );
}
