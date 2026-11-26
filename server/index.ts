import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { CATEGORIES, type Category } from '../src/types.ts';
import { closePools, getPool } from './db.ts';
import {
  changeOwnPassword,
  currentUser,
  listUsers,
  lockedOutFor,
  login,
  logout,
  passwordProblem,
  recordLoginResult,
  requireAdmin,
  requireLeadManager,
  requireSalesTeam,
  requireSignedIn,
  resetPassword,
} from './auth.ts';
import {
  type LeadChange,
  type LeadFilter,
  assignLead,
  closeLead,
  createLead,
  followUpProblem,
  getLead,
  leadCounts,
  leadThrottle,
  leadThrottleKey,
  listLeads,
  listSalesReps,
  logFollowUp,
} from './leads.ts';
import { notifyNewLead, notificationsConfigured } from './notify.ts';
import { parseDate, periodFor, reasonProblem, today, validatePlan, validateSale } from './accounting.ts';
import {
  type SaleChange,
  approveSale,
  estimatePerk,
  getSale,
  listSales,
  pendingApprovalCount,
  recordSale,
  rejectSale,
  voidSale,
} from './sales.ts';
import {
  addAdjustment,
  canSeePay,
  closePeriod,
  createPlan,
  exportCsv,
  listPeriods,
  listPlans,
  listStaff,
  setManager,
  setStaffContact,
  setSalary,
  statement,
  teamStatements,
  weeklyStats,
} from './payroll.ts';
import { SALE_STATUSES, type SaleStatus } from '../src/types.ts';
import { validateLead, validateLeadEmail, validateStaffContact } from '../src/leadValidation.ts';
import { sendLeadEmail } from './leadEmails.ts';
import { leadReference, type ContactMethod } from '../src/types.ts';
import { CHAT_MESSAGE_MAX_LENGTH, chat, chatEnabled, chatThrottle } from './chat.ts';
import { inventoryStats } from './stats.ts';
import { addComment, commentProblem, deleteComment, listComments } from './comments.ts';
import {
  checkResetLink,
  createResetLink,
  dismissResetRequest,
  listResetRequests,
  recordResetRequest,
  redeemResetLink,
} from './passwordResets.ts';
import type { User } from '../src/types.ts';
import { validateVehicle } from '../src/validation.ts';
import {
  DuplicateStockNumberError,
  VehicleHasSalesError,
  createVehicle,
  deleteVehicle,
  getVehicle,
  listVehicles,
  updateVehicle,
} from './vehicles.ts';

const app = express();
app.disable('x-powered-by');
app.use('/api', express.json({ limit: '100kb' }));

const toId = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : undefined;
};

app.get('/api/health', async (_req, res) => {
  await (await getPool()).request().query('SELECT 1 AS ok');
  res.json({ ok: true });
});

// --- Authentication -------------------------------------------------------------------------

// Body: { username, password }. Sets the session cookie and returns the user.
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    res.status(400).json({ error: 'Enter your username and password' });
    return;
  }
  if (username.length > 50 || password.length > 200) {
    res.status(401).json({ error: 'Incorrect username or password' });
    return;
  }
  const wait = lockedOutFor(req, username);
  if (wait > 0) {
    res.status(429).setHeader('Retry-After', String(wait));
    res.json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` });
    return;
  }
  const user = await login(res, username, password);
  recordLoginResult(req, username, user !== null);
  if (!user) {
    res.status(401).json({ error: 'Incorrect username or password' });
    return;
  }
  res.json({ user });
});

app.post('/api/auth/logout', async (req, res) => {
  await logout(req, res);
  res.status(204).end();
});

// The signed-in user, or { user: null }. Never cached, since it depends on the cookie.
app.get('/api/auth/me', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ user: await currentUser(req) });
});

// --- Passwords (admins only) -------------------------------------------------------------------

// Body: { currentPassword, newPassword }. Keeps this session, signs out the admin's other sessions.
app.post('/api/auth/password', requireAdmin, async (req, res) => {
  const user = res.locals.user as User;
  const { currentPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;
  const wait = lockedOutFor(req, user.username);
  if (wait > 0) {
    res.status(429).setHeader('Retry-After', String(wait));
    res.json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` });
    return;
  }
  if (typeof currentPassword !== 'string' || !currentPassword) {
    res.status(400).json({ error: 'Some fields are invalid', fields: { currentPassword: 'Enter your current password' } });
    return;
  }
  const problem = passwordProblem(newPassword);
  if (problem || newPassword === currentPassword) {
    res.status(400).json({
      error: 'Some fields are invalid',
      fields: { newPassword: problem ?? 'Choose a password different from your current one' },
    });
    return;
  }
  const result = await changeOwnPassword(req, user, currentPassword, newPassword as string);
  recordLoginResult(req, user.username, result === 'ok');
  if (result === 'wrong-password') {
    res.status(400).json({ error: 'Some fields are invalid', fields: { currentPassword: 'Current password is incorrect' } });
    return;
  }
  res.status(204).end();
});

// --- Forgot password (no email: an admin creates a one-time link) -----------------------------

// Per-IP limit on reset requests, so the endpoint can't be used to flood admins.
const forgotRequests = new Map<string, number[]>();
const FORGOT_LIMIT = 5;
const FORGOT_WINDOW_MS = 15 * 60 * 1000;

// Body: { username }. Always answers the same way, whether or not the account exists.
app.post('/api/auth/forgot', async (req, res) => {
  const { username } = (req.body ?? {}) as { username?: unknown };
  if (typeof username !== 'string' || !username.trim() || username.length > 50) {
    res.status(400).json({ error: 'Enter your username' });
    return;
  }
  const key = req.ip ?? '';
  const recent = (forgotRequests.get(key) ?? []).filter((t) => Date.now() - t < FORGOT_WINDOW_MS);
  if (recent.length >= FORGOT_LIMIT) {
    res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    return;
  }
  forgotRequests.set(key, [...recent, Date.now()]);
  await recordResetRequest(username);
  res.status(202).json({ ok: true });
});

// Body: { token }. Which account a reset link is for (POST so the token stays out of URLs and logs).
app.post('/api/auth/reset/check', async (req, res) => {
  const { token } = (req.body ?? {}) as { token?: unknown };
  const account = typeof token === 'string' ? await checkResetLink(token) : null;
  if (!account) {
    res.status(400).json({ error: 'This reset link is invalid, has expired, or was already used.' });
    return;
  }
  res.json({ username: account.username });
});

// Body: { token, newPassword }
app.post('/api/auth/reset', async (req, res) => {
  const { token, newPassword } = (req.body ?? {}) as { token?: unknown; newPassword?: unknown };
  const problem = passwordProblem(newPassword);
  if (problem) {
    res.status(400).json({ error: 'Some fields are invalid', fields: { newPassword: problem } });
    return;
  }
  const username = typeof token === 'string' ? await redeemResetLink(token, newPassword as string) : null;
  if (!username) {
    res.status(400).json({ error: 'This reset link is invalid, has expired, or was already used.' });
    return;
  }
  res.json({ username });
});

app.get('/api/password-resets/requests', requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await listResetRequests());
});

app.delete('/api/password-resets/requests/:userId', requireAdmin, async (req, res) => {
  const id = toId(req.params.userId);
  if (id === undefined || !(await dismissResetRequest(id))) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }
  res.status(204).end();
});

// Creates a one-time link (valid 24 hours) for another user. Returns { token, username, expiresAt };
// the page builds the URL. Shown once: only a hash is stored.
app.post('/api/users/:id/reset-link', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const admin = res.locals.user as User;
  if (id !== undefined && String(id) === admin.id) {
    res.status(400).json({ error: 'Use "Change your password" for your own account.' });
    return;
  }
  const link = id === undefined ? null : await createResetLink(id, Number(admin.id));
  if (!link) {
    res.status(404).json({ error: 'User not found or deactivated' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json(link);
});

app.get('/api/users', requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await listUsers());
});

// Body: { newPassword }. Signs that user out everywhere.
app.post('/api/users/:id/password', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const { newPassword } = (req.body ?? {}) as Record<string, unknown>;
  if (id !== undefined && String(id) === (res.locals.user as User).id) {
    res.status(400).json({ error: 'Use "Change your password" for your own account; it checks your current password.' });
    return;
  }
  const problem = passwordProblem(newPassword);
  if (problem) {
    res.status(400).json({ error: 'Some fields are invalid', fields: { newPassword: problem } });
    return;
  }
  if (id === undefined || !(await resetPassword(id, newPassword as string))) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.status(204).end();
});

// --- Vehicles (reads are open; writes require an admin) ----------------------------------------

// GET /api/vehicles?category=SUV&exclude=4&limit=3
app.get('/api/vehicles', async (req, res) => {
  const { category, exclude, limit } = req.query;
  if (category !== undefined && !(CATEGORIES as readonly unknown[]).includes(category)) {
    res.status(400).json({ error: `Unknown category. Expected one of: ${CATEGORIES.join(', ')}` });
    return;
  }
  const lim = limit === undefined ? undefined : Number(limit);
  if (lim !== undefined && !(Number.isInteger(lim) && lim > 0 && lim <= 500)) {
    res.status(400).json({ error: 'limit must be an integer between 1 and 500' });
    return;
  }
  res.json(
    await listVehicles({
      category: category as Category | undefined,
      excludeId: exclude === undefined ? undefined : toId(exclude),
      limit: lim,
    }),
  );
});

app.get('/api/vehicles/:id', async (req, res) => {
  const id = toId(req.params.id);
  const vehicle = id === undefined ? null : await getVehicle(id);
  if (!vehicle) {
    res.status(404).json({ error: 'Vehicle not found' });
    return;
  }
  res.json(vehicle);
});

// Body: a vehicle without `id` (see VehicleInput in src/validation.ts). 400 lists errors per field.
app.post('/api/vehicles', requireAdmin, async (req, res) => {
  const check = validateVehicle(req.body);
  if (!check.ok) {
    res.status(400).json({ error: 'Some fields are invalid', fields: check.errors });
    return;
  }
  const vehicle = await createVehicle(check.value);
  res.status(201).location(`/api/vehicles/${vehicle.id}`).json(vehicle);
});

app.put('/api/vehicles/:id', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const check = validateVehicle(req.body);
  if (!check.ok) {
    res.status(400).json({ error: 'Some fields are invalid', fields: check.errors });
    return;
  }
  const vehicle = id === undefined ? null : await updateVehicle(id, check.value);
  if (!vehicle) {
    res.status(404).json({ error: 'Vehicle not found' });
    return;
  }
  res.json(vehicle);
});

app.delete('/api/vehicles/:id', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (id === undefined || !(await deleteVehicle(id))) {
    res.status(404).json({ error: 'Vehicle not found' });
    return;
  }
  res.status(204).end();
});

// --- Comments (everyone can read; admins add and delete) --------------------------------------

app.get('/api/vehicles/:id/comments', async (req, res) => {
  const id = toId(req.params.id);
  if (id === undefined || !(await getVehicle(id))) {
    res.status(404).json({ error: 'Vehicle not found' });
    return;
  }
  res.json(await listComments(id));
});

// Body: { body }
app.post('/api/vehicles/:id/comments', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const { body } = (req.body ?? {}) as { body?: unknown };
  const problem = commentProblem(body);
  if (problem) {
    res.status(400).json({ error: problem, fields: { body: problem } });
    return;
  }
  const comment = id === undefined ? null : await addComment(id, Number((res.locals.user as User).id), body as string);
  if (!comment) {
    res.status(404).json({ error: 'Vehicle not found' });
    return;
  }
  res.status(201).json(comment);
});

app.delete('/api/vehicles/:id/comments/:commentId', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const commentId = toId(req.params.commentId);
  if (id === undefined || commentId === undefined || !(await deleteComment(id, commentId))) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  res.status(204).end();
});

// --- Dashboard (any signed-in user) -----------------------------------------------------------

app.get('/api/stats/inventory', requireSignedIn, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await inventoryStats());
});

// --- CRM: customer leads -----------------------------------------------------------------------

// Public. Body: LeadInput (src/leadValidation.ts) plus `source` ('contact' | 'vehicle') and the
// `website` honeypot, which people never see or fill in. Returns 201 { reference }.
app.post('/api/leads', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const check = validateLead(body);
  if (!check.ok) {
    res.status(400).json({ error: 'Some fields are invalid', fields: check.errors });
    return;
  }
  const wait = leadThrottle(leadThrottleKey(req));
  if (wait > 0) {
    res.status(429).setHeader('Retry-After', String(wait));
    res.json({ error: 'We already have your details. Please wait a few minutes before sending another request.' });
    return;
  }
  // A bot filled the hidden field: answer as if it worked, store nothing.
  if (typeof body.website === 'string' && body.website.trim()) {
    res.status(201).json({ reference: leadReference(0) });
    return;
  }
  const source = body.source === 'vehicle' && check.value.vehicleId ? 'vehicle' : 'contact';
  const id = await createLead(check.value, source);
  void notifyNewLead(id); // not awaited: the customer doesn't wait for the mail server
  res.status(201).json({ reference: leadReference(id) });
});

const LEAD_CHANGE_ERRORS: Record<Exclude<LeadChange, 'ok'>, [number, string]> = {
  'not-found': [404, 'Lead not found'],
  closed: [409, 'This lead is already closed'],
  unassigned: [409, 'Assign this lead to a sales rep before logging follow-ups'],
  'no-more-follow-ups': [409, 'All 3 follow-ups have been logged. Mark the lead won or lost.'],
  'bad-assignee': [400, 'Choose an active sales rep or manager'],
};

/** Replies with the updated lead, or the error for `change`. */
async function sendLeadChange(res: Response, id: number, change: LeadChange) {
  if (change !== 'ok') {
    const [status, error] = LEAD_CHANGE_ERRORS[change];
    res.status(status).json({ error });
    return;
  }
  res.json(await getLead(id, res.locals.user as User));
}

// GET /api/leads?status=open|closed|all|<status>&assigned=me|none|<userId>&overdue=1
app.get('/api/leads', requireSalesTeam, async (req, res) => {
  const { status, assigned, overdue } = req.query;
  res.setHeader('Cache-Control', 'no-store');
  res.json(
    await listLeads(res.locals.user as User, {
      status: typeof status === 'string' ? (status as LeadFilter['status']) : undefined,
      assigned: typeof assigned === 'string' ? assigned : undefined,
      overdue: overdue === '1' || overdue === 'true',
    }),
  );
});

app.get('/api/leads/counts', requireSalesTeam, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await leadCounts(res.locals.user as User));
});

app.get('/api/leads/:id', requireSalesTeam, async (req, res) => {
  const id = toId(req.params.id);
  const lead = id === undefined ? null : await getLead(id, res.locals.user as User);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(lead);
});

app.get('/api/sales-reps', requireLeadManager, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await listSalesReps());
});

// Body: { userId }
app.put('/api/leads/:id/assign', requireLeadManager, async (req, res) => {
  const id = toId(req.params.id);
  const userId = toId((req.body as { userId?: unknown } | undefined)?.userId);
  if (id === undefined) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  if (userId === undefined) {
    res.status(400).json({ error: 'Choose a sales rep', fields: { userId: 'Choose a sales rep' } });
    return;
  }
  await sendLeadChange(res, id, await assignLead(id, userId));
});

// Body: { method, note }. Logs the next follow-up (1st, 2nd, 3rd).
app.post('/api/leads/:id/follow-ups', requireSalesTeam, async (req, res) => {
  const id = toId(req.params.id);
  const { method, note } = (req.body ?? {}) as { method?: unknown; note?: unknown };
  const problems = followUpProblem(method, note);
  if (problems) {
    res.status(400).json({ error: 'Some fields are invalid', fields: problems });
    return;
  }
  if (id === undefined) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  await sendLeadChange(res, id, await logFollowUp(id, res.locals.user as User, method as ContactMethod, note as string));
});

// Body: { outcome: 'Won' | 'Lost' }
app.post('/api/leads/:id/close', requireSalesTeam, async (req, res) => {
  const id = toId(req.params.id);
  const { outcome } = (req.body ?? {}) as { outcome?: unknown };
  if (outcome !== 'Won' && outcome !== 'Lost') {
    res.status(400).json({ error: 'Outcome must be Won or Lost' });
    return;
  }
  if (id === undefined) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  await sendLeadChange(res, id, await closeLead(id, res.locals.user as User, outcome));
});

// Body: { subject, body, countAsFollowUp }. Emails the customer from the lead page (Reply-To: the sender's
// work email); records it, and optionally the next follow-up. Returns the refreshed lead.
app.post('/api/leads/:id/emails', requireSalesTeam, async (req, res) => {
  const id = toId(req.params.id);
  const { subject, body, countAsFollowUp } = (req.body ?? {}) as { subject?: unknown; body?: unknown; countAsFollowUp?: unknown };
  const check = validateLeadEmail(subject, body);
  if (!check.ok) {
    res.status(400).json({ error: 'Some fields are invalid', fields: check.errors });
    return;
  }
  if (id === undefined) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  const result = await sendLeadEmail(id, res.locals.user as User, { ...check.value, countAsFollowUp: countAsFollowUp === true });
  switch (result.kind) {
    case 'not-found':
      res.status(404).json({ error: 'Lead not found' });
      return;
    case 'no-sender-email':
      res.status(400).json({ error: 'Ask an admin to add your email address to your account first. Customer replies go to it.' });
      return;
    case 'throttled':
      res.status(429).setHeader('Retry-After', String(result.minutes * 60));
      res.json({ error: `You've sent a lot of emails in the last hour. Try again in ${result.minutes} minute${result.minutes === 1 ? '' : 's'}.` });
      return;
    case 'done':
      res.json(result.lead);
  }
});

// Sends the manager's email/text for this lead again (e.g. after fixing the SMTP settings).
app.post('/api/leads/:id/notify', requireLeadManager, async (req, res) => {
  const id = toId(req.params.id);
  if (id === undefined || !(await getLead(id, null))) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  if (!notificationsConfigured()) {
    res.status(409).json({ error: 'Set LEAD_MANAGER_EMAIL or LEAD_MANAGER_SMS on the server first' });
    return;
  }
  await notifyNewLead(id);
  res.json(await getLead(id, res.locals.user as User));
});

// --- Accounting: sales ---------------------------------------------------------------------------

function sendSaleChange(res: Response, change: SaleChange, created = false) {
  if (!change.ok) {
    res.status(change.status).json({ error: change.error, ...(change.fields && { fields: change.fields }) });
    return false;
  }
  if (created) res.status(201);
  return true;
}

// Body: { vehicleId, leadId?, buyerName, salePrice, saleDate, notes?, soldByUserId? (admins) }
app.post('/api/sales', requireSalesTeam, async (req, res) => {
  const viewer = res.locals.user as User;
  const check = validateSale(req.body);
  if (!check.ok) {
    res.status(400).json({ error: 'Some fields are invalid', fields: check.errors });
    return;
  }
  const soldBy = (req.body as { soldByUserId?: unknown }).soldByUserId;
  const change = await recordSale(viewer, check.value, soldBy === undefined || soldBy === null || soldBy === '' ? undefined : toId(soldBy) ?? -1);
  if (sendSaleChange(res, change, true) && change.ok) res.json(await getSale(change.id, viewer));
});

// GET /api/sales?status=Pending&view=mine|decide
app.get('/api/sales', requireSalesTeam, async (req, res) => {
  const { status, view } = req.query;
  res.setHeader('Cache-Control', 'no-store');
  res.json(
    await listSales(res.locals.user as User, {
      status: (SALE_STATUSES as readonly unknown[]).includes(status) ? (status as SaleStatus) : undefined,
      view: view === 'mine' || view === 'decide' ? view : undefined,
    }),
  );
});

app.get('/api/sales/pending-count', requireSalesTeam, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ count: await pendingApprovalCount(res.locals.user as User) });
});

// GET /api/sales/estimate?saleDate=2026-11-19: the signed-in user's perk if that sale were approved now.
app.get('/api/sales/estimate', requireSalesTeam, async (req, res) => {
  const saleDate = typeof req.query.saleDate === 'string' && parseDate(req.query.saleDate) ? req.query.saleDate : today();
  res.setHeader('Cache-Control', 'no-store');
  res.json(await estimatePerk(res.locals.user as User, saleDate));
});

app.get('/api/sales/:id', requireSalesTeam, async (req, res) => {
  const id = toId(req.params.id);
  const sale = id === undefined ? null : await getSale(id, res.locals.user as User);
  if (!sale) {
    res.status(404).json({ error: 'Sale not found' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(sale);
});

for (const action of ['approve', 'reject', 'void'] as const) {
  app.post(`/api/sales/:id/${action}`, requireSalesTeam, async (req, res) => {
    const viewer = res.locals.user as User;
    const id = toId(req.params.id);
    if (id === undefined) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }
    const { reason } = (req.body ?? {}) as { reason?: unknown };
    if (action !== 'approve') {
      const problem = reasonProblem(reason);
      if (problem) {
        res.status(400).json({ error: problem, fields: { reason: problem } });
        return;
      }
    }
    const change =
      action === 'approve'
        ? await approveSale(viewer, id)
        : action === 'reject'
          ? await rejectSale(viewer, id, reason as string)
          : await voidSale(viewer, id, reason as string);
    if (sendSaleChange(res, change)) res.json(await getSale(id, viewer));
  });
}

// --- Accounting: earnings (pay visible to self, the person's manager, and admins) ---------------

app.get('/api/earnings/periods', requireSalesTeam, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ current: periodFor(today()).start, periods: await listPeriods() });
});

// GET /api/earnings/statement?user=<id>&period=<YYYY-MM-DD>  (defaults: me, current period)
app.get('/api/earnings/statement', requireSalesTeam, async (req, res) => {
  const viewer = res.locals.user as User;
  const userId = req.query.user === undefined ? Number(viewer.id) : toId(req.query.user);
  const period = typeof req.query.period === 'string' ? req.query.period : periodFor(today()).start;
  const result = userId !== undefined && parseDate(period) && (await canSeePay(viewer, userId)) ? await statement(userId, period) : null;
  if (!result) {
    res.status(404).json({ error: 'Statement not found' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
});

// GET /api/earnings/team?period=&scope=team|all : managers see themselves and their reps; admins everyone.
app.get('/api/earnings/team', requireLeadManager, async (req, res) => {
  const viewer = res.locals.user as User;
  const period = typeof req.query.period === 'string' && parseDate(req.query.period) ? req.query.period : periodFor(today()).start;
  const scope = req.query.scope === 'all' && viewer.role === 'admin' ? 'all' : 'team';
  res.setHeader('Cache-Control', 'no-store');
  res.json(await teamStatements(viewer, period, scope));
});

// Body: { userId, amount (dollars, + or −), note }
app.post('/api/earnings/adjustments', requireAdmin, async (req, res) => {
  const { userId, amount, note } = (req.body ?? {}) as Record<string, unknown>;
  const id = toId(userId);
  const cents = typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
  const fields: Record<string, string> = {};
  if (id === undefined) fields.userId = 'Choose a person';
  if (!Number.isFinite(cents) || cents === 0 || Math.abs(cents) > 10_000_000) fields.amount = 'Enter an amount between -$100,000 and $100,000 (not 0)';
  const problem = reasonProblem(note, 'a note explaining the adjustment');
  if (problem) fields.note = problem;
  if (Object.keys(fields).length > 0) {
    res.status(400).json({ error: 'Some fields are invalid', fields });
    return;
  }
  const period = await addAdjustment(res.locals.user as User, id!, cents, note as string);
  if (!period) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.status(201).json({ period });
});

app.post('/api/earnings/periods/:start/close', requireAdmin, async (req, res) => {
  const result = await closePeriod(String(req.params.start), res.locals.user as User);
  const errors = { 'not-found': [404, 'Pay period not found'], closed: [409, 'This period is already closed'], 'not-ended': [409, "A period can only be closed after it ends"] } as const;
  if (result !== 'ok') {
    const [status, error] = errors[result];
    res.status(status).json({ error });
    return;
  }
  res.json(await listPeriods());
});

app.get('/api/earnings/periods/:start/export.csv', requireAdmin, async (req, res) => {
  const start = String(req.params.start);
  const csv = parseDate(start) && periodFor(start).start === start ? await exportCsv(res.locals.user as User, start) : null;
  if (csv === null) {
    res.status(404).json({ error: 'Pay period not found' });
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pay-${start}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});

// GET /api/stats/sales/weekly?scope=me|team|all&weeks=9
app.get('/api/stats/sales/weekly', requireSalesTeam, async (req, res) => {
  const viewer = res.locals.user as User;
  const requested = req.query.scope;
  const scope = requested === 'all' && viewer.role === 'admin' ? 'all' : requested === 'team' && viewer.role !== 'sales' ? 'team' : 'me';
  const weeks = Math.min(26, Math.max(1, Math.trunc(Number(req.query.weeks)) || 9));
  res.setHeader('Cache-Control', 'no-store');
  res.json(await weeklyStats(viewer, scope, weeks));
});

// --- Accounting: compensation setup (admins) ----------------------------------------------------

app.get('/api/admin/staff', requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await listStaff());
});

app.get('/api/admin/comp-plans', requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await listPlans());
});

// Body: { effectiveFrom, managerOverride, tiers: [{ fromUnit, perVehicle }] }
app.post('/api/admin/comp-plans', requireAdmin, async (req, res) => {
  const check = validatePlan(req.body);
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return;
  }
  if (!(await createPlan(res.locals.user as User, check.value))) {
    res.status(409).json({ error: 'A plan already starts on that date' });
    return;
  }
  res.status(201).json(await listPlans());
});

// Body: { annualSalary (dollars), effectiveFrom }
app.put('/api/admin/salaries/:userId', requireAdmin, async (req, res) => {
  const id = toId(req.params.userId);
  const { annualSalary, effectiveFrom } = (req.body ?? {}) as Record<string, unknown>;
  const cents = typeof annualSalary === 'number' && Number.isFinite(annualSalary) ? Math.round(annualSalary * 100) : NaN;
  const fields: Record<string, string> = {};
  if (!Number.isFinite(cents) || cents < 0 || cents > 100_000_000_00) fields.annualSalary = 'Enter an annual salary between $0 and $100,000,000';
  if (!parseDate(effectiveFrom)) fields.effectiveFrom = 'Enter the date it starts';
  if (Object.keys(fields).length > 0) {
    res.status(400).json({ error: 'Some fields are invalid', fields });
    return;
  }
  if (id === undefined || !(await setSalary(res.locals.user as User, id, cents, effectiveFrom as string))) {
    res.status(404).json({ error: 'Staff member not found' });
    return;
  }
  res.json(await listStaff());
});

// Body: { managerId | null }
// Body: { email, mobile } (either may be empty to clear). A staff member's work email and mobile.
app.put('/api/users/:id/contact', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const { email, mobile } = (req.body ?? {}) as { email?: unknown; mobile?: unknown };
  const check = validateStaffContact(email, mobile);
  if (!check.ok) {
    res.status(400).json({ error: 'Some fields are invalid', fields: check.errors });
    return;
  }
  const result = id === undefined ? 'not-found' : await setStaffContact(id, check.value);
  if (result === 'not-found') {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (result === 'duplicate-email') {
    res.status(409).json({ error: 'Another account already uses that email', fields: { email: 'Another account already uses that email' } });
    return;
  }
  res.json(await listStaff());
});

app.put('/api/users/:id/manager', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const raw = (req.body as { managerId?: unknown } | undefined)?.managerId;
  const managerId = raw === null || raw === undefined || raw === '' ? null : toId(raw);
  if (managerId === undefined) {
    res.status(400).json({ error: 'Choose a manager' });
    return;
  }
  const result = id === undefined ? 'not-found' : await setManager(id, managerId);
  const errors = { 'not-found': [404, 'User not found'], 'not-a-rep': [400, 'Only sales reps have a manager'], 'bad-manager': [400, 'Choose an active manager'] } as const;
  if (result !== 'ok') {
    const [status, error] = errors[result];
    res.status(status).json({ error });
    return;
  }
  res.json(await listStaff());
});

// --- Customer chat (public; answered by the Foundry agent) -------------------------------------

app.get('/api/chat/status', (_req, res) => {
  res.json({ enabled: chatEnabled() });
});

// Body: { message, conversationId? }. Returns { conversationId, reply, vehicles }.
app.post('/api/chat', async (req, res) => {
  if (!chatEnabled()) {
    res.status(503).json({ error: 'The assistant is not configured' });
    return;
  }
  const { message, conversationId } = (req.body ?? {}) as { message?: unknown; conversationId?: unknown };
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'Type a message' });
    return;
  }
  if (message.length > CHAT_MESSAGE_MAX_LENGTH) {
    res.status(400).json({ error: `Keep messages under ${CHAT_MESSAGE_MAX_LENGTH} characters` });
    return;
  }
  const wait = chatThrottle(req);
  if (wait > 0) {
    res.status(429).setHeader('Retry-After', String(wait));
    res.json({ error: 'You are sending messages too quickly. Please wait a minute and try again.' });
    return;
  }
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await chat(conversationId, message.trim(), leadThrottleKey(req)));
  } catch (err) {
    // Azure's content filter rejected the message (e.g. a jailbreak attempt): not an outage.
    if ((err as { code?: unknown }).code === 'content_filter') {
      res.status(400).json({ error: "Sorry, I can't help with that. Try asking about our vehicles, prices or availability." });
      return;
    }
    console.error('Chat failed:', err);
    res.status(502).json({ error: 'The assistant is unavailable right now. Please try again shortly.' });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// In production (`npm start` after `npm run build`), also serve the built front end.
const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: dist }));
}

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof VehicleHasSalesError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof DuplicateStockNumberError) {
    res.status(409).json({ error: err.message, fields: { stockNumber: err.message } });
    return;
  }
  // Client errors from Express itself, e.g. malformed JSON or an oversized body.
  if (err.status && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.status === 413 ? 'Request body too large' : 'Invalid request body' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Database error' });
});

const port = Number(process.env.API_PORT) || 3001;
const server = app.listen(port, () => console.log(`API listening on http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void closePools().finally(() => process.exit(0));
  });
}
