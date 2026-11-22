import type { Transaction } from 'mssql';
import { getPool, sql } from './db.ts';
import { inTransaction } from './vehicles.ts';
import { entryPeriod, getPerson } from './payroll.ts';
import { monthRange, ordinal, tierAmountCents, toCents, toDollars, today, type SaleInput, type Tier } from './accounting.ts';
import type { Condition, Role, Sale, SaleStatus, User } from '../src/types.ts';

/**
 * Vehicle sales. A rep (or manager/admin) records a sale → Pending, and the vehicle becomes SalePending.
 * The seller's manager (or an admin) approves it → Approved: the perk (tiered, marginal, by the seller's nth
 * approved sale in the sale's month) and the manager's override are written to the earnings ledger, the vehicle
 * becomes Sold and a linked lead Won. Reject → the vehicle is Available again. An admin can void an approved
 * sale: reversal entries go into the current open period and the vehicle is Available again.
 * Nobody approves, rejects or voids their own sale.
 *
 * Visibility: admins see all sales; managers their own and their reps'; reps their own. Others → not found.
 */

interface SaleRow {
  SaleId: number;
  VehicleId: number;
  ModelYear: number;
  Make: string;
  Model: string;
  StockNumber: string;
  Condition: Condition;
  LeadId: number | null;
  BuyerName: string;
  ListPrice: number;
  SalePrice: number;
  SaleDate: string;
  SoldByUserId: number;
  SoldByName: string;
  SoldByRole: Role;
  SellerManagerId: number | null;
  ManagerUserId: number | null;
  ManagerName: string | null;
  Status: SaleStatus;
  MonthUnit: number | null;
  Notes: string | null;
  SubmittedAt: Date;
  DecidedByName: string | null;
  DecidedAt: Date | null;
  RejectReason: string | null;
  VoidedAt: Date | null;
  VoidReason: string | null;
  Perk: number | null;
  Override: number | null;
}

const SELECT_SALES = `
  SELECT s.SaleId, s.VehicleId, v.ModelYear, v.Make, v.Model, v.StockNumber, v.Condition, s.LeadId, s.BuyerName,
         s.ListPrice, s.SalePrice, CONVERT(char(10), s.SaleDate, 23) AS SaleDate,
         s.SoldByUserId, su.Username AS SoldByName, su.Role AS SoldByRole, su.ManagerUserId AS SellerManagerId,
         s.ManagerUserId, mu.Username AS ManagerName, s.Status, s.MonthUnit, s.Notes, s.SubmittedAt,
         du.Username AS DecidedByName, s.DecidedAt, s.RejectReason, s.VoidedAt, s.VoidReason,
         (SELECT SUM(e.Amount) FROM dbo.EarningEntries e WHERE e.SaleId = s.SaleId AND e.Type IN ('Perk', 'PerkReversal')) AS Perk,
         (SELECT SUM(e.Amount) FROM dbo.EarningEntries e WHERE e.SaleId = s.SaleId AND e.Type IN ('Override', 'OverrideReversal')) AS Override
    FROM dbo.Sales s
    JOIN dbo.Vehicles v ON v.VehicleId = s.VehicleId
    JOIN dbo.Users su ON su.UserId = s.SoldByUserId
    LEFT JOIN dbo.Users mu ON mu.UserId = s.ManagerUserId
    LEFT JOIN dbo.Users du ON du.UserId = s.DecidedByUserId`;

/** SQL condition: sales `@me` may see (admins: all). */
const visibleTo = (viewer: User) =>
  viewer.role === 'admin'
    ? '1 = 1'
    : viewer.role === 'manager'
      ? '(s.SoldByUserId = @me OR su.ManagerUserId = @me OR s.ManagerUserId = @me)'
      : 's.SoldByUserId = @me';

/** Approve/reject: the seller's current manager or an admin, never the seller. */
const mayDecide = (viewer: User, sellerId: number, sellerManagerId: number | null) =>
  String(sellerId) !== viewer.id && (viewer.role === 'admin' || (viewer.role === 'manager' && String(sellerManagerId) === viewer.id));

function toSale(r: SaleRow, viewer: User): Sale {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: String(r.SaleId),
    vehicle: { id: String(r.VehicleId), title: `${r.ModelYear} ${r.Make} ${r.Model}`, stockNumber: r.StockNumber, condition: r.Condition },
    leadId: r.LeadId ? String(r.LeadId) : null,
    buyerName: r.BuyerName,
    listPrice: Number(r.ListPrice),
    salePrice: Number(r.SalePrice),
    saleDate: r.SaleDate,
    soldBy: { id: String(r.SoldByUserId), username: r.SoldByName, role: r.SoldByRole },
    manager: r.ManagerUserId ? { id: String(r.ManagerUserId), username: r.ManagerName ?? '' } : null,
    status: r.Status,
    monthUnit: r.MonthUnit,
    perk: r.Status === 'Pending' || r.Status === 'Rejected' ? null : Number(r.Perk ?? 0),
    override: r.Status === 'Pending' || r.Status === 'Rejected' || r.ManagerUserId === null ? null : Number(r.Override ?? 0),
    notes: r.Notes,
    submittedAt: r.SubmittedAt.toISOString(),
    decidedBy: r.DecidedByName,
    decidedAt: iso(r.DecidedAt),
    rejectReason: r.RejectReason,
    voidedAt: iso(r.VoidedAt),
    voidReason: r.VoidReason,
    canDecide: r.Status === 'Pending' && mayDecide(viewer, r.SoldByUserId, r.SellerManagerId),
    canVoid: r.Status === 'Approved' && viewer.role === 'admin' && String(r.SoldByUserId) !== viewer.id,
  };
}

export interface SaleFilter {
  status?: SaleStatus;
  /** 'mine' = sold by me; 'decide' = pending sales I can approve; default = everything visible. */
  view?: 'mine' | 'decide';
}

export async function listSales(viewer: User, filter: SaleFilter = {}): Promise<Sale[]> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const request = pool.request().input('me', mssql.Int, Number(viewer.id));
  const where = [visibleTo(viewer)];
  if (filter.status) {
    request.input('status', mssql.VarChar(10), filter.status);
    where.push('s.Status = @status');
  }
  if (filter.view === 'mine') where.push('s.SoldByUserId = @me');
  if (filter.view === 'decide') {
    where.push(`s.Status = 'Pending' AND s.SoldByUserId <> @me`);
    if (viewer.role !== 'admin') where.push('su.ManagerUserId = @me');
  }
  const { recordset } = await request.query<SaleRow>(
    `${SELECT_SALES.replace('SELECT', 'SELECT TOP (1000)')} WHERE ${where.join(' AND ')} ORDER BY s.SaleDate DESC, s.SaleId DESC`,
  );
  return recordset.map((r) => toSale(r, viewer));
}

export async function getSale(id: number, viewer: User): Promise<Sale | null> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('id', mssql.Int, id)
    .input('me', mssql.Int, Number(viewer.id))
    .query<SaleRow>(`${SELECT_SALES} WHERE s.SaleId = @id AND ${visibleTo(viewer)}`);
  return recordset[0] ? toSale(recordset[0], viewer) : null;
}

/** Pending sales the viewer can approve (for the badge). */
export async function pendingApprovalCount(viewer: User): Promise<number> {
  if (viewer.role !== 'admin' && viewer.role !== 'manager') return 0;
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('me', mssql.Int, Number(viewer.id))
    .query<{ n: number }>(`
      SELECT COUNT(*) AS n FROM dbo.Sales s JOIN dbo.Users su ON su.UserId = s.SoldByUserId
       WHERE s.Status = 'Pending' AND s.SoldByUserId <> @me ${viewer.role === 'admin' ? '' : 'AND su.ManagerUserId = @me'}`);
  return recordset[0].n;
}

// --- Plans ----------------------------------------------------------------------------------------

/** The commission plan in effect on `date` (by approval date). */
async function planOn(tx: Transaction, date: string): Promise<{ planId: number; overrideCents: number; tiers: Tier[] }> {
  const mssql = await sql();
  const { recordset } = await tx
    .request()
    .input('date', mssql.Date, date)
    .query<{ PlanId: number; ManagerOverride: number; FromUnit: number; PerVehicle: number }>(`
      SELECT p.PlanId, p.ManagerOverride, t.FromUnit, t.PerVehicle
        FROM dbo.CompPlanTiers t
        JOIN (SELECT TOP (1) PlanId, ManagerOverride FROM dbo.CompPlans WHERE EffectiveFrom <= @date ORDER BY EffectiveFrom DESC) p
          ON p.PlanId = t.PlanId`);
  if (recordset.length === 0) throw new Error('No commission plan is in effect; add one on the Compensation page');
  return {
    planId: recordset[0].PlanId,
    overrideCents: toCents(recordset[0].ManagerOverride),
    tiers: recordset.map((r) => ({ fromUnit: r.FromUnit, perVehicleCents: toCents(r.PerVehicle) })),
  };
}

/** Approved, not-voided sales by `sellerId` in the calendar month of `saleDate`. */
async function approvedInMonth(db: Transaction | Awaited<ReturnType<typeof getPool>>, sellerId: number, saleDate: string): Promise<number> {
  const mssql = await sql();
  const { first, last } = monthRange(saleDate);
  const { recordset } = await db
    .request()
    .input('seller', mssql.Int, sellerId)
    .input('first', mssql.Date, first)
    .input('last', mssql.Date, last)
    .query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.Sales
                            WHERE SoldByUserId = @seller AND Status = 'Approved' AND SaleDate BETWEEN @first AND @last`);
  return recordset[0].n;
}

/** What the viewer would earn for a sale dated `saleDate` if it were approved now (an estimate). */
export async function estimatePerk(viewer: User, saleDate: string): Promise<{ unit: number; perk: number; label: string }> {
  const pool = await getPool();
  const unit = (await approvedInMonth(pool, Number(viewer.id), saleDate)) + 1;
  const plan = await inTransaction(pool, (tx) => planOn(tx, today()));
  const perk = toDollars(tierAmountCents(unit, plan.tiers));
  return { unit, perk, label: `This would be your ${ordinal(unit)} sale this month` };
}

// --- Changes --------------------------------------------------------------------------------------

export type SaleChange =
  | { ok: true; id: number }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; fields?: Record<string, string> };

const fail = (status: 400 | 403 | 404 | 409, error: string, fields?: Record<string, string>): SaleChange => ({ ok: false, status, error, fields });

/** Records a sale (Pending). Admins may record for another seller with `soldByUserId`. */
export async function recordSale(viewer: User, input: SaleInput, soldByUserId?: number): Promise<SaleChange> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  let sellerId = Number(viewer.id);
  if (soldByUserId !== undefined && soldByUserId !== sellerId) {
    if (viewer.role !== 'admin') return fail(403, 'Only admins can record a sale for someone else');
    const seller = await getPerson(pool, soldByUserId);
    if (!seller || !seller.IsActive || !['sales', 'manager'].includes(seller.Role)) {
      return fail(400, 'Choose an active sales rep or manager', { soldByUserId: 'Choose an active sales rep or manager' });
    }
    sellerId = soldByUserId;
  }
  try {
    return await inTransaction(pool, async (tx) => {
      const vehicle = await tx
        .request()
        .input('vehicle', mssql.Int, input.vehicleId)
        .query<{ Price: number; SaleStatus: string }>('SELECT Price, SaleStatus FROM dbo.Vehicles WITH (UPDLOCK, HOLDLOCK) WHERE VehicleId = @vehicle');
      const v = vehicle.recordset[0];
      if (!v) return fail(400, 'Some fields are invalid', { vehicleId: 'That vehicle no longer exists' });
      if (v.SaleStatus !== 'Available') {
        return fail(409, 'This vehicle already has a sale recorded', {
          vehicleId: v.SaleStatus === 'Sold' ? 'This vehicle is already sold' : 'A sale for this vehicle is waiting for approval',
        });
      }
      if (input.leadId !== null) {
        const lead = await tx
          .request()
          .input('lead', mssql.Int, input.leadId)
          .query<{ AssignedToUserId: number | null }>('SELECT AssignedToUserId FROM dbo.Leads WHERE LeadId = @lead');
        const l = lead.recordset[0];
        const canSee = l && (viewer.role === 'admin' || viewer.role === 'manager' || String(l.AssignedToUserId) === viewer.id);
        if (!canSee) return fail(400, 'Some fields are invalid', { leadId: 'Unknown lead' });
      }
      const { recordset } = await tx
        .request()
        .input('vehicle', mssql.Int, input.vehicleId)
        .input('lead', mssql.Int, input.leadId)
        .input('buyer', mssql.NVarChar(100), input.buyerName)
        .input('list', mssql.Decimal(12, 2), Number(v.Price))
        .input('price', mssql.Decimal(12, 2), toDollars(input.salePriceCents))
        .input('date', mssql.Date, input.saleDate)
        .input('seller', mssql.Int, sellerId)
        .input('notes', mssql.NVarChar(1000), input.notes)
        .query<{ SaleId: number }>(`
          INSERT INTO dbo.Sales (VehicleId, LeadId, BuyerName, ListPrice, SalePrice, SaleDate, SoldByUserId, Notes)
            OUTPUT INSERTED.SaleId
            VALUES (@vehicle, @lead, @buyer, @list, @price, @date, @seller, @notes);
          UPDATE dbo.Vehicles SET SaleStatus = 'SalePending' WHERE VehicleId = @vehicle;`);
      return { ok: true as const, id: recordset[0].SaleId };
    });
  } catch (err) {
    const n = (err as { number?: number }).number;
    if (n === 2601 || n === 2627) return fail(409, 'This vehicle already has a sale recorded', { vehicleId: 'This vehicle already has a sale recorded' });
    throw err;
  }
}

interface LockedSale {
  VehicleId: number;
  LeadId: number | null;
  SaleDate: string;
  SoldByUserId: number;
  Status: SaleStatus;
  SellerRole: Role;
  SellerManagerId: number | null;
}

async function lockSale(tx: Transaction, id: number): Promise<LockedSale | null> {
  const mssql = await sql();
  const { recordset } = await tx
    .request()
    .input('id', mssql.Int, id)
    .query<LockedSale>(`
      SELECT s.VehicleId, s.LeadId, CONVERT(char(10), s.SaleDate, 23) AS SaleDate, s.SoldByUserId, s.Status,
             u.Role AS SellerRole, u.ManagerUserId AS SellerManagerId
        FROM dbo.Sales s WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.Users u ON u.UserId = s.SoldByUserId
       WHERE s.SaleId = @id`);
  return recordset[0] ?? null;
}

/** Can the viewer see this sale at all (else report 404)? */
const visible = (viewer: User, s: LockedSale) =>
  viewer.role === 'admin' ||
  String(s.SoldByUserId) === viewer.id ||
  (viewer.role === 'manager' && String(s.SellerManagerId) === viewer.id);

export async function approveSale(viewer: User, id: number): Promise<SaleChange> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  return inTransaction(pool, async (tx) => {
    const s = await lockSale(tx, id);
    if (!s || !visible(viewer, s)) return fail(404, 'Sale not found');
    if (String(s.SoldByUserId) === viewer.id) return fail(403, "You can't approve your own sale");
    if (!mayDecide(viewer, s.SoldByUserId, s.SellerManagerId)) return fail(403, "Only the seller's manager or an admin can approve this sale");
    if (s.Status !== 'Pending') return fail(409, `This sale is already ${s.Status.toLowerCase()}`);

    // Serialize approvals for the same seller so two concurrent approvals can't get the same unit number.
    await tx.request().input('seller', mssql.Int, s.SoldByUserId).query('SELECT UserId FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @seller');

    const approvedOn = today();
    const plan = await planOn(tx, approvedOn);
    const unit = (await approvedInMonth(tx, s.SoldByUserId, s.SaleDate)) + 1;
    const perkCents = tierAmountCents(unit, plan.tiers);
    // Overrides are for sales by reps, to the rep's manager at approval time.
    const managerId = s.SellerRole === 'sales' ? s.SellerManagerId : null;
    const period = await entryPeriod(tx, s.SaleDate);

    const entry = (userId: number, type: 'Perk' | 'Override', cents: number, note: string) =>
      tx
        .request()
        .input('user', mssql.Int, userId)
        .input('period', mssql.Date, period)
        .input('type', mssql.VarChar(16), type)
        .input('amount', mssql.Decimal(12, 2), toDollars(cents))
        .input('sale', mssql.Int, id)
        .input('note', mssql.NVarChar(300), note)
        .input('by', mssql.Int, Number(viewer.id))
        .query(`INSERT INTO dbo.EarningEntries (UserId, PeriodStart, Type, Amount, SaleId, Note, CreatedByUserId)
                VALUES (@user, @period, @type, @amount, @sale, @note, @by)`);

    await entry(s.SoldByUserId, 'Perk', perkCents, `${ordinal(unit)} sale in ${s.SaleDate.slice(0, 7)}`);
    if (managerId !== null && plan.overrideCents > 0) await entry(managerId, 'Override', plan.overrideCents, 'Team sale override');

    await tx
      .request()
      .input('id', mssql.Int, id)
      .input('unit', mssql.Int, unit)
      .input('plan', mssql.Int, plan.planId)
      .input('manager', mssql.Int, managerId)
      .input('by', mssql.Int, Number(viewer.id))
      .input('vehicle', mssql.Int, s.VehicleId)
      .input('lead', mssql.Int, s.LeadId)
      .query(`
        UPDATE dbo.Sales SET Status = 'Approved', MonthUnit = @unit, PlanId = @plan, ManagerUserId = @manager,
                             DecidedByUserId = @by, DecidedAt = SYSUTCDATETIME()
         WHERE SaleId = @id;
        UPDATE dbo.Vehicles SET SaleStatus = 'Sold' WHERE VehicleId = @vehicle;
        IF @lead IS NOT NULL
          UPDATE dbo.Leads SET Status = 'Won', ClosedAt = SYSUTCDATETIME(), NextFollowUpDue = NULL
           WHERE LeadId = @lead AND Status NOT IN ('Won', 'Lost');`);
    return { ok: true as const, id };
  });
}

export async function rejectSale(viewer: User, id: number, reason: string): Promise<SaleChange> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  return inTransaction(pool, async (tx) => {
    const s = await lockSale(tx, id);
    if (!s || !visible(viewer, s)) return fail(404, 'Sale not found');
    if (String(s.SoldByUserId) === viewer.id) return fail(403, "You can't reject your own sale");
    if (!mayDecide(viewer, s.SoldByUserId, s.SellerManagerId)) return fail(403, "Only the seller's manager or an admin can reject this sale");
    if (s.Status !== 'Pending') return fail(409, `This sale is already ${s.Status.toLowerCase()}`);
    await tx
      .request()
      .input('id', mssql.Int, id)
      .input('reason', mssql.NVarChar(300), reason.trim())
      .input('by', mssql.Int, Number(viewer.id))
      .input('vehicle', mssql.Int, s.VehicleId)
      .query(`
        UPDATE dbo.Sales SET Status = 'Rejected', RejectReason = @reason, DecidedByUserId = @by, DecidedAt = SYSUTCDATETIME()
         WHERE SaleId = @id;
        UPDATE dbo.Vehicles SET SaleStatus = 'Available' WHERE VehicleId = @vehicle AND SaleStatus = 'SalePending';`);
    return { ok: true as const, id };
  });
}

/** Admins: undoes an approved sale. Reverses its perk and override in the current open period. */
export async function voidSale(viewer: User, id: number, reason: string): Promise<SaleChange> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  return inTransaction(pool, async (tx) => {
    const s = await lockSale(tx, id);
    if (!s) return fail(404, 'Sale not found');
    if (viewer.role !== 'admin') return fail(403, 'Only admins can void a sale');
    if (String(s.SoldByUserId) === viewer.id) return fail(403, "You can't void your own sale");
    if (s.Status !== 'Approved') return fail(409, 'Only approved sales can be voided');

    const period = await entryPeriod(tx, today());
    await tx
      .request()
      .input('id', mssql.Int, id)
      .input('period', mssql.Date, period)
      .input('reason', mssql.NVarChar(300), reason.trim())
      .input('by', mssql.Int, Number(viewer.id))
      .input('vehicle', mssql.Int, s.VehicleId)
      .query(`
        INSERT INTO dbo.EarningEntries (UserId, PeriodStart, Type, Amount, SaleId, Note, CreatedByUserId)
          SELECT UserId, @period, Kind, -SUM(Amount), @id, CONCAT('Sale voided: ', @reason), @by
            FROM (SELECT UserId, Amount,
                         CASE WHEN Type IN ('Perk', 'PerkReversal') THEN 'PerkReversal' ELSE 'OverrideReversal' END AS Kind
                    FROM dbo.EarningEntries
                   WHERE SaleId = @id AND Type IN ('Perk', 'Override', 'PerkReversal', 'OverrideReversal')) e
           GROUP BY UserId, Kind
          HAVING SUM(Amount) <> 0;
        UPDATE dbo.Sales SET Status = 'Voided', VoidReason = @reason, VoidedByUserId = @by, VoidedAt = SYSUTCDATETIME() WHERE SaleId = @id;
        UPDATE dbo.Vehicles SET SaleStatus = 'Available' WHERE VehicleId = @vehicle;`);
    return { ok: true as const, id };
  });
}
