import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';
import RecordForm from './RecordForm.jsx';

// The creator of an Imprest Out may change the items / quantities for one hour (until an Imprest In or Consumption is raised).
const KEEP = new Set(['Surgery', 'Doctor', 'Sales Executive', 'Business Head', 'OT Name', 'Narration / Notes', 'Location']);
export default function ImprestOutEdit() {
  const { id: raw } = useParams(); const id = decodeURIComponent(raw); const nav = useNavigate(); const toast = useToast();
  const { tables } = useAuth(); const table = tables['imprest-out-new'];
  const [data, setData] = useState(null); const [st, setSt] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    Promise.all([api.get('/api/imprest/out/editable', { id }), api.get('/api/t/imprest-out-new/record', { id })]).then(([s, r]) => { setSt(s); setData(r); }).catch((e) => setErr(e.message));
  }, [id]);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!table || !data || !st) return <Spinner />;
  if (!st.editable) return <Card><p className="text-sm">{st.reason}</p></Card>;
  const view = { ...table, fields: table.fields.map((f) => (KEEP.has(f.name) ? f : { ...f, readonly: true })) }; // the hospital, date and shipping stay as created
  const save = async (payload) => {
    const header = Object.fromEntries(Object.entries(payload.header || {}).filter(([k]) => KEEP.has(k)));
    const r = await api.put(`/api/imprest/out/edit?id=${encodeURIComponent(id)}`, { header, lines: payload.lines });
    toast.success(`${id} updated`); nav('/imprest/register/out'); return r;
  };
  return (
    <>
      <PageHeader title={`Edit Imprest Out ${id}`} subtitle={`You can change the items and quantities until ${new Date(st.until).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. Stock is corrected automatically.`} />
      <Card><RecordForm table={view} mode="edit" initial={{ header: data.record, lines: data.lines }} onSubmit={save} onCancel={() => nav(-1)} submitLabel="Save changes" /></Card>
    </>
  );
}
