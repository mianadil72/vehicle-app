import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext, fetchCurrentUser, postLogin, postLogout, type Auth } from '../auth';
import type { User } from '../types';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Auth['status']>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [check, setCheck] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal).then(
      (u) => {
        setUser(u);
        setStatus('ready');
      },
      () => {
        // API unreachable: treat as signed out; vehicle pages show their own connection errors.
        if (controller.signal.aborted) return;
        setUser(null);
        setStatus('ready');
      },
    );
    return () => controller.abort();
  }, [check]);

  const login = useCallback(async (username: string, password: string) => {
    const u = await postLogin(username, password);
    setUser(u);
    setStatus('ready');
    return u;
  }, []);

  const logout = useCallback(async () => {
    await postLogout().catch(() => {});
    setUser(null);
  }, []);

  const refresh = useCallback(() => setCheck((n) => n + 1), []);

  const value = useMemo<Auth>(
    () => ({ status, user, isAdmin: user?.role === 'admin', login, logout, refresh }),
    [status, user, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
