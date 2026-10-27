import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';

export default function ChangePassword({ forced = false }) {
  const { changePassword, logout } = useAuth();
  const toast = useToast(); const nav = useNavigate();
  const [o, setO] = useState(''); const [n, setN] = useState(''); const [c, setC] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (n !== c) return setErr('New password and confirmation do not match');
    setBusy(true);
    try { await changePassword(o, n); toast.success('Password changed'); nav('/', { replace: true }); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const form = (
    <form onSubmit={submit} className="mx-auto w-full max-w-md" aria-label="Change password">
      {forced && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">You must set a new password before you can continue.</p>}
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <label className="label" htmlFor="op">Current password</label><input id="op" type="password" className="input mb-3" value={o} onChange={(e) => setO(e.target.value)} autoComplete="current-password" required />
      <label className="label" htmlFor="np">New password</label><input id="np" type="password" className="input mb-1" value={n} onChange={(e) => setN(e.target.value)} autoComplete="new-password" required />
      <p className="mb-3 text-xs text-slate-500">At least 8 characters, with letters and numbers.</p>
      <label className="label" htmlFor="cp">Confirm new password</label><input id="cp" type="password" className="input mb-4" value={c} onChange={(e) => setC(e.target.value)} autoComplete="new-password" required />
      <div className="flex gap-2"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>{forced && <button type="button" className="btn" onClick={logout}>Sign out</button>}</div>
    </form>
  );
  if (forced) return <div className="flex min-h-full items-center justify-center bg-slate-100 p-4"><div className="card w-full max-w-md p-6"><h1 className="mb-3 text-lg font-semibold">Change your password</h1>{form}</div></div>;
  return (<><PageHeader title="Change password" /><Card>{form}</Card></>);
}
