import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import { buildNav } from '../nav.js';

const isActive = (loc, to) => {
  const [p, s] = to.split('?');
  if (p === '/' ) return loc.pathname === '/';
  if (loc.pathname !== p) return false;
  return s ? loc.search === `?${s}` || decodeURIComponent(loc.search) === `?${decodeURIComponent(s)}` : true;
};

function scopeBadge(user) {
  const s = user.scope;
  if (s.mode === 'all') return 'All warehouses';
  if (s.mode === 'all-readonly') return 'All warehouses · view only';
  return s.warehouses.length ? s.warehouses.join(', ') : 'No warehouse assigned';
}

function NavList({ sections, loc, onNavigate, collapsed }) {
  const [open, setOpen] = useState({});
  useEffect(() => {
    const cur = sections.find((s) => s.items.some((i) => isActive(loc, i.to)));
    if (cur) setOpen((o) => (o[cur.key] ? o : { ...o, [cur.key]: true }));
  }, [loc.pathname, loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = 'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition';
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="Main">
      {sections.map((s) => {
        if (!s.items.length) {
          const act = isActive(loc, s.to);
          return <Link key={s.key} to={s.to} onClick={onNavigate} title={s.label} className={`${link} ${act ? 'bg-white/15 font-semibold text-white' : 'text-brand-100 hover:bg-white/10'}`}><Icon name={s.icon} className="h-5 w-5 shrink-0" />{!collapsed && s.label}</Link>;
        }
        const isOpen = !!open[s.key] && !collapsed;
        const has = s.items.some((i) => isActive(loc, i.to));
        return (
          <div key={s.key}>
            <button type="button" title={s.label} aria-expanded={isOpen} onClick={() => setOpen({ ...open, [s.key]: !open[s.key] })}
              className={`${link} w-full ${has ? 'text-white' : 'text-brand-100 hover:bg-white/10'}`}>
              <Icon name={s.icon} className="h-5 w-5 shrink-0" />
              {!collapsed && <><span className="flex-1 text-left font-medium">{s.label}</span><Icon name="chevron" stroke className={`h-4 w-4 transition ${isOpen ? 'rotate-90' : ''}`} /></>}
            </button>
            {isOpen && (
              <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-white/20 pl-2">
                {s.items.map((i) => (
                  <li key={i.to}><Link to={i.to} onClick={onNavigate} className={`block rounded-md px-2.5 py-1 text-[13px] ${isActive(loc, i.to) ? 'bg-white text-brand-800 font-semibold' : 'text-brand-100 hover:bg-white/10'}`}>{i.label}</Link></li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function AppLayout() {
  const { meta, user, logout } = useAuth();
  const loc = useLocation();
  const sections = useMemo(() => buildNav(meta), [meta]);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('nav-collapsed') === '1'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setDrawer(false); setMenu(false); }, [loc.pathname, loc.search]);
  const toggle = () => { const n = !collapsed; setCollapsed(n); try { localStorage.setItem('nav-collapsed', n ? '1' : '0'); } catch { /* private mode */ } };

  const brand = (compact) => (
    <Link to="/" className="flex items-center gap-2 px-3 py-3">
      <span className="text-lg font-semibold tracking-tight text-white">{compact ? 'C' : 'Cure ERP'}</span>
    </Link>
  );

  return (
    <div className="flex h-full">
      <aside className={`hidden shrink-0 flex-col bg-brand-800 transition-all lg:flex ${collapsed ? 'w-16' : 'w-64'}`}>
        <div className="flex items-center justify-between">{collapsed ? brand(true) : brand(false)}</div>
        <NavList sections={sections} loc={loc} collapsed={collapsed} />
        <button className="m-2 rounded-md px-2 py-1.5 text-xs text-brand-100 hover:bg-white/10" onClick={toggle}>{collapsed ? '»' : '« Collapse'}</button>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-800 shadow-xl">
            <div className="flex items-center justify-between pr-2">{brand(false)}<button className="rounded p-2 text-white" onClick={() => setDrawer(false)} aria-label="Close menu"><Icon name="close" /></button></div>
            <NavList sections={sections} loc={loc} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 sm:px-5">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <span className="truncate text-sm font-semibold text-brand-800 lg:hidden">Cure Surgical ERP</span>
          <div className="relative ml-auto">
            <button className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-slate-100" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">{(user.name || user.id).slice(0, 1).toUpperCase()}</span>
              <span className="hidden leading-tight sm:block"><span className="block text-sm font-medium">{user.name}</span><span className="block text-xs text-slate-500">{user.roleLabel}</span></span>
            </button>
            {menu && (
              <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-lg" role="menu">
                <div className="border-b border-slate-100 px-3 py-2 text-sm"><div className="font-medium">{user.name} <span className="text-slate-400">({user.id})</span></div><div className="text-xs text-slate-500">{user.roleLabel}</div>
                  <span className="mt-1 inline-block rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{scopeBadge(user)}</span></div>
                <Link to="/change-password" role="menuitem" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><Icon name="key" className="h-4 w-4" /> Change password</Link>
                <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={logout}><Icon name="logout" className="h-4 w-4" /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <div className="hidden items-center justify-end gap-2 bg-slate-50 px-5 py-1 text-xs text-slate-500 sm:flex">
          <span>Warehouse access:</span><span className="rounded bg-brand-50 px-2 py-0.5 text-brand-700">{scopeBadge(user)}</span>
        </div>
        <main className="flex-1 overflow-y-auto p-3 sm:p-5"><Outlet /></main>
      </div>
    </div>
  );
}
