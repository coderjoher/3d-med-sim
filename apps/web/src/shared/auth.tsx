import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LoginResponse, Role, User } from '@medsim/core';
import { api, getToken, setToken } from './api';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login(username: string, password: string): Promise<User>;
  logout(): void;
  hasRole(...roles: Role[]): boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api<User>('/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<LoginResponse>('/auth/login', { method: 'POST', json: { username, password } });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);
  const hasRole = useCallback(
    (...roles: Role[]) => !!user && user.roles.some((r) => roles.includes(r) || r === 'superadmin'),
    [user],
  );

  return <Ctx.Provider value={{ user, loading, login, logout, hasRole }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
