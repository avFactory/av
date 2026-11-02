import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { setDecimals } from './format.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [me, setMe] = useState(undefined);
  const [lookups, setLookups] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const m = await api.get('/auth/me');
      setMe(m);
      const l = await api.get('/lookups').catch(() => null);
      if (l?.settings?.weight_decimals) setDecimals(l.settings.weight_decimals);
      setLookups(l);
    } catch { setMe(null); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const f = () => setMe(null);
    window.addEventListener('auth:expired', f);
    return () => window.removeEventListener('auth:expired', f);
  }, []);
  const logout = async () => { await api.post('/auth/logout').catch(() => {}); setMe(null); window.location.href = '/login'; };
  const can = (...p) => !!me && p.some((x) => me.perms.includes(x));
  return <AuthCtx.Provider value={{ me, lookups, refresh, logout, can }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

export function homeFor(me) {
  if (!me) return '/login';
  if (me.role_code === 'customer') return '/store';
  if (me.perms.includes('worker.self')) return '/w';
  if (me.perms.includes('custody.issue') || me.perms.includes('custody.receive')) return '/sup';
  if (me.perms.includes('dashboard.view')) return '/admin';
  if (me.perms.includes('inventory.view')) return '/admin/inventory';
  return '/orders';
}
