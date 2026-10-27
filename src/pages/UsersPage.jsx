import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import DataTable from '../components/DataTable.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';

const NO_WH_ROLES = ['Super Admin', 'Admin', 'Finance Team', 'Auditor'];

function UserForm({ initial, roles, warehouses, onSave, onCancel }) {
  const editing = !!initial;
  const [v, setV] = useState(() => ({ 'User ID': '', 'User Name': '', Role: roles[0] || '', Status: 'Active', Email: '', ...initial }));
  const [sel, setSel] = useState(() => new Set(String(initial?.Branch || '').split(/[,;/|\s]+/).filter(Boolean).map((s) => s.toUpperCase())));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k, x) => setV((s) => ({ ...s, [k]: x }));
  const toggle = (w) => setSel((s) => { const n = new Set(s); if (n.has(w.toUpperCase())) n.delete(w.toUpperCase()); else n.add(w.toUpperCase()); return n; });
  const needsWh = !NO_WH_ROLES.includes(v.Role);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await onSave({ ...v, Branch: [...sel].join(', ') }); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-label="User">
      {err && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{err}</div>}
      <div><label className="label" htmlFor="u-id">User ID *</label><input id="u-id" className="input" value={v['User ID']} disabled={editing} onChange={(e) => set('User ID', e.target.value)} required pattern="[A-Za-z0-9._\-]{3,40}" title="3-40 letters, numbers, dot, dash or underscore" /></div>
      <div><label className="label" htmlFor="u-name">User Name *</label><input id="u-name" className="input" value={v['User Name']} onChange={(e) => set('User Name', e.target.value)} required maxLength={80} /></div>
      <div><label className="label" htmlFor="u-role">Role *</label><select id="u-role" className="input" value={v.Role} onChange={(e) => set('Role', e.target.value)}>{roles.map((r) => <option key={r}>{r}</option>)}</select></div>
      <div><label className="label" htmlFor="u-status">Status</label><select id="u-status" className="input" value={v.Status} onChange={(e) => set('Status', e.target.value)}><option>Active</option><option>Inactive</option></select></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="u-email">Email (optional)</label><input id="u-email" type="email" className="input" value={v.Email} onChange={(e) => set('Email', e.target.value)} /></div>
      <fieldset className="sm:col-span-2">
        <legend className="label">Assigned warehouses {needsWh && '*'}</legend>
        {warehouses.length ? (
          <div className="flex flex-wrap gap-2">{warehouses.map((w) => (
            <label key={w} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${sel.has(w.toUpperCase()) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300'}`}>
              <input type="checkbox" checked={sel.has(w.toUpperCase())} onChange={() => toggle(w)} /> {w}
            </label>))}</div>
        ) : <p className="text-sm text-slate-500">No warehouses found yet.</p>}
        <p className="mt-1 text-xs text-slate-500">{needsWh ? 'This role only sees data for the ticked warehouses.' : 'This role has access to all warehouses; the selection is ignored.'}</p>
      </fieldset>
      {!editing && <p className="text-xs text-slate-500 sm:col-span-2">A one-time temporary password is generated; the user must change it at first sign-in.</p>}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</button></div>
    </form>
  );
}

function SecretModal({ title, id, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(password); setCopied(true); } catch { /* clipboard blocked */ } };
  return (
    <Modal title={title} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p className="text-sm">Temporary password for <b>{id}</b>. It is shown <b>only once</b> — hand it to the user securely. They must change it at first sign-in.</p>
      <div className="mt-3 flex items-center gap-2"><code className="flex-1 select-all rounded bg-slate-100 px-3 py-2 text-base font-semibold tracking-wide">{password}</code><button className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button></div>
    </Modal>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth(); const toast = useToast();
  const [info, setInfo] = useState(null); const [err, setErr] = useState(''); const [dlg, setDlg] = useState(null); const [refresh, setRefresh] = useState(0);
  useEffect(() => { api.get('/api/admin/users').then(setInfo).catch((e) => setErr(e.message)); }, [refresh]);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!info) return <Spinner />;
  const roles = me.role === 'super_admin' ? info.roles : info.roles.filter((r) => r !== 'Super Admin');

  const rows = info.rows;
  return (
    <>
      <PageHeader title="User Management" subtitle="Create users, assign roles and warehouses, deactivate leavers and reset passwords." actions={<button className="btn btn-primary" onClick={() => setDlg({ type: 'new' })}><Icon name="plus" className="h-4 w-4" /> New user</button>} />
      <LocalTable rows={rows} onEdit={(r) => setDlg({ type: 'edit', row: r })} onReset={(r) => setDlg({ type: 'reset', row: r })} />
      {dlg?.type === 'new' && <Modal title="New user" onClose={() => setDlg(null)}><UserForm roles={roles} warehouses={info.warehouses} onCancel={() => setDlg(null)}
        onSave={async (v) => { const r = await api.post('/api/admin/users', v); toast.success(`User ${r.id} created`); setDlg({ type: 'secret', title: 'User created', id: r.id, password: r.temporaryPassword }); reload(); }} /></Modal>}
      {dlg?.type === 'edit' && <Modal title={`Edit ${dlg.row['User ID']}`} onClose={() => setDlg(null)}><UserForm initial={dlg.row} roles={roles.includes(dlg.row.Role) ? roles : [dlg.row.Role, ...roles]} warehouses={info.warehouses} onCancel={() => setDlg(null)}
        onSave={async (v) => { await api.put(`/api/admin/users?id=${encodeURIComponent(dlg.row['User ID'])}`, v); toast.success('User updated'); setDlg(null); reload(); }} /></Modal>}
      {dlg?.type === 'reset' && <ConfirmDialog title="Reset password" confirmLabel="Reset password" message={`Reset the password for ${dlg.row['User ID']}? Their current password stops working immediately and all their sessions are signed out.`} onCancel={() => setDlg(null)}
        onConfirm={async () => { try { const r = await api.post(`/api/admin/users/reset?id=${encodeURIComponent(dlg.row['User ID'])}`); setDlg({ type: 'secret', title: 'Password reset', id: r.id, password: r.temporaryPassword }); reload(); } catch (e) { toast.error(e.message); setDlg(null); } }} />}
      {dlg?.type === 'secret' && <SecretModal title={dlg.title} id={dlg.id} password={dlg.password} onClose={() => setDlg(null)} />}
    </>
  );
}

// The user list is small and comes in one response, so it is searched/sorted in the browser.
function LocalTable({ rows, onEdit, onReset }) {
  const [q, setQ] = useState('');
  const list = rows.filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 p-3"><input className="input sm:max-w-sm" placeholder="Search users…" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead><tr>{['User ID', 'User Name', 'Role', 'Branch', 'Status', 'Last Login', ''].map((h) => <th key={h || 'a'} className="th">{h || 'Actions'}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((r) => (
              <tr key={r['User ID']} className="hover:bg-slate-50">
                <td className="td font-medium">{r['User ID']}</td><td className="td">{r['User Name']}</td><td className="td">{r.Role}</td>
                <td className="td">{r.Branch || <span className="text-slate-400">all / n.a.</span>}</td>
                <td className="td"><StatusBadge value={r.Locked ? 'Locked' : r.Status} /></td>
                <td className="td whitespace-nowrap">{r['Last Login'] || <span className="text-slate-300">never</span>}</td>
                <td className="td whitespace-nowrap text-right"><button className="btn btn-sm mr-1" onClick={() => onEdit(r)}>Edit</button><button className="btn btn-sm" onClick={() => onReset(r)}>Reset password</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="p-8 text-center text-sm text-slate-500">No users found.</p>}
      </div>
    </div>
  );
}
