import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try { setMeta(await api.get('/api/auth/me', null, { quiet401: true })); } catch { setMeta(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    setUnauthorizedHandler(() => { setMeta(null); navigate('/login', { replace: true }); });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const login = useCallback(async (userId, password) => {
    const m = await api.post('/api/auth/login', { userId, password }, { quiet401: true });
    setMeta(m); return m;
  }, []);
  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } catch { /* already gone */ }
    setMeta(null); navigate('/login', { replace: true });
  }, [navigate]);
  const changePassword = useCallback(async (oldPassword, newPassword) => {
    await api.post('/api/auth/change-password', { oldPassword, newPassword });
    await refresh();
  }, [refresh]);

  const tables = useMemo(() => Object.fromEntries((meta?.modules || []).flatMap((m) => m.tables.map((t) => [t.slug, t]))), [meta]);
  const value = useMemo(() => ({ meta, user: meta?.user, features: meta?.features || {}, tables, loading, login, logout, changePassword, refresh }),
    [meta, tables, loading, login, logout, changePassword, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
