import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getPool, sql } from './db.ts';
import type { Role, User, UserSummary } from '../src/types.ts';

// ---------------------------------------------------------------------------------------------
// Passwords: scrypt with a random salt, stored as "scrypt$N$r$p$<salt b64>$<hash b64>".
// ---------------------------------------------------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLength: 64 };
export const MIN_PASSWORD_LENGTH = 10;

const scryptAsync = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keyLength, { ...options, maxmem: 128 * options.N! * options.r! * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keyLength } = SCRYPT;
  const hash = await scryptAsync(password, salt, keyLength, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

// Compared against when the username doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

// ---------------------------------------------------------------------------------------------
// Sessions: a random token in an HttpOnly cookie; the database stores only its SHA-256 hash.
// ---------------------------------------------------------------------------------------------

const COOKIE = 'vi_session';
const SESSION_HOURS = 8;
const secureCookies = process.env.NODE_ENV === 'production';

export const hashToken = (token: string) => createHash('sha256').update(token).digest();

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string, maxAgeSeconds: number) {
  res.setHeader(
    'Set-Cookie',
    [
      `${COOKIE}=${token}`,
      'Path=/api',
      'HttpOnly',
      // Strict: the cookie is never sent on requests started by other sites (CSRF protection).
      'SameSite=Strict',
      `Max-Age=${maxAgeSeconds}`,
      ...(secureCookies ? ['Secure'] : []),
    ].join('; '),
  );
}

interface UserRow {
  UserId: number;
  Username: string;
  Role: Role;
  PasswordHash: string;
  IsActive: boolean;
}

const toUser = (row: Pick<UserRow, 'UserId' | 'Username' | 'Role'>): User => ({
  id: String(row.UserId),
  username: row.Username,
  role: row.Role,
});

/** Checks the credentials; on success starts a session and sets the cookie. */
export async function login(res: Response, username: string, password: string): Promise<User | null> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('username', mssql.NVarChar(50), username.trim().toLowerCase())
    .query<UserRow>('SELECT UserId, Username, Role, PasswordHash, IsActive FROM dbo.Users WHERE Username = @username');
  const row = recordset[0];
  const valid = await verifyPassword(password, row?.PasswordHash ?? (await DUMMY_HASH));
  if (!row || !row.IsActive || !valid) return null;

  const token = randomBytes(32).toString('base64url');
  await pool
    .request()
    .input('tokenHash', mssql.VarBinary(32), hashToken(token))
    .input('userId', mssql.Int, row.UserId)
    .input('hours', mssql.Int, SESSION_HOURS)
    .query(`
      DELETE FROM dbo.Sessions WHERE ExpiresAt < SYSUTCDATETIME();
      INSERT INTO dbo.Sessions (TokenHash, UserId, ExpiresAt)
        VALUES (@tokenHash, @userId, DATEADD(HOUR, @hours, SYSUTCDATETIME()));
      UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE UserId = @userId;`);
  setSessionCookie(res, token, SESSION_HOURS * 3600);
  return toUser(row);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = readCookie(req, COOKIE);
  if (token) {
    const [mssql, pool] = await Promise.all([sql(), getPool()]);
    await pool.request().input('tokenHash', mssql.VarBinary(32), hashToken(token)).query('DELETE FROM dbo.Sessions WHERE TokenHash = @tokenHash');
  }
  setSessionCookie(res, '', 0);
}

/** The signed-in user for this request, or null. Deactivated users and expired sessions don't count. */
export async function currentUser(req: Request): Promise<User | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('tokenHash', mssql.VarBinary(32), hashToken(token))
    .query<UserRow>(`
      SELECT u.UserId, u.Username, u.Role
        FROM dbo.Sessions s
        JOIN dbo.Users u ON u.UserId = s.UserId
       WHERE s.TokenHash = @tokenHash AND s.ExpiresAt > SYSUTCDATETIME() AND u.IsActive = 1`);
  return recordset[0] ? toUser(recordset[0]) : null;
}

/** Middleware: only signed-in admins may continue. 401 when signed out, 403 for other roles. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in as an admin to make changes' });
    return;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Only admins can make changes' });
    return;
  }
  res.locals.user = user;
  next();
}

// ---------------------------------------------------------------------------------------------
// Login throttling: after 5 failures for the same username + IP, wait 15 minutes.
// In memory, so it resets when the server restarts and isn't shared between server instances.
// ---------------------------------------------------------------------------------------------

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number }>();

const throttleKey = (req: Request, username: string) => `${req.ip}|${username.trim().toLowerCase()}`;

/** Seconds until another attempt is allowed, or 0 if not locked out. */
export function lockedOutFor(req: Request, username: string): number {
  const entry = failures.get(throttleKey(req, username));
  if (!entry) return 0;
  const remaining = entry.first + LOCKOUT_MS - Date.now();
  if (remaining <= 0) {
    failures.delete(throttleKey(req, username));
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil(remaining / 1000) : 0;
}

export function recordLoginResult(req: Request, username: string, success: boolean) {
  const key = throttleKey(req, username);
  if (success) {
    failures.delete(key);
    return;
  }
  const entry = failures.get(key);
  if (entry && Date.now() - entry.first < LOCKOUT_MS) entry.count++;
  else failures.set(key, { count: 1, first: Date.now() });
}

// ---------------------------------------------------------------------------------------------
// Password changes and admin resets
// ---------------------------------------------------------------------------------------------

/** Problem with a proposed new password, or null if it's acceptable. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return 'Password must be 200 characters or fewer';
  if (password.trim() !== password) return "Password can't start or end with a space";
  return null;
}

/**
 * Changes the signed-in user's own password after checking the current one.
 * Keeps this session and signs out every other session of the user.
 */
export async function changeOwnPassword(
  req: Request,
  user: User,
  currentPassword: string,
  newPassword: string,
): Promise<'ok' | 'wrong-password'> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('id', mssql.Int, Number(user.id))
    .query<Pick<UserRow, 'PasswordHash'>>('SELECT PasswordHash FROM dbo.Users WHERE UserId = @id');
  if (!recordset[0] || !(await verifyPassword(currentPassword, recordset[0].PasswordHash))) return 'wrong-password';

  const token = readCookie(req, COOKIE) ?? '';
  await pool
    .request()
    .input('id', mssql.Int, Number(user.id))
    .input('hash', mssql.VarChar(200), await hashPassword(newPassword))
    .input('keep', mssql.VarBinary(32), hashToken(token))
    .query(`
      UPDATE dbo.Users SET PasswordHash = @hash WHERE UserId = @id;
      DELETE FROM dbo.Sessions WHERE UserId = @id AND TokenHash <> @keep;`);
  return 'ok';
}

/**
 * Sets a user's password (admin reset, or via a reset link). Signs that user out everywhere and closes
 * any open "forgot password" request and reset links. Returns false if no such user.
 */
export async function resetPassword(userId: number, newPassword: string): Promise<boolean> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const result = await pool
    .request()
    .input('id', mssql.Int, userId)
    .input('hash', mssql.VarChar(200), await hashPassword(newPassword))
    .query(`
      UPDATE dbo.Users SET PasswordHash = @hash WHERE UserId = @id;
      DELETE FROM dbo.Sessions WHERE UserId = @id;
      DELETE FROM dbo.PasswordResetRequests WHERE UserId = @id;
      DELETE FROM dbo.PasswordResetTokens WHERE UserId = @id;`);
  return result.rowsAffected[0] > 0;
}

export async function listUsers(): Promise<UserSummary[]> {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .query<UserRow & { LastLoginAt: Date | null }>(
      'SELECT UserId, Username, Role, IsActive, LastLoginAt FROM dbo.Users ORDER BY Username',
    );
  return recordset.map((r) => ({
    ...toUser(r),
    isActive: r.IsActive,
    lastLoginAt: r.LastLoginAt ? r.LastLoginAt.toISOString() : null,
  }));
}
