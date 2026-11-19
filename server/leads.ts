import type { Request } from 'express';
import type { Transaction } from 'mssql';
import { getPool, sql } from './db.ts';
import { inTransaction } from './vehicles.ts';
import { LEAD_MANAGER_ROLES } from './auth.ts';
import {
  CLOSED_LEAD_STATUSES,
  CONTACT_METHODS,
  FOLLOW_UP_INTERVAL_DAYS,
  LEAD_NOTE_MAX_LENGTH,
  LEAD_STATUSES,
  MAX_FOLLOW_UPS,
  type Condition,
  type ContactMethod,
  type Lead,
  type LeadCounts,
  type LeadFollowUp,
  type LeadNotification,
  type LeadSource,
  type LeadStatus,
  type LeadSummary,
  type SalesRep,
  type User,
} from '../src/types.ts';
import type { LeadInput } from '../src/leadValidation.ts';

/**
 * Customer leads (CRM). Customers submit an enquiry (contact page, vehicle page or chat); the lead sales
 * manager is notified (server/notify.ts) and assigns it to a sales rep; the rep logs up to 3 follow-ups.
 * The 1st follow-up is due 2 days after the lead arrives, each later one 2 days after the previous.
 *
 * Visibility: admins and managers see every lead; sales reps only the leads assigned to them. A lead the
 * viewer may not see is reported as "not found", so its existence isn't revealed.
 */

// ---------------------------------------------------------------------------------------------
// Follow-up schedule (pure, unit-tested)
// ---------------------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** Status after logging follow-up number `n` (1-3). */
export function followUpStatus(n: number): LeadStatus {
  if (n === 1) return 'FirstFollowUp';
  if (n === 2) return 'SecondFollowUp';
  if (n === 3) return 'ThirdFollowUp';
  throw new RangeError(`Follow-up number must be 1-${MAX_FOLLOW_UPS}`);
}

/** When the 1st follow-up is due: 2 days after the lead arrived. */
export const firstFollowUpDue = (createdAt: Date) => addDays(createdAt, FOLLOW_UP_INTERVAL_DAYS);

/** When the next follow-up is due after follow-up `n` was logged at `at`; null after the last one. */
export const nextFollowUpDue = (at: Date, n: number): Date | null =>
  n < MAX_FOLLOW_UPS ? addDays(at, FOLLOW_UP_INTERVAL_DAYS) : null;

export const isClosed = (status: LeadStatus) => CLOSED_LEAD_STATUSES.includes(status);

/** An open lead whose next follow-up is past due. */
export function isOverdue(lead: { status: LeadStatus; nextFollowUpDue: string | Date | null }, now = new Date()): boolean {
  if (isClosed(lead.status) || !lead.nextFollowUpDue) return false;
  return new Date(lead.nextFollowUpDue).getTime() < now.getTime();
}

/** Problem with a follow-up, or null when it's fine. */
export function followUpProblem(method: unknown, note: unknown): Partial<Record<'method' | 'note', string>> | null {
  const problems: Partial<Record<'method' | 'note', string>> = {};
  if (!(CONTACT_METHODS as readonly unknown[]).includes(method)) problems.method = 'Choose how you contacted the customer';
  if (typeof note !== 'string' || !note.trim()) problems.note = 'Add a short note about the follow-up';
  else if (note.trim().length > LEAD_NOTE_MAX_LENGTH) problems.note = `Keep the note under ${LEAD_NOTE_MAX_LENGTH} characters`;
  return Object.keys(problems).length > 0 ? problems : null;
}

// ---------------------------------------------------------------------------------------------
// Public submissions: 5 per IP per 15 minutes (web form and chat share the limit). In memory.
// ---------------------------------------------------------------------------------------------

const LEAD_LIMIT = 5;
const LEAD_WINDOW_MS = 15 * 60 * 1000;
const submissions = new Map<string, number[]>();

/** Seconds until this client may submit another lead, or 0 (and the submission is counted). */
export function leadThrottle(key: string, now = Date.now()): number {
  const times = (submissions.get(key) ?? []).filter((t) => now - t < LEAD_WINDOW_MS);
  if (times.length >= LEAD_LIMIT) return Math.ceil((times[0] + LEAD_WINDOW_MS - now) / 1000);
  submissions.set(key, [...times, now]);
  if (submissions.size > 10_000) submissions.delete(submissions.keys().next().value!);
  return 0;
}

export const leadThrottleKey = (req: Request) => req.ip ?? '';

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

const canSeeAll = (viewer: User | null) => viewer === null || LEAD_MANAGER_ROLES.includes(viewer.role);

interface LeadRow {
  LeadId: number;
  FirstName: string;
  LastName: string;
  Email: string;
  Mobile: string;
  PreferredContact: ContactMethod;
  InterestCondition: Condition;
  UrgencyDays: number;
  Message: string | null;
  Source: LeadSource;
  Status: LeadStatus;
  AssignedToUserId: number | null;
  AssignedUsername: string | null;
  AssignedAt: Date | null;
  VehicleId: number | null;
  ModelYear: number | null;
  Make: string | null;
  Model: string | null;
  Price: number | null;
  StockNumber: string | null;
  FollowUps: number;
  NextFollowUpDue: Date | null;
  CreatedAt: Date;
  ClosedAt: Date | null;
  FileFirstName: string;
  FileLastName: string;
  FileMobile: string;
  FilePreferredContact: ContactMethod;
  CustomerSince: Date;
}

// Contact details come from the lead (as submitted); File* are the customer's first-enquiry details.
const SELECT_LEADS = `
  SELECT l.LeadId, l.FirstName, l.LastName, l.Email, l.Mobile, l.PreferredContact,
         c.FirstName AS FileFirstName, c.LastName AS FileLastName, c.Mobile AS FileMobile,
         c.PreferredContact AS FilePreferredContact, c.CreatedAt AS CustomerSince,
         l.InterestCondition, l.UrgencyDays, l.Message, l.Source, l.Status,
         l.AssignedToUserId, u.Username AS AssignedUsername, l.AssignedAt,
         l.VehicleId, v.ModelYear, v.Make, v.Model, v.Price, v.StockNumber,
         (SELECT COUNT(*) FROM dbo.LeadFollowUps f WHERE f.LeadId = l.LeadId) AS FollowUps,
         l.NextFollowUpDue, l.CreatedAt, l.ClosedAt
    FROM dbo.Leads l
    JOIN dbo.Customers c ON c.CustomerId = l.CustomerId
    LEFT JOIN dbo.Users u ON u.UserId = l.AssignedToUserId
    LEFT JOIN dbo.Vehicles v ON v.VehicleId = l.VehicleId`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const vehicleTitle = (r: LeadRow) => `${r.ModelYear} ${r.Make} ${r.Model}`;

function toSummary(r: LeadRow): LeadSummary {
  return {
    id: String(r.LeadId),
    customerName: `${r.FirstName} ${r.LastName}`,
    preferredContact: r.PreferredContact,
    interestCondition: r.InterestCondition,
    urgencyDays: r.UrgencyDays,
    source: r.Source,
    status: r.Status,
    assignedTo: r.AssignedToUserId ? { id: String(r.AssignedToUserId), username: r.AssignedUsername ?? '' } : null,
    vehicle: r.VehicleId ? { id: String(r.VehicleId), title: vehicleTitle(r) } : null,
    followUps: r.FollowUps,
    nextFollowUpDue: iso(r.NextFollowUpDue),
    createdAt: r.CreatedAt.toISOString(),
  };
}

/**
 * Stores the enquiry and returns the lead id. The customer (matched by email) is created on their first
 * enquiry and never changed afterwards; the lead keeps the details exactly as submitted, so a returning
 * customer's earlier enquiries are unaffected.
 */
export async function createLead(input: LeadInput, source: LeadSource): Promise<number> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('firstName', mssql.NVarChar(50), input.firstName)
    .input('lastName', mssql.NVarChar(50), input.lastName)
    .input('email', mssql.NVarChar(254), input.email)
    .input('mobile', mssql.VarChar(20), input.mobile)
    .input('preferredContact', mssql.VarChar(10), input.preferredContact)
    .input('consent', mssql.Bit, input.consent)
    .input('vehicleId', mssql.Int, input.vehicleId === null ? null : Number(input.vehicleId))
    .input('condition', mssql.NVarChar(20), input.interestCondition)
    .input('urgencyDays', mssql.Int, input.urgencyDays)
    .input('message', mssql.NVarChar(1000), input.message)
    .input('source', mssql.VarChar(10), source)
    .query<{ LeadId: number }>(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
        DECLARE @customerId INT;
        SELECT @customerId = CustomerId FROM dbo.Customers WITH (UPDLOCK, HOLDLOCK) WHERE Email = @email;
        IF @customerId IS NULL
        BEGIN
          INSERT INTO dbo.Customers (FirstName, LastName, Email, Mobile, PreferredContact, ContactConsent)
            VALUES (@firstName, @lastName, @email, @mobile, @preferredContact, @consent);
          SET @customerId = SCOPE_IDENTITY();
        END

        -- A vehicle that no longer exists (sold since the page loaded) is simply not linked.
        INSERT INTO dbo.Leads (CustomerId, FirstName, LastName, Email, Mobile, PreferredContact, ContactConsent,
                               VehicleId, InterestCondition, UrgencyDays, Message, Source)
          OUTPUT INSERTED.LeadId
          VALUES (@customerId, @firstName, @lastName, @email, @mobile, @preferredContact, @consent,
                  (SELECT VehicleId FROM dbo.Vehicles WHERE VehicleId = @vehicleId),
                  @condition, @urgencyDays, @message, @source);
      COMMIT TRANSACTION;`);
  return recordset[0].LeadId;
}

export interface LeadFilter {
  /** 'open' (default), 'closed', 'all', or one status. */
  status?: 'open' | 'closed' | 'all' | LeadStatus;
  /** 'me', 'none' (unassigned) or a user id. Ignored for sales reps, who only see their own leads. */
  assigned?: string;
  overdue?: boolean;
}

export const LEAD_LIST_LIMIT = 2000;

/** Newest first, at most LEAD_LIST_LIMIT. */
export async function listLeads(viewer: User, filter: LeadFilter = {}): Promise<LeadSummary[]> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const request = pool.request();
  const where: string[] = [];

  const status = filter.status ?? 'open';
  if (status === 'open') where.push(`l.Status NOT IN ('Won', 'Lost')`);
  else if (status === 'closed') where.push(`l.Status IN ('Won', 'Lost')`);
  else if (status !== 'all' && (LEAD_STATUSES as readonly string[]).includes(status)) {
    request.input('status', mssql.VarChar(20), status);
    where.push('l.Status = @status');
  }

  const assigned = canSeeAll(viewer) ? filter.assigned : 'me';
  if (assigned === 'none') where.push('l.AssignedToUserId IS NULL');
  else if (assigned === 'me' || (assigned && /^\d{1,9}$/.test(assigned))) {
    request.input('assignedTo', mssql.Int, assigned === 'me' ? Number(viewer.id) : Number(assigned));
    where.push('l.AssignedToUserId = @assignedTo');
  }

  if (filter.overdue) where.push(`l.NextFollowUpDue < SYSUTCDATETIME() AND l.Status NOT IN ('Won', 'Lost')`);

  const { recordset } = await request.query<LeadRow>(
    `${SELECT_LEADS.replace('SELECT', `SELECT TOP (${LEAD_LIST_LIMIT})`)}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.CreatedAt DESC, l.LeadId DESC`,
  );
  return recordset.map(toSummary);
}

/** The lead with its customer, follow-ups and notifications; null when missing or not visible to `viewer`. Pass null for system use. */
export async function getLead(id: number, viewer: User | null): Promise<Lead | null> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const result = await pool
    .request()
    .input('id', mssql.Int, id)
    .query(`
      ${SELECT_LEADS} WHERE l.LeadId = @id;
      SELECT f.Number, f.Method, f.Note, u.Username AS Author, f.CreatedAt
        FROM dbo.LeadFollowUps f JOIN dbo.Users u ON u.UserId = f.UserId
       WHERE f.LeadId = @id ORDER BY f.Number;
      SELECT Channel, Recipient, Status, Error, CreatedAt
        FROM dbo.LeadNotifications WHERE LeadId = @id ORDER BY CreatedAt DESC, NotificationId DESC;
      SELECT TOP (20) o.LeadId, o.Status, o.CreatedAt
        FROM dbo.Leads o
       WHERE o.CustomerId = (SELECT CustomerId FROM dbo.Leads WHERE LeadId = @id) AND o.LeadId <> @id
       ORDER BY o.CreatedAt DESC, o.LeadId DESC;`);
  const recordsets = result.recordsets as unknown as [LeadRow[], FollowUpRow[], NotificationRow[], OtherLeadRow[]];
  const row = recordsets[0][0];
  if (!row) return null;
  if (!canSeeAll(viewer) && String(row.AssignedToUserId) !== viewer!.id) return null;

  const onFile = {
    firstName: row.FileFirstName,
    lastName: row.FileLastName,
    mobile: row.FileMobile,
    preferredContact: row.FilePreferredContact,
  };
  const differs =
    onFile.firstName !== row.FirstName ||
    onFile.lastName !== row.LastName ||
    onFile.mobile !== row.Mobile ||
    onFile.preferredContact !== row.PreferredContact;

  return {
    returning: {
      customerSince: row.CustomerSince.toISOString(),
      otherLeads: recordsets[3].map((o) => ({ id: String(o.LeadId), status: o.Status, createdAt: o.CreatedAt.toISOString() })),
      onFile: differs ? onFile : null,
    },
    ...toSummary(row),
    customer: { firstName: row.FirstName, lastName: row.LastName, email: row.Email, mobile: row.Mobile },
    vehicle: row.VehicleId
      ? { id: String(row.VehicleId), title: vehicleTitle(row), price: Number(row.Price), stockNumber: row.StockNumber ?? '' }
      : null,
    message: row.Message,
    assignedAt: iso(row.AssignedAt),
    closedAt: iso(row.ClosedAt),
    followUpList: recordsets[1].map(
      (f): LeadFollowUp => ({ number: f.Number, method: f.Method, note: f.Note, author: f.Author, createdAt: f.CreatedAt.toISOString() }),
    ),
    notifications: recordsets[2].map(
      (n): LeadNotification => ({
        channel: n.Channel,
        recipient: n.Recipient,
        status: n.Status,
        error: n.Error,
        createdAt: n.CreatedAt.toISOString(),
      }),
    ),
  };
}

interface FollowUpRow {
  Number: number;
  Method: ContactMethod;
  Note: string;
  Author: string;
  CreatedAt: Date;
}

interface OtherLeadRow {
  LeadId: number;
  Status: LeadStatus;
  CreatedAt: Date;
}

interface NotificationRow {
  Channel: LeadNotification['channel'];
  Recipient: string;
  Status: LeadNotification['status'];
  Error: string | null;
  CreatedAt: Date;
}

export type LeadChange = 'ok' | 'not-found' | 'closed' | 'unassigned' | 'no-more-follow-ups' | 'bad-assignee';

/** Locks the lead row for the rest of the transaction and returns what the checks need. */
async function lockLead(tx: Transaction, id: number) {
  const mssql = await sql();
  const { recordset } = await tx
    .request()
    .input('id', mssql.Int, id)
    .query<{ Status: LeadStatus; AssignedToUserId: number | null; FollowUps: number }>(`
      SELECT l.Status, l.AssignedToUserId,
             (SELECT COUNT(*) FROM dbo.LeadFollowUps f WHERE f.LeadId = l.LeadId) AS FollowUps
        FROM dbo.Leads l WITH (UPDLOCK, HOLDLOCK)
       WHERE l.LeadId = @id`);
  return recordset[0] ?? null;
}

/**
 * Assigns (or reassigns) an open lead to a sales rep or manager. The 1st follow-up is due 2 days after
 * the lead arrived; reassigning keeps the follow-up progress and due date.
 */
export async function assignLead(id: number, assigneeId: number): Promise<LeadChange> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  return inTransaction(pool, async (tx) => {
    const lead = await lockLead(tx, id);
    if (!lead) return 'not-found';
    if (isClosed(lead.Status)) return 'closed';
    const { recordset } = await tx
      .request()
      .input('userId', mssql.Int, assigneeId)
      .query(`SELECT 1 AS ok FROM dbo.Users WHERE UserId = @userId AND IsActive = 1 AND Role IN ('sales', 'manager')`);
    if (!recordset[0]) return 'bad-assignee';
    await tx
      .request()
      .input('id', mssql.Int, id)
      .input('userId', mssql.Int, assigneeId)
      .input('days', mssql.Int, FOLLOW_UP_INTERVAL_DAYS)
      .query(`
        UPDATE dbo.Leads
           SET AssignedToUserId = @userId,
               AssignedAt = SYSUTCDATETIME(),
               NextFollowUpDue = CASE WHEN Status IN ('New', 'Assigned') THEN DATEADD(DAY, @days, CreatedAt) ELSE NextFollowUpDue END,
               Status = CASE WHEN Status = 'New' THEN 'Assigned' ELSE Status END
         WHERE LeadId = @id`);
    return 'ok';
  });
}

/**
 * Logs the next follow-up (1st, 2nd, then 3rd) by the assigned rep, or by a manager/admin.
 * The next one becomes due 2 days later; none after the 3rd.
 */
export async function logFollowUp(id: number, viewer: User, method: ContactMethod, note: string): Promise<LeadChange> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  return inTransaction(pool, async (tx) => {
    const lead = await lockLead(tx, id);
    if (!lead || (!canSeeAll(viewer) && String(lead.AssignedToUserId) !== viewer.id)) return 'not-found';
    if (isClosed(lead.Status)) return 'closed';
    if (lead.AssignedToUserId === null) return 'unassigned';
    if (lead.FollowUps >= MAX_FOLLOW_UPS) return 'no-more-follow-ups';
    const n = lead.FollowUps + 1;
    await tx
      .request()
      .input('id', mssql.Int, id)
      .input('n', mssql.TinyInt, n)
      .input('userId', mssql.Int, Number(viewer.id))
      .input('method', mssql.VarChar(10), method)
      .input('note', mssql.NVarChar(LEAD_NOTE_MAX_LENGTH), note.trim())
      .input('status', mssql.VarChar(20), followUpStatus(n))
      .input('days', mssql.Int, n < MAX_FOLLOW_UPS ? FOLLOW_UP_INTERVAL_DAYS : null)
      .query(`
        INSERT INTO dbo.LeadFollowUps (LeadId, Number, UserId, Method, Note) VALUES (@id, @n, @userId, @method, @note);
        UPDATE dbo.Leads
           SET Status = @status,
               NextFollowUpDue = CASE WHEN @days IS NULL THEN NULL ELSE DATEADD(DAY, @days, SYSUTCDATETIME()) END
         WHERE LeadId = @id;`);
    return 'ok';
  });
}

/** Marks an open lead Won or Lost (assigned rep, manager or admin). */
export async function closeLead(id: number, viewer: User, outcome: 'Won' | 'Lost'): Promise<LeadChange> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  return inTransaction(pool, async (tx) => {
    const lead = await lockLead(tx, id);
    if (!lead || (!canSeeAll(viewer) && String(lead.AssignedToUserId) !== viewer.id)) return 'not-found';
    if (isClosed(lead.Status)) return 'closed';
    await tx
      .request()
      .input('id', mssql.Int, id)
      .input('status', mssql.VarChar(20), outcome)
      .query('UPDATE dbo.Leads SET Status = @status, ClosedAt = SYSUTCDATETIME(), NextFollowUpDue = NULL WHERE LeadId = @id');
    return 'ok';
  });
}

/** Open, unassigned and overdue counts of the leads `viewer` can see. */
export async function leadCounts(viewer: User): Promise<LeadCounts> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const request = pool.request();
  let scope = '';
  if (!canSeeAll(viewer)) {
    request.input('userId', mssql.Int, Number(viewer.id));
    scope = 'AND AssignedToUserId = @userId';
  }
  const { recordset } = await request.query<LeadCounts>(`
    SELECT COUNT(*) AS [open],
           COALESCE(SUM(CASE WHEN AssignedToUserId IS NULL THEN 1 ELSE 0 END), 0) AS unassigned,
           COALESCE(SUM(CASE WHEN NextFollowUpDue < SYSUTCDATETIME() THEN 1 ELSE 0 END), 0) AS overdue
      FROM dbo.Leads
     WHERE Status NOT IN ('Won', 'Lost') ${scope}`);
  return recordset[0];
}

/** Active sales reps and managers, with how many open leads each has. */
export async function listSalesReps(): Promise<SalesRep[]> {
  const pool = await getPool();
  const { recordset } = await pool.request().query<{ UserId: number; Username: string; Role: SalesRep['role']; OpenLeads: number }>(`
    SELECT u.UserId, u.Username, u.Role,
           (SELECT COUNT(*) FROM dbo.Leads l WHERE l.AssignedToUserId = u.UserId AND l.Status NOT IN ('Won', 'Lost')) AS OpenLeads
      FROM dbo.Users u
     WHERE u.IsActive = 1 AND u.Role IN ('sales', 'manager')
     ORDER BY CASE u.Role WHEN 'sales' THEN 0 ELSE 1 END, u.Username`);
  return recordset.map((r) => ({ id: String(r.UserId), username: r.Username, role: r.Role, openLeads: r.OpenLeads }));
}
