import { getPool, sql } from './db.ts';
import { getLead, isClosed, logFollowUp } from './leads.ts';
import { sendMail } from './notify.ts';
import { formatPhone } from '../src/format.ts';
import { MAX_FOLLOW_UPS, leadReference, type Lead, type LeadStatus, type User } from '../src/types.ts';

/**
 * Emails from a sales rep (or manager/admin) to the customer, written and sent on the lead page.
 * Sent over the same SMTP as the manager alerts (server/notify.ts): From is the verified SMTP_FROM
 * address with the sender's name, Reply-To is the sender's own work email (`Users.Email`), so the
 * customer's reply reaches them. Every email is recorded in dbo.LeadEmails with its outcome, and can be
 * recorded as the lead's next follow-up (method Email). Plain text only.
 */

const DEALERSHIP = 'One-Stop Vehicle Shop';

/** "2135550106" → "(213) 555-0106"; other formats (international) are shown as stored. */
export const formatStaffMobile = formatPhone;

/** The signature added under every email: who sent it and how to reach them. */
export function emailSignature(sender: { username: string; email: string; mobile: string | null }): string {
  return ['--', sender.username, DEALERSHIP, sender.email, sender.mobile ? `Mobile: ${formatStaffMobile(sender.mobile)}` : null]
    .filter(Boolean)
    .join('\n');
}

/** Display name on the From line, e.g. "jsmith · One-Stop Vehicle Shop". */
export const senderName = (username: string) => `${username} · ${DEALERSHIP}`;

/** Whether an email now can also be recorded as the next follow-up: open, assigned, fewer than 3 logged. */
export const canCountAsFollowUp = (lead: { status: LeadStatus; assignedTo: unknown; followUps: number }) =>
  !isClosed(lead.status) && lead.assignedTo !== null && lead.followUps < MAX_FOLLOW_UPS;

// --- Rate limit: 30 emails per sender per hour (in memory), well inside Brevo's free 300/day. ---

const EMAIL_LIMIT = 30;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;
const sent = new Map<string, number[]>();

/** Minutes until this user may send another email, or 0 (and the email is counted). */
export function emailThrottle(userId: string, now = Date.now()): number {
  const times = (sent.get(userId) ?? []).filter((t) => now - t < EMAIL_WINDOW_MS);
  if (times.length >= EMAIL_LIMIT) return Math.max(1, Math.ceil((times[0] + EMAIL_WINDOW_MS - now) / 60_000));
  sent.set(userId, [...times, now]);
  return 0;
}

export type SendLeadEmailResult =
  | { kind: 'not-found' }
  | { kind: 'no-sender-email' }
  | { kind: 'throttled'; minutes: number }
  | { kind: 'done'; lead: Lead };

/**
 * Sends `subject`/`body` (already validated) to the customer of lead `id`. The viewer must be able to see
 * the lead (assigned rep, manager or admin). A failed send is recorded and shown; it's not an exception.
 */
export async function sendLeadEmail(
  id: number,
  viewer: User,
  input: { subject: string; body: string; countAsFollowUp: boolean },
): Promise<SendLeadEmailResult> {
  const lead = await getLead(id, viewer);
  if (!lead) return { kind: 'not-found' };

  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('userId', mssql.Int, Number(viewer.id))
    .query<{ Username: string; Email: string | null; Mobile: string | null }>(
      'SELECT Username, Email, Mobile FROM dbo.Users WHERE UserId = @userId',
    );
  const sender = recordset[0];
  if (!sender?.Email) return { kind: 'no-sender-email' };

  const minutes = emailThrottle(viewer.id);
  if (minutes > 0) return { kind: 'throttled', minutes };

  const text = `${input.body}\n\n${emailSignature({ username: sender.Username, email: sender.Email, mobile: sender.Mobile })}\n`;
  const inserted = await pool
    .request()
    .input('leadId', mssql.Int, id)
    .input('userId', mssql.Int, Number(viewer.id))
    .input('to', mssql.NVarChar(254), lead.customer.email)
    .input('replyTo', mssql.NVarChar(254), sender.Email)
    .input('subject', mssql.NVarChar(150), input.subject)
    .input('body', mssql.NVarChar(mssql.MAX), text)
    .query<{ EmailId: number }>(`
      INSERT INTO dbo.LeadEmails (LeadId, SentByUserId, ToAddress, ReplyTo, Subject, Body)
        OUTPUT INSERTED.EmailId
        VALUES (@leadId, @userId, @to, @replyTo, @subject, @body)`);
  const emailId = inserted.recordset[0].EmailId;

  const { status, error } = await sendMail({
    to: lead.customer.email,
    replyTo: sender.Email,
    fromName: senderName(sender.Username),
    subject: input.subject,
    text,
    logTag: `lead ${leadReference(id)} email from ${sender.Username}`,
  });
  await pool
    .request()
    .input('id', mssql.Int, emailId)
    .input('status', mssql.VarChar(10), status)
    .input('error', mssql.NVarChar(500), error)
    .query(`UPDATE dbo.LeadEmails
               SET Status = @status, Error = @error, SentAt = CASE WHEN @status = 'Sent' THEN SYSUTCDATETIME() END
             WHERE EmailId = @id`);

  // Only an email that went out (or, without SMTP in development, was logged) counts as a follow-up.
  if (input.countAsFollowUp && status !== 'Failed' && canCountAsFollowUp(lead)) {
    const change = await logFollowUp(id, viewer, 'Email', `Email: ${input.subject}`.slice(0, 1000));
    if (change === 'ok') {
      await pool
        .request()
        .input('id', mssql.Int, emailId)
        .input('leadId', mssql.Int, id)
        .query(`UPDATE dbo.LeadEmails
                   SET FollowUpNumber = (SELECT MAX(Number) FROM dbo.LeadFollowUps WHERE LeadId = @leadId)
                 WHERE EmailId = @id`);
    }
  }

  return { kind: 'done', lead: (await getLead(id, viewer))! };
}
