import { useEffect, useState } from 'react';
import type { Category, ResetRequest, UserSummary, Vehicle, VehicleComment } from './types';
import type { FieldErrors, VehicleInput } from './validation';

// Inventory is served by the Express API in `server/`, backed by SQL Server.
// In development Vite proxies `/api` to it (see vite.config.ts).

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export function fetchVehicles(
  filter: { category?: Category; exclude?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Vehicle[]> {
  const params = new URLSearchParams();
  if (filter.category) params.set('category', filter.category);
  if (filter.exclude) params.set('exclude', filter.exclude);
  if (filter.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return getJson<Vehicle[]>(`/api/vehicles${qs ? `?${qs}` : ''}`, signal);
}

/** Resolves to `null` when the vehicle doesn't exist. */
export async function fetchVehicle(id: string, signal?: AbortSignal): Promise<Vehicle | null> {
  const res = await fetch(`/api/vehicles/${encodeURIComponent(id)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<Vehicle>;
}

/** An API error response; `fields` holds per-field messages for validation (400) and conflict (409) errors. */
export class ApiError extends Error {
  status: number;
  fields: Partial<Record<string, string>>;
  constructor(status: number, message: string, fields: Partial<Record<string, string>> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

async function send(method: 'POST' | 'PUT' | 'DELETE', url: string, body?: VehicleInput): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldErrors };
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.fields);
  }
  return res;
}

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  return (await send('POST', '/api/vehicles', input)).json() as Promise<Vehicle>;
}

export async function updateVehicle(id: string, input: VehicleInput): Promise<Vehicle> {
  return (await send('PUT', `/api/vehicles/${encodeURIComponent(id)}`, input)).json() as Promise<Vehicle>;
}

export async function deleteVehicle(id: string): Promise<void> {
  await send('DELETE', `/api/vehicles/${encodeURIComponent(id)}`);
}

export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error; retry: () => void }
  | { status: 'ready'; data: T };

/**
 * Loads data whenever `key` changes; pass `null` to skip loading.
 * Results for a stale key are ignored, so the returned state always matches the current key.
 */
export function useRemote<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): Remote<T> {
  const [attempt, setAttempt] = useState(0);
  const requestKey = key === null ? null : `${key}#${attempt}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: Error } | null>(null);

  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => setResult({ key: requestKey, data }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, error: error instanceof Error ? error : new Error(String(error)) });
      },
    );
    return () => controller.abort();
    // `load` is expected to depend only on `key`, so it's intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  if (!result || result.key !== requestKey) return { status: 'loading' };
  if (result.error) return { status: 'error', error: result.error, retry: () => setAttempt((a) => a + 1) };
  return { status: 'ready', data: result.data as T };
}

// --- Comments ----------------------------------------------------------------------------------

export function fetchComments(vehicleId: string, signal?: AbortSignal): Promise<VehicleComment[]> {
  return getJson<VehicleComment[]>(`/api/vehicles/${encodeURIComponent(vehicleId)}/comments`, signal);
}

/** POST a JSON body; resolves to the JSON response (or `{}` for 204 No Content). */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; fields?: Record<string, string> };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.fields);
  return data;
}

export function addComment(vehicleId: string, body: string): Promise<VehicleComment> {
  return postJson<VehicleComment>(`/api/vehicles/${encodeURIComponent(vehicleId)}/comments`, { body });
}

export async function deleteComment(vehicleId: string, commentId: string): Promise<void> {
  await send('DELETE', `/api/vehicles/${encodeURIComponent(vehicleId)}/comments/${encodeURIComponent(commentId)}`);
}

// --- Passwords (admins) ------------------------------------------------------------------------

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  await postJson('/api/auth/password', { currentPassword, newPassword });
}

export function fetchUsers(signal?: AbortSignal): Promise<UserSummary[]> {
  return getJson<UserSummary[]>('/api/users', signal);
}

/** Admin reset of another user's password; that user is signed out everywhere. */
export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  await postJson(`/api/users/${encodeURIComponent(userId)}/password`, { newPassword });
}

// --- Forgot password ---------------------------------------------------------------------------

/** Always succeeds for a well-formed username (the server doesn't reveal whether it exists). */
export async function requestPasswordReset(username: string): Promise<void> {
  await postJson('/api/auth/forgot', { username });
}

/** The username a reset link is for; throws ApiError(400) if the link is invalid or expired. */
export async function checkResetLink(token: string): Promise<string> {
  return (await postJson<{ username: string }>('/api/auth/reset/check', { token })).username;
}

export async function redeemResetLink(token: string, newPassword: string): Promise<string> {
  return (await postJson<{ username: string }>('/api/auth/reset', { token, newPassword })).username;
}

export function fetchResetRequests(signal?: AbortSignal): Promise<ResetRequest[]> {
  return getJson<ResetRequest[]>('/api/password-resets/requests', signal);
}

export async function dismissResetRequest(userId: string): Promise<void> {
  await send('DELETE', `/api/password-resets/requests/${encodeURIComponent(userId)}`);
}

/** Creates a one-time reset link for another user; returns the full URL to pass on to them. */
export async function createResetLink(userId: string): Promise<{ url: string; username: string; expiresAt: string }> {
  const link = await postJson<{ token: string; username: string; expiresAt: string }>(
    `/api/users/${encodeURIComponent(userId)}/reset-link`,
    {},
  );
  // The token goes in the #fragment, which browsers never send to the server or in Referer headers.
  return { url: `${window.location.origin}/reset-password#${link.token}`, username: link.username, expiresAt: link.expiresAt };
}
