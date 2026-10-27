import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';

const TONE = { None: 'bg-slate-100 text-slate-500', View: 'bg-amber-50 text-amber-800', Edit: 'bg-green-50 text-green-800' };

export default function AccessControlPage() {
  const toast = useToast();
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState(''); const [busy, setBusy] = useState('');
  const load = () => api.get('/api/admin/access').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const groups = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase(); const m = new Map();
    for (const r of data.rows) { if (needle && !r.tab.toLowerCase().includes(needle) && !r.module.toLowerCase().includes(needle)) continue; if (!m.has(r.module)) m.set(r.module, []); m.get(r.module).push(r); }
    return [...m.entries()];
  }, [data, q]);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!data) return <Spinner />;
  const set = async (tab, role, level) => {
    setBusy(`${tab}|${role.key}`);
    try {
      await api.put('/api/admin/access', { tab, role: role.key, level });
      setData((d) => ({ ...d, rows: d.rows.map((r) => (r.tab !== tab ? r : { ...r, levels: { ...r.levels, [role.key]: { level: level || r.levels[role.key].level, explicit: !!level } } }) ) }));
      if (!level) load();
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <>
      <PageHeader title="Access Control" subtitle="Choose what each group can do on every tab: None (hidden), View, or Edit (create and change). Blank/Default follows the standard role rules. Super Admin always has full access." />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
          <input className="input sm:max-w-xs" placeholder="Search tabs…" aria-label="Search tabs" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-slate-500">Cells in <b>bold with a dot</b> were set by an administrator; the others are the default.</span>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20 bg-white">
              <tr><th className="sticky left-0 z-30 min-w-[16rem] border-b border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Tab</th>
                {data.roles.map((r) => <th key={r.key} className="min-w-[8.5rem] border-b border-slate-200 bg-white px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{r.label}</th>)}</tr>
            </thead>
            <tbody>
              {groups.map(([mod, rows]) => (
                <GroupRows key={mod} mod={mod} rows={rows} roles={data.roles} levels={data.levels} busy={busy} onSet={set} />
              ))}
            </tbody>
          </table>
          {!groups.length && <p className="p-8 text-center text-sm text-slate-500">No tabs match.</p>}
        </div>
      </div>
    </>
  );
}

function GroupRows({ mod, rows, roles, levels, busy, onSet }) {
  return (
    <>
      <tr><td colSpan={roles.length + 1} className="sticky left-0 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{mod}</td></tr>
      {rows.map((r) => (
        <tr key={r.tab} className="hover:bg-slate-50">
          <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 font-medium">{r.tab.replace(/\s{2,}/g, ' ')}</td>
          {roles.map((role) => {
            const c = r.levels[role.key]; const isBusy = busy === `${r.tab}|${role.key}`;
            return (
              <td key={role.key} className="border-b border-slate-100 px-2 py-1">
                <select aria-label={`${r.tab} — ${role.label}`} disabled={role.locked || isBusy} value={c.explicit ? c.level : ''} onChange={(e) => onSet(r.tab, role, e.target.value)}
                  className={`w-full rounded border border-transparent px-1.5 py-1 text-xs ${TONE[c.level]} ${c.explicit ? 'font-bold' : ''} ${role.locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-slate-300'}`}>
                  <option value="">{`Default (${c.level})`}</option>
                  {levels.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
