import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { listDrafts, removeDraft } from '../drafts.js';
import { fmtDate } from '../dateOptions.js';

// Forms that were filled in but never saved (auto-saved in this browser): resume or discard.
export default function Drafts() {
  const { user } = useAuth(); const [rows, setRows] = useState(() => listDrafts(user.id));
  return (
    <>
      <PageHeader title="Unsaved drafts" subtitle="Anything you typed but did not save is kept here automatically on this computer. Resume it, or discard it." />
      <Card>
        {!rows.length ? <p className="text-sm text-slate-500">No unsaved drafts.</p> : (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr><th className="th">Form</th><th className="th">Last auto-saved</th><th className="th text-right">Lines</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="td font-medium">{d.title}</td>
                  <td className="td">{fmtDate(d.savedAt)} {new Date(d.savedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="td text-right tabular-nums">{d.data?.lines?.length || 0}</td>
                  <td className="td text-right"><Link className="btn btn-sm btn-primary" to={d.path}>Resume</Link> <button type="button" className="btn btn-sm" onClick={() => { removeDraft(user.id, d.id); setRows(listDrafts(user.id)); }}>Discard</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
