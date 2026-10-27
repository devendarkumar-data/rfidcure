import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Spinner from '../components/Spinner.jsx';

export default function Login() {
  const { user, login, loading } = useAuth();
  const nav = useNavigate(); const loc = useLocation();
  const [id, setId] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (loading) return <Spinner className="h-full" />;
  if (user) return <Navigate to="/" replace />;
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login(id.trim(), pw); nav(loc.state?.from || '/', { replace: true }); } catch (x) { setErr(x.message); setPw(''); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-800 to-brand-600 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" aria-label="Sign in">
        <h1 className="mb-1 text-center text-lg font-semibold">Sign in to Cure ERP</h1>
        <p className="mb-5 text-center text-sm text-slate-500">Use the User ID and password issued by your administrator.</p>
        {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        <label className="label" htmlFor="uid">User ID</label>
        <input id="uid" className="input mb-3" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoFocus required />
        <label className="label" htmlFor="pwd">Password</label>
        <input id="pwd" className="input mb-5" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        <button className="btn btn-primary w-full !py-2" disabled={busy || !id || !pw}>{busy ? 'Signing in…' : 'Sign In'}</button>
        <p className="mt-4 text-center text-xs text-slate-400">Forgot your password? Ask an administrator to reset it.</p>
      </form>
    </div>
  );
}
