import { getPool, sql } from './db.ts';
import { COMMENT_MAX_LENGTH, type VehicleComment } from '../src/types.ts';

interface CommentRow {
  CommentId: number;
  VehicleId: number;
  Body: string;
  Author: string;
  CreatedAt: Date;
}

const toComment = (r: CommentRow): VehicleComment => ({
  id: String(r.CommentId),
  vehicleId: String(r.VehicleId),
  body: r.Body,
  author: r.Author,
  createdAt: r.CreatedAt.toISOString(),
});

const SELECT = `
  SELECT c.CommentId, c.VehicleId, c.Body, u.Username AS Author, c.CreatedAt
    FROM dbo.VehicleComments c
    JOIN dbo.Users u ON u.UserId = c.UserId`;

/** Problem with a comment body, or null if it's acceptable. */
export function commentProblem(body: unknown): string | null {
  if (typeof body !== 'string' || !body.trim()) return 'Write a comment first';
  if (body.trim().length > COMMENT_MAX_LENGTH) return `Comments can be at most ${COMMENT_MAX_LENGTH} characters`;
  return null;
}

/** Newest first. */
export async function listComments(vehicleId: number): Promise<VehicleComment[]> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('vehicleId', mssql.Int, vehicleId)
    .query<CommentRow>(`${SELECT} WHERE c.VehicleId = @vehicleId ORDER BY c.CreatedAt DESC, c.CommentId DESC`);
  return recordset.map(toComment);
}

/** Returns null when the vehicle doesn't exist. */
export async function addComment(vehicleId: number, userId: number, body: string): Promise<VehicleComment | null> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('vehicleId', mssql.Int, vehicleId)
    .input('userId', mssql.Int, userId)
    .input('body', mssql.NVarChar(COMMENT_MAX_LENGTH), body.trim())
    .query<CommentRow>(`
      DECLARE @ids TABLE (CommentId INT);
      INSERT INTO dbo.VehicleComments (VehicleId, UserId, Body)
        OUTPUT INSERTED.CommentId INTO @ids
        SELECT @vehicleId, @userId, @body
         WHERE EXISTS (SELECT 1 FROM dbo.Vehicles WHERE VehicleId = @vehicleId);
      ${SELECT} WHERE c.CommentId IN (SELECT CommentId FROM @ids);`);
  return recordset[0] ? toComment(recordset[0]) : null;
}

/** Returns false when no such comment exists on that vehicle. */
export async function deleteComment(vehicleId: number, commentId: number): Promise<boolean> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const result = await pool
    .request()
    .input('vehicleId', mssql.Int, vehicleId)
    .input('commentId', mssql.Int, commentId)
    .query('DELETE FROM dbo.VehicleComments WHERE CommentId = @commentId AND VehicleId = @vehicleId');
  return result.rowsAffected[0] > 0;
}
