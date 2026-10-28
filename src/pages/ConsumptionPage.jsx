import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
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
  const load = () => api.get('/api/imprest/consumption', { status: pending ? 'pending' : 'billed' }).then((r) => setRows(r.rows)).catch((e) => setErr(e.message));
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
      <PageHeader title={pending ? 'Consumption Pending' : 'Consumption Register'} subtitle={pending ? 'Consumption from imprest settlement whose bill has not been updated yet. Update the bill to move it to the Consumption Register.' : 'Consumption with its bill updated.'} />
      <Card>
        <div className="mb-3 max-w-xs"><input className="input" placeholder="Search document, hospital, item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr><th className="th">Consumption</th><th className="th">Date</th><th className="th">Hospital</th><th className="th">Imprest Out</th><th className="th">Items</th><th className="th text-right">Qty</th>{!pending && <><th className="th">Bill No</th><th className="th">Bill Date</th></>}<th className="th">By</th>{pending && <th className="th" />}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td className="td text-slate-500" colSpan={10}>{pending ? 'Nothing is waiting for a bill.' : 'No billed consumption yet.'}</td></tr>}
              {shown.map((r) => (
                <tr key={r.no}>
                  <td className="td font-medium">{r.no}</td><td className="td">{r.date}</td><td className="td">{r.hospital}</td><td className="td">{r.ref}</td>
                  <td className="td">{r.items.map((x) => <div key={x}>{x}</div>)}</td><td className="td text-right tabular-nums">{r.qty}</td>
                  {!pending && <><td className="td">{r.billNo}</td><td className="td">{r.billDate}</td></>}<td className="td">{r.by}</td>
                  {pending && <td className="td text-right"><button className="btn btn-sm btn-primary" onClick={() => { setDlg(r); setBill({ billNo: '', billDate: todayIST() }); setDerr(''); }}>Update bill</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
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
