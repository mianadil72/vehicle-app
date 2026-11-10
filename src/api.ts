import { useEffect, useState } from 'react';
import type { Category, Vehicle } from './types';

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
