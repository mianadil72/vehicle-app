// "Forgot password" without email:
//   1. The user asks for a reset on the sign-in page (recordResetRequest).
//   2. An admin sees the request and creates a one-time reset link (createResetLink), which they pass on
//      in person or by chat.
//   3. The user opens the link and picks a new password (redeemResetLink). The admin never knows it.
import { randomBytes } from 'node:crypto';
import { getPool, sql } from './db.ts';
import { hashToken, resetPassword } from './auth.ts';
import type { ResetRequest } from '../src/types.ts';

export const RESET_LINK_HOURS = 24;

/**
 * Records a request for an active user. Unknown or deactivated usernames are silently ignored, so the
 * response can't be used to discover which usernames exist.
 */
export async function recordResetRequest(username: string): Promise<void> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  await pool
    .request()
    .input('username', mssql.NVarChar(50), username.trim().toLowerCase())
    .query(`
      MERGE dbo.PasswordResetRequests WITH (HOLDLOCK) AS t
      USING (SELECT UserId FROM dbo.Users WHERE Username = @username AND IsActive = 1) AS s
         ON t.UserId = s.UserId
      WHEN MATCHED THEN UPDATE SET RequestedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (UserId) VALUES (s.UserId);`);
}

export async function listResetRequests(): Promise<ResetRequest[]> {
  const pool = await getPool();
  const { recordset } = await pool.request().query<{ UserId: number; Username: string; Role: ResetRequest['role']; RequestedAt: Date }>(`
    SELECT r.UserId, u.Username, u.Role, r.RequestedAt
      FROM dbo.PasswordResetRequests r
      JOIN dbo.Users u ON u.UserId = r.UserId
     WHERE u.IsActive = 1
     ORDER BY r.RequestedAt`);
  return recordset.map((r) => ({
    userId: String(r.UserId),
    username: r.Username,
    role: r.Role,
    requestedAt: r.RequestedAt.toISOString(),
  }));
}

/** Returns false when there was no open request for that user. */
export async function dismissResetRequest(userId: number): Promise<boolean> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const result = await pool.request().input('id', mssql.Int, userId).query('DELETE FROM dbo.PasswordResetRequests WHERE UserId = @id');
  return result.rowsAffected[0] > 0;
}

/**
 * Creates a one-time reset link token for an active user, replacing any earlier one, and closes their
 * request. Returns null when the user doesn't exist or is deactivated.
 */
export async function createResetLink(
  userId: number,
  createdByUserId: number,
): Promise<{ token: string; username: string; expiresAt: string } | null> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const token = randomBytes(32).toString('base64url');
  const { recordset } = await pool
    .request()
    .input('id', mssql.Int, userId)
    .input('by', mssql.Int, createdByUserId)
    .input('tokenHash', mssql.VarBinary(32), hashToken(token))
    .input('hours', mssql.Int, RESET_LINK_HOURS)
    .query<{ Username: string; ExpiresAt: Date }>(`
      IF EXISTS (SELECT 1 FROM dbo.Users WHERE UserId = @id AND IsActive = 1)
      BEGIN
        DELETE FROM dbo.PasswordResetTokens WHERE UserId = @id OR ExpiresAt < SYSUTCDATETIME();
        DELETE FROM dbo.PasswordResetRequests WHERE UserId = @id;
        INSERT INTO dbo.PasswordResetTokens (TokenHash, UserId, CreatedByUserId, ExpiresAt)
          VALUES (@tokenHash, @id, @by, DATEADD(HOUR, @hours, SYSUTCDATETIME()));
        SELECT u.Username, t.ExpiresAt
          FROM dbo.PasswordResetTokens t JOIN dbo.Users u ON u.UserId = t.UserId
         WHERE t.TokenHash = @tokenHash;
      END`);
  const row = recordset?.[0];
  return row ? { token, username: row.Username, expiresAt: row.ExpiresAt.toISOString() } : null;
}

/** The account a valid, unexpired link belongs to, or null. */
export async function checkResetLink(token: string): Promise<{ userId: number; username: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('tokenHash', mssql.VarBinary(32), hashToken(token))
    .query<{ UserId: number; Username: string }>(`
      SELECT u.UserId, u.Username
        FROM dbo.PasswordResetTokens t JOIN dbo.Users u ON u.UserId = t.UserId
       WHERE t.TokenHash = @tokenHash AND t.ExpiresAt > SYSUTCDATETIME() AND u.IsActive = 1`);
  return recordset[0] ? { userId: recordset[0].UserId, username: recordset[0].Username } : null;
}

/** Sets the new password if the link is still valid; the link stops working afterwards. */
export async function redeemResetLink(token: string, newPassword: string): Promise<string | null> {
  const account = await checkResetLink(token);
  if (!account) return null;
  await resetPassword(account.userId, newPassword); // also deletes the user's tokens and sessions
  return account.username;
}
