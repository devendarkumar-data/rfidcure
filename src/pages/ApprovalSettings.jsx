import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';

const ITEMS = [
  { key: 'Require Indent Approval', title: 'Purchase Indent approval', on: 'Submitted indents wait for an Approver / Admin to approve, reject or return them.', off: 'A submitted indent is approved as requested - no approval step.' },
  { key: 'Require PO Authorization', title: 'PO authorization', on: 'Submitted POs wait for an Approver / Admin to authorise them.', off: 'A submitted PO is authorised straight away - no authorization step.' },
];
const isOn = (v) => !/^(no|false|0|off)$/i.test(String(v ?? '').trim()); // blank = required

// Administration > Approval: switch the indent approval and PO authorization steps on or off.
export default function ApprovalSettings({ table }) {
  const toast = useToast(); const canEdit = !!table?.actions?.includes('edit');
  const [vals, setVals] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/api/t/configuration').then((r) => setVals(r.values || {})).catch((e) => setErr(e.message)); }, []);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!vals) return <Spinner />;
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await api.put('/api/t/configuration', { values: Object.fromEntries(ITEMS.map((i) => [i.key, isOn(vals[i.key]) ? 'Yes' : 'No'])) }); setVals((v) => ({ ...v, ...r.values })); toast.success('Approval settings saved'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Approval" subtitle="Decide whether purchase indents and POs need an approval step. Approvers and Admins still see everything either way." />
      <Card>
        <div className="divide-y divide-slate-100">
          {ITEMS.map((i) => (
            <label key={i.key} className="flex items-start gap-3 py-3">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={isOn(vals[i.key])} disabled={!canEdit} onChange={(e) => setVals((v) => ({ ...v, [i.key]: e.target.checked ? 'Yes' : 'No' }))} />
              <span><span className="block font-medium text-slate-800">Require {i.title}</span><span className="block text-sm text-slate-600">{isOn(vals[i.key]) ? i.on : i.off}</span></span>
            </label>
          ))}
        </div>
        {canEdit && <div className="mt-3 flex justify-end"><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>}
      </Card>
    </>
  );
}
