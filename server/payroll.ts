import type { ConnectionPool, Transaction } from 'mssql';
import { getPool, sql } from './db.ts';
import { inTransaction } from './vehicles.ts';
import {
  DEALER_TIME_ZONE,
  addDays,
  csvField,
  periodFor,
  periodSalaryCents,
  toCents,
  toDollars,
  today,
  weekStart,
  type PlanInput,
} from './accounting.ts';
import type {
  CompPlan,
  EarningEntry,
  EarningType,
  PayPeriod,
  PayStatement,
  PersonRef,
  Role,
  StaffMember,
  User,
  WeeklyFigures,
  WeeklyStats,
} from '../src/types.ts';

/**
 * Bi-weekly pay: periods, the append-only earnings ledger (dbo.EarningEntries), statements, closing a period,
 * adjustments, CSV export, weekly stats and the admin compensation setup. Rules are in server/accounting.ts.
 *
 * Pay visibility: everyone sees their own pay; managers also see their reps' (Users.ManagerUserId);
 * admins see everyone's. Anything else is reported as not found.
 */

type Db = ConnectionPool | Transaction;
const req = (db: Db) => db.request();

const dateStr = (column: string) => `CONVERT(char(10), ${column}, 23)`;

// --- People and visibility ----------------------------------------------------------------------

interface PersonRow {
  UserId: number;
  Username: string;
  Role: Role;
  ManagerUserId: number | null;
  IsActive: boolean;
}

export async function getPerson(db: Db, userId: number): Promise<PersonRow | null> {
  const mssql = await sql();
  const { recordset } = await req(db)
    .input('id', mssql.Int, userId)
    .query<PersonRow>('SELECT UserId, Username, Role, ManagerUserId, IsActive FROM dbo.Users WHERE UserId = @id');
  return recordset[0] ?? null;
}

/** Whether `viewer` may see `userId`'s pay: themselves, their manager, or an admin. */
export async function canSeePay(viewer: User, userId: number): Promise<boolean> {
  if (viewer.role === 'admin' || viewer.id === String(userId)) return true;
  if (viewer.role !== 'manager') return false;
  const person = await getPerson(await getPool(), userId);
  return person?.ManagerUserId === Number(viewer.id);
}

/** People whose pay/stats `viewer` sees for a scope: 'me', 'team' (manager: self + reps), 'all' (admin). */
async function peopleInScope(viewer: User, scope: 'me' | 'team' | 'all'): Promise<PersonRow[]> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const request = pool.request().input('me', mssql.Int, Number(viewer.id));
  let where = 'u.UserId = @me';
  if (scope === 'team' && (viewer.role === 'manager' || viewer.role === 'admin')) where = '(u.UserId = @me OR u.ManagerUserId = @me)';
  if (scope === 'all' && viewer.role === 'admin') where = `u.Role IN ('sales', 'manager') OR u.UserId = @me`;
  const { recordset } = await request.query<PersonRow>(`
    SELECT u.UserId, u.Username, u.Role, u.ManagerUserId, u.IsActive
      FROM dbo.Users u
     WHERE (${where}) AND (u.IsActive = 1 OR u.UserId = @me)
     ORDER BY CASE u.Role WHEN 'manager' THEN 0 WHEN 'sales' THEN 1 ELSE 2 END, u.Username`);
  return recordset;
}

// --- Periods --------------------------------------------------------------------------------------

/** Creates the period starting at `start` if it doesn't exist yet. */
async function ensurePeriod(db: Db, start: string): Promise<void> {
  const mssql = await sql();
  await req(db)
    .input('start', mssql.Date, start)
    .input('end', mssql.Date, addDays(start, 13))
    .query(`IF NOT EXISTS (SELECT 1 FROM dbo.PayPeriods WHERE PeriodStart = @start)
              INSERT INTO dbo.PayPeriods (PeriodStart, PeriodEnd) VALUES (@start, @end);`);
}

/**
 * The open period an entry dated `date` goes into: the period containing `date` if it is still open,
 * otherwise the first open period after it (closed periods accept no new entries).
 */
export async function entryPeriod(db: Db, date: string): Promise<string> {
  const mssql = await sql();
  let start = periodFor(date).start;
  for (let i = 0; i < 520; i++) {
    await ensurePeriod(db, start);
    const { recordset } = await req(db)
      .input('start', mssql.Date, start)
      .query<{ Status: string }>('SELECT Status FROM dbo.PayPeriods WITH (UPDLOCK, HOLDLOCK) WHERE PeriodStart = @start');
    if (recordset[0]?.Status === 'Open') return start;
    start = addDays(start, 14);
  }
  throw new Error('No open pay period found');
}

interface PeriodRow {
  PeriodStart: string;
  PeriodEnd: string;
  Status: 'Open' | 'Closed';
  ClosedAt: Date | null;
}

const toPeriod = (r: PeriodRow): PayPeriod => ({
  start: r.PeriodStart,
  end: r.PeriodEnd,
  status: r.Status,
  closedAt: r.ClosedAt ? r.ClosedAt.toISOString() : null,
});

const SELECT_PERIODS = `SELECT ${dateStr('PeriodStart')} AS PeriodStart, ${dateStr('PeriodEnd')} AS PeriodEnd, Status, ClosedAt FROM dbo.PayPeriods`;

/** Newest first: the current period plus up to 25 earlier ones that exist. */
export async function listPeriods(): Promise<PayPeriod[]> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const current = periodFor(today()).start;
  await ensurePeriod(pool, current);
  const { recordset } = await pool
    .request()
    .input('current', mssql.Date, current)
    .query<PeriodRow>(`SELECT TOP (26) * FROM (${SELECT_PERIODS}) p WHERE p.PeriodStart <= @current ORDER BY p.PeriodStart DESC`);
  return recordset.map(toPeriod);
}

async function getPeriod(db: Db, start: string): Promise<PayPeriod | null> {
  const mssql = await sql();
  const { recordset } = await req(db).input('start', mssql.Date, start).query<PeriodRow>(`${SELECT_PERIODS} WHERE PeriodStart = @start`);
  return recordset[0] ? toPeriod(recordset[0]) : null;
}

// --- Salaries -----------------------------------------------------------------------------------

/** Annual salary in cents in effect on `date`, or null when none is set. */
async function salaryOn(db: Db, userId: number, date: string): Promise<number | null> {
  const mssql = await sql();
  const { recordset } = await req(db)
    .input('id', mssql.Int, userId)
    .input('date', mssql.Date, date)
    .query<{ AnnualSalary: number }>(
      'SELECT TOP (1) AnnualSalary FROM dbo.EmployeeSalaries WHERE UserId = @id AND EffectiveFrom <= @date ORDER BY EffectiveFrom DESC',
    );
  return recordset[0] ? toCents(recordset[0].AnnualSalary) : null;
}

// --- Statements -----------------------------------------------------------------------------------

interface EntryRow {
  EntryId: number;
  Type: EarningType;
  Amount: number;
  SaleId: number | null;
  SaleTitle: string | null;
  Note: string | null;
  CreatedAt: Date;
}

function totalsOf(lines: EarningEntry[]) {
  const sum = (types: EarningType[]) => lines.filter((l) => types.includes(l.type)).reduce((s, l) => s + toCents(l.amount), 0);
  const salary = sum(['Salary']);
  const perks = sum(['Perk', 'PerkReversal']);
  const overrides = sum(['Override', 'OverrideReversal']);
  const adjustments = sum(['Adjustment']);
  return {
    salary: toDollars(salary),
    perks: toDollars(perks),
    overrides: toDollars(overrides),
    adjustments: toDollars(adjustments),
    total: toDollars(salary + perks + overrides + adjustments),
  };
}

/** A person's statement for a period. Open periods include a projected salary line. Null if no such period. */
export async function statement(userId: number, periodStart: string): Promise<PayStatement | null> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  if (periodFor(periodStart).start !== periodStart) return null;
  if (periodStart <= periodFor(today()).start) await ensurePeriod(pool, periodStart);
  const period = await getPeriod(pool, periodStart);
  const person = await getPerson(pool, userId);
  if (!period || !person) return null;

  const { recordset } = await pool
    .request()
    .input('id', mssql.Int, userId)
    .input('start', mssql.Date, periodStart)
    .query<EntryRow>(`
      SELECT e.EntryId, e.Type, e.Amount, e.SaleId, e.Note, e.CreatedAt,
             CASE WHEN v.VehicleId IS NULL THEN NULL
                  ELSE CONCAT(v.ModelYear, ' ', v.Make, ' ', v.Model, ' (', v.StockNumber, ')') END AS SaleTitle
        FROM dbo.EarningEntries e
        LEFT JOIN dbo.Sales s ON s.SaleId = e.SaleId
        LEFT JOIN dbo.Vehicles v ON v.VehicleId = s.VehicleId
       WHERE e.UserId = @id AND e.PeriodStart = @start
       ORDER BY e.CreatedAt, e.EntryId`);
  const lines: EarningEntry[] = recordset.map((r) => ({
    id: String(r.EntryId),
    type: r.Type,
    amount: Number(r.Amount),
    saleId: r.SaleId ? String(r.SaleId) : null,
    saleTitle: r.SaleTitle,
    note: r.Note,
    createdAt: r.CreatedAt.toISOString(),
  }));

  const preview = period.status === 'Open';
  if (preview) {
    const annual = await salaryOn(pool, userId, periodStart);
    if (annual !== null && annual > 0) {
      lines.unshift({
        id: 'projected-salary',
        type: 'Salary',
        amount: toDollars(periodSalaryCents(annual)),
        saleId: null,
        saleTitle: null,
        note: `Base salary ($${toDollars(annual).toLocaleString('en-US')}/yr ÷ 26), added when the period closes`,
        createdAt: `${periodStart}T00:00:00.000Z`,
        projected: true,
      });
    }
  }
  return {
    user: { id: String(person.UserId), username: person.Username, role: person.Role },
    period,
    lines,
    totals: totalsOf(lines),
    preview,
  };
}

/** Statements (totals) of everyone in the viewer's scope for a period: managers → self + team, admins → all. */
export async function teamStatements(viewer: User, periodStart: string, scope: 'team' | 'all'): Promise<PayStatement[]> {
  const people = await peopleInScope(viewer, scope);
  const out: PayStatement[] = [];
  for (const p of people) {
    const s = await statement(p.UserId, periodStart);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Closes a period that has ended: adds each active salaried person's Salary entry and locks the period.
 * Returns 'ok', 'not-found', 'closed' (already) or 'not-ended'.
 */
export async function closePeriod(periodStart: string, admin: User): Promise<'ok' | 'not-found' | 'closed' | 'not-ended'> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  if (periodFor(periodStart).start !== periodStart) return 'not-found';
  if (addDays(periodStart, 13) >= today()) return 'not-ended';
  return inTransaction(pool, async (tx) => {
    await ensurePeriod(tx, periodStart);
    const { recordset } = await tx
      .request()
      .input('start', mssql.Date, periodStart)
      .query<{ Status: string }>('SELECT Status FROM dbo.PayPeriods WITH (UPDLOCK, HOLDLOCK) WHERE PeriodStart = @start');
    if (recordset[0].Status === 'Closed') return 'closed';

    const salaried = await tx
      .request()
      .input('start', mssql.Date, periodStart)
      .query<{ UserId: number; AnnualSalary: number }>(`
        SELECT u.UserId, s.AnnualSalary
          FROM dbo.Users u
         CROSS APPLY (SELECT TOP (1) AnnualSalary FROM dbo.EmployeeSalaries es
                       WHERE es.UserId = u.UserId AND es.EffectiveFrom <= @start ORDER BY es.EffectiveFrom DESC) s
         WHERE u.IsActive = 1 AND s.AnnualSalary > 0`);
    for (const row of salaried.recordset) {
      const annual = toCents(row.AnnualSalary);
      await tx
        .request()
        .input('user', mssql.Int, row.UserId)
        .input('start', mssql.Date, periodStart)
        .input('amount', mssql.Decimal(12, 2), toDollars(periodSalaryCents(annual)))
        .input('note', mssql.NVarChar(300), `Base salary ($${toDollars(annual).toLocaleString('en-US')}/yr ÷ 26)`)
        .input('by', mssql.Int, Number(admin.id))
        .query(`INSERT INTO dbo.EarningEntries (UserId, PeriodStart, Type, Amount, Note, CreatedByUserId)
                VALUES (@user, @start, 'Salary', @amount, @note, @by)`);
    }
    await tx
      .request()
      .input('start', mssql.Date, periodStart)
      .input('by', mssql.Int, Number(admin.id))
      .query(`UPDATE dbo.PayPeriods SET Status = 'Closed', ClosedByUserId = @by, ClosedAt = SYSUTCDATETIME() WHERE PeriodStart = @start`);
    return 'ok';
  });
}

/** Admin adjustment (+ or −) in the current open period. Returns the period it went into, or null if no such user. */
export async function addAdjustment(admin: User, userId: number, amountCents: number, note: string): Promise<string | null> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  if (!(await getPerson(pool, userId))) return null;
  return inTransaction(pool, async (tx) => {
    const start = await entryPeriod(tx, today());
    await tx
      .request()
      .input('user', mssql.Int, userId)
      .input('start', mssql.Date, start)
      .input('amount', mssql.Decimal(12, 2), toDollars(amountCents))
      .input('note', mssql.NVarChar(300), note.trim())
      .input('by', mssql.Int, Number(admin.id))
      .query(`INSERT INTO dbo.EarningEntries (UserId, PeriodStart, Type, Amount, Note, CreatedByUserId)
              VALUES (@user, @start, 'Adjustment', @amount, @note, @by)`);
    return start;
  });
}

/** CSV of every statement in a period (admins). */
export async function exportCsv(admin: User, periodStart: string): Promise<string | null> {
  const statements = await teamStatements(admin, periodStart, 'all');
  if (statements.length === 0 && !(await getPeriod(await getPool(), periodStart))) return null;
  const header = ['Username', 'Role', 'Period start', 'Period end', 'Status', 'Salary', 'Perks', 'Overrides', 'Adjustments', 'Total'];
  const rows = statements
    .filter((s) => s.lines.length > 0)
    .map((s) => [
      s.user.username,
      s.user.role,
      s.period.start,
      s.period.end,
      s.preview ? 'Preview (open)' : 'Final',
      s.totals.salary.toFixed(2),
      s.totals.perks.toFixed(2),
      s.totals.overrides.toFixed(2),
      s.totals.adjustments.toFixed(2),
      s.totals.total.toFixed(2),
    ]);
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

// --- Weekly stats ---------------------------------------------------------------------------------

const emptyFigures = (): WeeklyFigures => ({ units: 0, revenue: 0, perks: 0, overrides: 0, pending: 0, leadsAssigned: 0, followUps: 0, leadsWon: 0 });

function addFigures(a: WeeklyFigures, b: WeeklyFigures): WeeklyFigures {
  return {
    units: a.units + b.units,
    revenue: toDollars(toCents(a.revenue) + toCents(b.revenue)),
    perks: toDollars(toCents(a.perks) + toCents(b.perks)),
    overrides: toDollars(toCents(a.overrides) + toCents(b.overrides)),
    pending: a.pending + b.pending,
    leadsAssigned: a.leadsAssigned + b.leadsAssigned,
    followUps: a.followUps + b.followUps,
    leadsWon: a.leadsWon + b.leadsWon,
  };
}

/** Units, revenue, perks/overrides and lead activity per person per week (Mon–Sun), oldest week first. */
export async function weeklyStats(viewer: User, scope: 'me' | 'team' | 'all', weekCount: number): Promise<WeeklyStats> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const people = await peopleInScope(viewer, scope);
  const thisWeek = weekStart(today());
  const weeks = Array.from({ length: weekCount }, (_, i) => addDays(thisWeek, -7 * (weekCount - 1 - i)));
  const from = weeks[0];
  const ids = people.map((p) => p.UserId);
  const index = new Map(weeks.map((w, i) => [w, i]));
  const figures = new Map(ids.map((id) => [id, weeks.map(emptyFigures)]));
  const bump = (userId: number, date: string, f: (x: WeeklyFigures) => void) => {
    const i = index.get(weekStart(date));
    const row = figures.get(userId);
    if (i !== undefined && row) f(row[i]);
  };
  // Timestamps are UTC; weeks are dealership-local dates.
  const local = (d: Date) => today(DEALER_TIME_ZONE, d);

  if (ids.length > 0) {
    const request = pool.request().input('from', mssql.Date, from).input('fromTs', mssql.DateTime2, new Date(`${addDays(from, -1)}T00:00:00Z`));
    // One parameter per person (never concatenated values), collected into a table variable.
    ids.forEach((id, i) => request.input(`id${i}`, mssql.Int, id));
    const values = ids.map((_, i) => `(@id${i})`).join(', ');
    const result = await request.query(`
      DECLARE @ids TABLE (Id INT PRIMARY KEY);
      INSERT INTO @ids (Id) VALUES ${values};
      SELECT SoldByUserId AS UserId, ${dateStr('SaleDate')} AS D, Status, SalePrice
        FROM dbo.Sales WHERE SaleDate >= @from AND Status IN ('Approved', 'Pending') AND SoldByUserId IN (SELECT Id FROM @ids);
      SELECT UserId, Type, Amount, CreatedAt FROM dbo.EarningEntries
       WHERE CreatedAt >= @fromTs AND Type IN ('Perk', 'PerkReversal', 'Override', 'OverrideReversal') AND UserId IN (SELECT Id FROM @ids);
      SELECT AssignedToUserId AS UserId, AssignedAt, Status, ClosedAt FROM dbo.Leads
       WHERE AssignedToUserId IN (SELECT Id FROM @ids) AND (AssignedAt >= @fromTs OR ClosedAt >= @fromTs);
      SELECT UserId, CreatedAt FROM dbo.LeadFollowUps WHERE CreatedAt >= @fromTs AND UserId IN (SELECT Id FROM @ids);`);
    const [sales, entries, leads, followUps] = result.recordsets as unknown as [
      { UserId: number; D: string; Status: string; SalePrice: number }[],
      { UserId: number; Type: EarningType; Amount: number; CreatedAt: Date }[],
      { UserId: number; AssignedAt: Date | null; Status: string; ClosedAt: Date | null }[],
      { UserId: number; CreatedAt: Date }[],
    ];
    for (const s of sales) {
      bump(s.UserId, s.D, (x) => {
        if (s.Status === 'Approved') {
          x.units++;
          x.revenue = toDollars(toCents(x.revenue) + toCents(s.SalePrice));
        } else x.pending++;
      });
    }
    for (const e of entries) {
      bump(e.UserId, local(e.CreatedAt), (x) => {
        if (e.Type === 'Perk' || e.Type === 'PerkReversal') x.perks = toDollars(toCents(x.perks) + toCents(e.Amount));
        else x.overrides = toDollars(toCents(x.overrides) + toCents(e.Amount));
      });
    }
    for (const l of leads) {
      if (l.AssignedAt) bump(l.UserId, local(l.AssignedAt), (x) => x.leadsAssigned++);
      if (l.Status === 'Won' && l.ClosedAt) bump(l.UserId, local(l.ClosedAt), (x) => x.leadsWon++);
    }
    for (const f of followUps) bump(f.UserId, local(f.CreatedAt), (x) => x.followUps++);
  }

  const rows = people.map((p) => {
    const byWeek = figures.get(p.UserId)!;
    return {
      user: { id: String(p.UserId), username: p.Username, role: p.Role },
      managerId: p.ManagerUserId ? String(p.ManagerUserId) : null,
      byWeek,
      total: byWeek.reduce(addFigures, emptyFigures()),
    };
  });
  const totals = weeks.map((_, i) => rows.reduce((acc, r) => addFigures(acc, r.byWeek[i]), emptyFigures()));
  return { weeks, people: rows, totals };
}

// --- Admin: plans, salaries, teams ----------------------------------------------------------------

export async function listPlans(): Promise<CompPlan[]> {
  const pool = await getPool();
  const { recordset } = await pool.request().query<{ PlanId: number; EffectiveFrom: string; ManagerOverride: number; FromUnit: number; PerVehicle: number }>(`
    SELECT p.PlanId, ${dateStr('p.EffectiveFrom')} AS EffectiveFrom, p.ManagerOverride, t.FromUnit, t.PerVehicle
      FROM dbo.CompPlans p JOIN dbo.CompPlanTiers t ON t.PlanId = p.PlanId
     ORDER BY p.EffectiveFrom DESC, t.FromUnit`);
  const plans = new Map<number, CompPlan>();
  for (const r of recordset) {
    let plan = plans.get(r.PlanId);
    if (!plan) {
      plan = { id: String(r.PlanId), effectiveFrom: r.EffectiveFrom, managerOverride: Number(r.ManagerOverride), tiers: [] };
      plans.set(r.PlanId, plan);
    }
    plan.tiers.push({ fromUnit: r.FromUnit, perVehicle: Number(r.PerVehicle) });
  }
  return [...plans.values()];
}

/** Adds a plan version. Returns false when one already starts on that date. */
export async function createPlan(admin: User, plan: PlanInput): Promise<boolean> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  try {
    await inTransaction(pool, async (tx) => {
      const { recordset } = await tx
        .request()
        .input('from', mssql.Date, plan.effectiveFrom)
        .input('override', mssql.Decimal(12, 2), toDollars(plan.managerOverrideCents))
        .input('by', mssql.Int, Number(admin.id))
        .query<{ PlanId: number }>(`INSERT INTO dbo.CompPlans (EffectiveFrom, ManagerOverride, CreatedByUserId)
                                    OUTPUT INSERTED.PlanId VALUES (@from, @override, @by)`);
      for (const t of plan.tiers) {
        await tx
          .request()
          .input('plan', mssql.Int, recordset[0].PlanId)
          .input('from', mssql.Int, t.fromUnit)
          .input('amount', mssql.Decimal(12, 2), toDollars(t.perVehicleCents))
          .query('INSERT INTO dbo.CompPlanTiers (PlanId, FromUnit, PerVehicle) VALUES (@plan, @from, @amount)');
      }
    });
    return true;
  } catch (err) {
    if ((err as { number?: number }).number === 2627 || (err as { number?: number }).number === 2601) return false;
    throw err;
  }
}

/** Sales reps, managers and admins with their manager and current salary. */
export async function listStaff(): Promise<StaffMember[]> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('today', mssql.Date, today())
    .query<PersonRow & { ManagerName: string | null; AnnualSalary: number | null; SalaryFrom: string | null }>(`
      SELECT u.UserId, u.Username, u.Role, u.IsActive, u.ManagerUserId, m.Username AS ManagerName,
             s.AnnualSalary, ${dateStr('s.EffectiveFrom')} AS SalaryFrom
        FROM dbo.Users u
        LEFT JOIN dbo.Users m ON m.UserId = u.ManagerUserId
        OUTER APPLY (SELECT TOP (1) AnnualSalary, EffectiveFrom FROM dbo.EmployeeSalaries es
                      WHERE es.UserId = u.UserId ORDER BY es.EffectiveFrom DESC) s
       WHERE u.Role IN ('admin', 'manager', 'sales')
       ORDER BY CASE u.Role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.Username`);
  return recordset.map((r) => ({
    id: String(r.UserId),
    username: r.Username,
    role: r.Role,
    isActive: r.IsActive,
    manager: r.ManagerUserId ? ({ id: String(r.ManagerUserId), username: r.ManagerName ?? '' } satisfies PersonRef) : null,
    annualSalary: r.AnnualSalary === null ? null : Number(r.AnnualSalary),
    salaryFrom: r.SalaryFrom,
  }));
}

/** Sets (or replaces, for the same date) an annual salary from `effectiveFrom`. False if no such staff member. */
export async function setSalary(admin: User, userId: number, annualCents: number, effectiveFrom: string): Promise<boolean> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const person = await getPerson(pool, userId);
  if (!person || !['admin', 'manager', 'sales'].includes(person.Role)) return false;
  await pool
    .request()
    .input('user', mssql.Int, userId)
    .input('from', mssql.Date, effectiveFrom)
    .input('amount', mssql.Decimal(12, 2), toDollars(annualCents))
    .input('by', mssql.Int, Number(admin.id))
    .query(`
      MERGE dbo.EmployeeSalaries WITH (HOLDLOCK) AS t
      USING (SELECT @user AS UserId, @from AS EffectiveFrom) AS s ON t.UserId = s.UserId AND t.EffectiveFrom = s.EffectiveFrom
      WHEN MATCHED THEN UPDATE SET AnnualSalary = @amount, CreatedByUserId = @by, CreatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (UserId, EffectiveFrom, AnnualSalary, CreatedByUserId) VALUES (@user, @from, @amount, @by);`);
  return true;
}

/** Assigns a sales rep to a manager (or none). */
export async function setManager(repId: number, managerId: number | null): Promise<'ok' | 'not-found' | 'not-a-rep' | 'bad-manager'> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const rep = await getPerson(pool, repId);
  if (!rep) return 'not-found';
  if (rep.Role !== 'sales') return 'not-a-rep';
  if (managerId !== null) {
    const manager = await getPerson(pool, managerId);
    if (!manager || manager.Role !== 'manager' || !manager.IsActive) return 'bad-manager';
  }
  await pool
    .request()
    .input('rep', mssql.Int, repId)
    .input('manager', mssql.Int, managerId)
    .query('UPDATE dbo.Users SET ManagerUserId = @manager WHERE UserId = @rep');
  return 'ok';
}
