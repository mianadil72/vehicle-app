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
  resetPassword,
} from './auth.ts';
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
