import { useEffect, useState } from 'react';
import type {
  Category,
  ChatReply,
  CompPlan,
  ContactMethod,
  PayPeriod,
  PayStatement,
  Sale,
  SaleStatus,
  StaffMember,
  WeeklyStats,
  InventoryStats,
  Lead,
  LeadCounts,
  LeadSummary,
  ResetRequest,
  SalesRep,
  UserSummary,
  Vehicle,
  VehicleComment,
} from './types';
import type { LeadInput } from './leadValidation';
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

// --- Dashboard (signed-in users) ---------------------------------------------------------------

export function fetchInventoryStats(signal?: AbortSignal): Promise<InventoryStats> {
  return getJson<InventoryStats>('/api/stats/inventory', signal);
}

// --- Customer chat -----------------------------------------------------------------------------

/** Whether the server has a Foundry agent configured; the chat widget stays hidden otherwise. */
export async function fetchChatEnabled(signal?: AbortSignal): Promise<boolean> {
  return (await getJson<{ enabled: boolean }>('/api/chat/status', signal)).enabled;
}

/** Sends one message. Omit `conversationId` (or pass an expired one) to start a new conversation. */
export function sendChatMessage(message: string, conversationId?: string): Promise<ChatReply> {
  return postJson<ChatReply>('/api/chat', { message, conversationId });
}

// --- CRM: customer leads -----------------------------------------------------------------------

/** Public: a customer's enquiry. Resolves to the lead reference, e.g. "L-00042". */
export async function submitLead(input: LeadInput, source: 'contact' | 'vehicle', website: string): Promise<string> {
  return (await postJson<{ reference: string }>('/api/leads', { ...input, source, website })).reference;
}

export interface LeadListQuery {
  status?: string;
  assigned?: string;
  overdue?: boolean;
}

export function fetchLeads(query: LeadListQuery, signal?: AbortSignal): Promise<LeadSummary[]> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.assigned) params.set('assigned', query.assigned);
  if (query.overdue) params.set('overdue', '1');
  const qs = params.toString();
  return getJson<LeadSummary[]>(`/api/leads${qs ? `?${qs}` : ''}`, signal);
}

/** Resolves to `null` when the lead doesn't exist or isn't visible to the signed-in user. */
export async function fetchLead(id: string, signal?: AbortSignal): Promise<Lead | null> {
  const res = await fetch(`/api/leads/${encodeURIComponent(id)}`, { signal, headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
  return res.json() as Promise<Lead>;
}

export function fetchLeadCounts(signal?: AbortSignal): Promise<LeadCounts> {
  return getJson<LeadCounts>('/api/leads/counts', signal);
}

export function fetchSalesReps(signal?: AbortSignal): Promise<SalesRep[]> {
  return getJson<SalesRep[]>('/api/sales-reps', signal);
}

export async function assignLead(id: string, userId: string): Promise<Lead> {
  const res = await fetch(`/api/leads/${encodeURIComponent(id)}/assign`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userId: Number(userId) }),
  });
  const data = (await res.json().catch(() => ({}))) as Lead & { error?: string; fields?: Record<string, string> };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.fields);
  return data;
}

export function logFollowUp(id: string, method: ContactMethod, note: string): Promise<Lead> {
  return postJson<Lead>(`/api/leads/${encodeURIComponent(id)}/follow-ups`, { method, note });
}

/** Emails the customer (Reply-To: your work email); optionally records it as the next follow-up. */
export function emailLead(id: string, email: { subject: string; body: string; countAsFollowUp: boolean }): Promise<Lead> {
  return postJson<Lead>(`/api/leads/${encodeURIComponent(id)}/emails`, email);
}

export function closeLead(id: string, outcome: 'Won' | 'Lost'): Promise<Lead> {
  return postJson<Lead>(`/api/leads/${encodeURIComponent(id)}/close`, { outcome });
}

export function resendLeadNotification(id: string): Promise<Lead> {
  return postJson<Lead>(`/api/leads/${encodeURIComponent(id)}/notify`, {});
}

// --- Accounting: sales, earnings, compensation ---------------------------------------------------

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; fields?: Record<string, string> };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.fields);
  return data;
}

export interface SaleDraft {
  vehicleId: string;
  leadId?: string | null;
  buyerName: string;
  salePrice: string;
  saleDate: string;
  notes?: string;
}

export const recordSale = (draft: SaleDraft) => postJson<Sale>('/api/sales', draft);

export function fetchSales(query: { status?: SaleStatus; view?: 'mine' | 'decide' }, signal?: AbortSignal): Promise<Sale[]> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.view) params.set('view', query.view);
  const qs = params.toString();
  return getJson<Sale[]>(`/api/sales${qs ? `?${qs}` : ''}`, signal);
}

export const fetchPendingSaleCount = async (signal?: AbortSignal) => (await getJson<{ count: number }>('/api/sales/pending-count', signal)).count;

export const fetchPerkEstimate = (saleDate: string, signal?: AbortSignal) =>
  getJson<{ unit: number; perk: number; label: string }>(`/api/sales/estimate?saleDate=${encodeURIComponent(saleDate)}`, signal);

export const approveSale = (id: string) => postJson<Sale>(`/api/sales/${encodeURIComponent(id)}/approve`, {});
export const rejectSale = (id: string, reason: string) => postJson<Sale>(`/api/sales/${encodeURIComponent(id)}/reject`, { reason });
export const voidSale = (id: string, reason: string) => postJson<Sale>(`/api/sales/${encodeURIComponent(id)}/void`, { reason });

export const fetchPayPeriods = (signal?: AbortSignal) => getJson<{ current: string; periods: PayPeriod[] }>('/api/earnings/periods', signal);

export function fetchStatement(query: { user?: string; period?: string }, signal?: AbortSignal): Promise<PayStatement> {
  const params = new URLSearchParams();
  if (query.user) params.set('user', query.user);
  if (query.period) params.set('period', query.period);
  return getJson<PayStatement>(`/api/earnings/statement?${params}`, signal);
}

export const fetchTeamStatements = (period: string, scope: 'team' | 'all', signal?: AbortSignal) =>
  getJson<PayStatement[]>(`/api/earnings/team?period=${encodeURIComponent(period)}&scope=${scope}`, signal);

export const addAdjustment = (userId: string, amount: number, note: string) =>
  postJson<{ period: string }>('/api/earnings/adjustments', { userId: Number(userId), amount, note });

export const closePayPeriod = (start: string) => postJson<PayPeriod[]>(`/api/earnings/periods/${encodeURIComponent(start)}/close`, {});

export const payrollCsvUrl = (start: string) => `/api/earnings/periods/${encodeURIComponent(start)}/export.csv`;

export const fetchWeeklyStats = (scope: 'me' | 'team' | 'all', weeks: number, signal?: AbortSignal) =>
  getJson<WeeklyStats>(`/api/stats/sales/weekly?scope=${scope}&weeks=${weeks}`, signal);

export const fetchStaff = (signal?: AbortSignal) => getJson<StaffMember[]>('/api/admin/staff', signal);
export const fetchCompPlans = (signal?: AbortSignal) => getJson<CompPlan[]>('/api/admin/comp-plans', signal);
export const createCompPlan = (plan: { effectiveFrom: string; managerOverride: number; tiers: { fromUnit: number; perVehicle: number }[] }) =>
  postJson<CompPlan[]>('/api/admin/comp-plans', plan);
export const setSalary = (userId: string, annualSalary: number, effectiveFrom: string) =>
  putJson<StaffMember[]>(`/api/admin/salaries/${encodeURIComponent(userId)}`, { annualSalary, effectiveFrom });
export const setStaffContact = (userId: string, email: string, mobile: string) =>
  putJson<StaffMember[]>(`/api/users/${encodeURIComponent(userId)}/contact`, { email, mobile });
export const setManager = (userId: string, managerId: string | null) =>
  putJson<StaffMember[]>(`/api/users/${encodeURIComponent(userId)}/manager`, { managerId: managerId === null ? null : Number(managerId) });
