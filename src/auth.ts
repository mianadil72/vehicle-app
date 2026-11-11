import { createContext, useContext } from 'react';
import { ApiError } from './api';
import type { User } from './types';

// Signed-in state. The session lives in an HttpOnly cookie set by the API, so the client only ever
// asks the server who is signed in (`/api/auth/me`); it never sees or stores the token.

export interface Auth {
  /** `loading` until the first `/api/auth/me` check finishes. */
  status: 'loading' | 'ready';
  user: User | null;
  /** True only for signed-in admins: the only users who may add, edit or delete vehicles. */
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Re-check the session, e.g. after the API answers 401 because it expired. */
  refresh: () => void;
}

export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}

export async function fetchCurrentUser(signal?: AbortSignal): Promise<User | null> {
  const res = await fetch('/api/auth/me', { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return ((await res.json()) as { user: User | null }).user;
}

export async function postLogin(username: string, password: string): Promise<User> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = (await res.json().catch(() => ({}))) as { user?: User; error?: string };
  if (!res.ok || !data.user) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data.user;
}

export async function postLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

/** Message for an API error on a change the user tried to make, when it's an auth problem. */
export function authErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 401) return 'Your session has ended. Sign in again as an admin to make changes.';
  if (err.status === 403) return 'Only admins can make changes.';
  return null;
}
