import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { printPath } from './DocPrint.jsx';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// mode = pending: consumption posted at settlement that still needs its Bill No / Bill Date.  mode = register: billed consumption.
export default function ConsumptionPage() {
  const { mode } = useParams(); const pending = mode === 'pending'; const toast = useToast();
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  const [dlg, setDlg] = useState(null); const [bill, setBill] = useState({ billNo: '', billDate: todayIST() }); const [busy, setBusy] = useState(false); const [derr, setDerr] = useState('');
  const [queue, setQueue] = useState([]); const [ent, setEnt] = useState(null); const [cons, setCons] = useState({}); const [ehdr, setEhdr] = useState({ billNo: '', billDate: todayIST(), narration: '' }); const [eerr, setEerr] = useState('');
  const load = () => Promise.all([api.get('/api/imprest/consumption', { status: pending ? 'pending' : 'billed' }), pending ? api.get('/api/imprest/consumption-queue') : Promise.resolve({ rows: [] })]).then(([r, qd]) => { setRows(r.rows); setQueue(qd.rows); }).catch((e) => setErr(e.message));
  const open = (p) => { setEnt(p); setEerr(''); setEhdr({ billNo: '', billDate: todayIST(), narration: '' }); setCons(Object.fromEntries(p.lines.filter((l) => l.balance > 0).map((l) => [l.key, String(Math.min(l.balance, l.onHand ?? l.balance))]))); };
  const saveCons = async (e) => {
    e.preventDefault(); setEerr('');
    const lines = ent.lines.filter((l) => l.balance > 0).map((l) => ({ key: l.key, consumed: Number(cons[l.key]) || 0 }));
    const over = ent.lines.find((l) => (Number(cons[l.key]) || 0) > l.balance);
    if (over) { setEerr(`${over.code}: consumed cannot be more than the ${over.balance} remaining.`); return; }
    setBusy(true);
    try { const r = await api.post('/api/imprest/consume', { ref: ent.ref, billNo: ehdr.billNo, billDate: ehdr.billDate, narration: ehdr.narration, lines }); toast.success(`Consumption ${r.consumptionDoc} saved (${r.consumed})`); setEnt(null); load(); } catch (x) { setEerr(x.message); } finally { setBusy(false); }
  };
  useEffect(() => { setRows(null); setErr(''); load(); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return (rows || []).filter((r) => !n || `${r.no} ${r.ref} ${r.hospital} ${r.items.join(' ')} ${r.billNo}`.toLowerCase().includes(n)); }, [rows, q]);
  const save = async (e) => {
    e.preventDefault(); setDerr('');
    if (!bill.billNo.trim()) { setDerr('Bill No is required.'); return; }
    setBusy(true);
    try { await api.post('/api/imprest/bill', { doc: dlg.no, billNo: bill.billNo, billDate: bill.billDate }); toast.success(`Bill updated for ${dlg.no}`); setDlg(null); load(); } catch (x) { setDerr(x.message); } finally { setBusy(false); }
  };
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title={pending ? 'Consumption Pending' : 'Consumption Register'} subtitle={pending ? 'Enter the consumption for imprest that was taken back (remaining quantity), then update the bill to move it to the Consumption Register.' : 'Consumption with its bill updated.'} />
      {pending && (
        <Card title="Awaiting consumption entry" className="mb-4">
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead><tr><th className="th">Imprest No.</th><th className="th">Date</th><th className="th">Hospital</th><th className="th text-right">Dispatched</th><th className="th text-right">Taken back</th><th className="th text-right">To consume</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {!queue.length && <tr><td className="td text-slate-500" colSpan={7}>No imprest is waiting for a consumption entry.</td></tr>}
                {queue.map((p) => <tr key={p.ref}><td className="td font-medium">{p.ref}</td><td className="td">{p.date}</td><td className="td">{p.hospital}</td><td className="td text-right tabular-nums">{p.dispatched}</td><td className="td text-right tabular-nums">{p.returned}</td><td className="td text-right tabular-nums font-semibold">{p.balance}</td><td className="td text-right"><button className="btn btn-sm btn-primary" onClick={() => open(p)}>Enter consumption</button></td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card title={pending ? 'Awaiting bill' : undefined}>
        <div className="mb-3 max-w-xs"><input className="input" placeholder="Search document, hospital, item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr><th className="th">Consumption</th><th className="th">Date</th><th className="th">Hospital</th><th className="th">Imprest Out</th><th className="th">Items</th><th className="th text-right">Qty</th>{!pending && <><th className="th">Bill No</th><th className="th">Bill Date</th></>}<th className="th">By</th>{pending && <th className="th" />}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td className="td text-slate-500" colSpan={10}>{pending ? 'Nothing is waiting for a bill.' : 'No billed consumption yet.'}</td></tr>}
              {shown.map((r) => (
                <tr key={r.no}>
                  <td className="td font-medium"><Link className="text-brand-700 hover:underline" to={printPath('material-consumption', r.no)} title="Open / print document">{r.no}</Link></td><td className="td">{r.date}</td><td className="td">{r.hospital}</td><td className="td">{r.ref}</td>
                  <td className="td">{r.items.map((x) => <div key={x}>{x}</div>)}</td><td className="td text-right tabular-nums">{r.qty}</td>
                  {!pending && <><td className="td">{r.billNo}</td><td className="td">{r.billDate}</td></>}<td className="td">{r.by}</td>
                  {pending && <td className="td text-right"><button className="btn btn-sm btn-primary" onClick={() => { setDlg(r); setBill({ billNo: '', billDate: todayIST() }); setDerr(''); }}>Update bill</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {ent && (
        <Modal title={`Enter consumption — ${ent.ref}`} onClose={() => setEnt(null)}>
          <form onSubmit={saveCons} noValidate>
            {eerr && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{eerr}</div>}
            <p className="mb-2 text-sm text-slate-600">{ent.hospital}. Enter the quantity actually consumed per item.</p>
            <table className="min-w-full divide-y divide-slate-200 text-sm"><thead><tr><th className="th">Item</th><th className="th">Batch</th><th className="th text-right">Remaining</th><th className="th text-right">At hospital now</th><th className="th text-right">Consumed qty</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{ent.lines.filter((l) => l.balance > 0).map((l) => <tr key={l.key}><td className="td">{l.code} — {l.name}</td><td className="td">{l.batch}</td><td className="td text-right tabular-nums">{l.balance}</td><td className={`td text-right tabular-nums ${l.onHand < l.balance ? 'font-semibold text-red-600' : ''}`}>{l.onHand}</td><td className="td text-right"><input className="input w-24 text-right" type="number" min="0" max={Math.min(l.balance, l.onHand)} step="any" value={cons[l.key] ?? ''} onChange={(e) => setCons((u) => ({ ...u, [l.key]: e.target.value }))} aria-label={`Consumed qty ${l.code}`} /></td></tr>)}</tbody></table>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div><label className="label" htmlFor="ce-no">Bill No (optional)</label><input id="ce-no" className="input" value={ehdr.billNo} onChange={(e) => setEhdr({ ...ehdr, billNo: e.target.value })} /></div>
              <div><label className="label" htmlFor="ce-date">Bill Date</label><input id="ce-date" type="date" className="input" value={ehdr.billDate} onChange={(e) => setEhdr({ ...ehdr, billDate: e.target.value })} /></div>
              <div><label className="label" htmlFor="ce-n">Narration</label><input id="ce-n" className="input" value={ehdr.narration} onChange={(e) => setEhdr({ ...ehdr, narration: e.target.value })} /></div>
            </div>
            {ent.lines.some((l) => l.balance > 0 && l.onHand < l.balance) && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Some stock shown in red is no longer at the hospital - it was already consumed or moved by another document that is not linked to {ent.ref}. Only the quantity actually at the hospital can be consumed here.</p>}
            {ent.lines.filter((l) => l.movements?.length).map((l) => (
              <div key={l.key} className="mt-2 text-xs text-slate-600"><b>Stock movements at {ent.hospital} — {l.code}, batch {l.batch}:</b>
                <table className="mt-1 min-w-full text-xs"><tbody>{l.movements.map((m, i) => <tr key={i}><td className="pr-3">{m.date}</td><td className="pr-3">{m.type}</td><td className="pr-3">{m.doc}</td><td className="text-right tabular-nums">{m.qty > 0 ? `+${m.qty}` : m.qty}</td></tr>)}</tbody></table>
              </div>
            ))}
            <p className="mt-2 text-xs text-slate-500">Without a Bill No the consumption stays under "Awaiting bill" until you update the bill.</p>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setEnt(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save consumption'}</button></div>
          </form>
        </Modal>
      )}
      {dlg && (
        <Modal title={`Update bill — ${dlg.no}`} onClose={() => setDlg(null)}>
          <form onSubmit={save} noValidate>
            {derr && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{derr}</div>}
            <p className="mb-3 text-sm text-slate-600">{dlg.hospital} · {dlg.items.join('; ')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="cb-no">Bill No <span className="text-red-600">*</span></label><input id="cb-no" className="input" value={bill.billNo} onChange={(e) => setBill({ ...bill, billNo: e.target.value })} autoFocus /></div>
              <div><label className="label" htmlFor="cb-date">Bill Date</label><input id="cb-date" type="date" className="input" value={bill.billDate} onChange={(e) => setBill({ ...bill, billDate: e.target.value })} /></div>
            </div>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setDlg(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save bill'}</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
