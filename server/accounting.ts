// Pure accounting rules (no database), shared by server/sales.ts and server/payroll.ts and unit-tested in
// server/accounting.test.ts. Money is handled in integer cents; dates are business dates "YYYY-MM-DD".

/** Bi-weekly pay periods (Monday to Sunday twice) are counted from this Monday. */
export const PAY_PERIOD_ANCHOR = '2026-11-02';
export const PAY_PERIODS_PER_YEAR = 26;
/** A sale can be recorded up to this many days after it happened. */
export const SALE_BACKDATE_DAYS = 60;
export const MAX_SALE_PRICE_CENTS = 99_999_999_00;
export const BUYER_NAME_MAX = 100;
export const SALE_NOTES_MAX = 1000;
export const REASON_MAX = 300;

export const DEALER_TIME_ZONE = process.env.DEALER_TIME_ZONE || 'America/Los_Angeles';

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- Dates --------------------------------------------------------------------------------------

/** "2026-11-19" → UTC midnight, or null when it isn't a real calendar date. */
export function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return isoDate(new Date(parseDate(date)!.getTime() + days * DAY_MS));
}

export const daysBetween = (from: string, to: string) => Math.round((parseDate(to)!.getTime() - parseDate(from)!.getTime()) / DAY_MS);

/** Today's date in the dealership's time zone. */
export function today(timeZone = DEALER_TIME_ZONE, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The Monday of the week containing `date` (weeks run Monday to Sunday). */
export function weekStart(date: string): string {
  const dow = parseDate(date)!.getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** First and last day of the calendar month containing `date`. */
export function monthRange(date: string): { first: string; last: string } {
  const d = parseDate(date)!;
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { first: isoDate(first), last: isoDate(last) };
}

/** The bi-weekly pay period containing `date`. */
export function periodFor(date: string, anchor = PAY_PERIOD_ANCHOR): { start: string; end: string } {
  const offset = daysBetween(anchor, date);
  const start = addDays(anchor, Math.floor(offset / 14) * 14);
  return { start, end: addDays(start, 13) };
}

export const isPeriodStart = (date: string, anchor = PAY_PERIOD_ANCHOR) =>
  parseDate(date) !== null && periodFor(date, anchor).start === date;

// --- Money --------------------------------------------------------------------------------------

/** Dollars (as returned by SQL DECIMAL) → integer cents. */
export const toCents = (dollars: number | string) => Math.round(Number(dollars) * 100);
export const toDollars = (cents: number) => cents / 100;

export interface Tier {
  fromUnit: number;
  perVehicleCents: number;
}

/** Marginal tiered perk: the rate of the highest tier whose `fromUnit` is at most `unit`. */
export function tierAmountCents(unit: number, tiers: readonly Tier[]): number {
  let amount = 0;
  for (const t of [...tiers].sort((a, b) => a.fromUnit - b.fromUnit)) if (t.fromUnit <= unit) amount = t.perVehicleCents;
  return amount;
}

/** One bi-weekly period's salary from an annual salary (cents), rounded to the cent. */
export const periodSalaryCents = (annualCents: number) => Math.round(annualCents / PAY_PERIODS_PER_YEAR);

export const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
};

// --- Validation ---------------------------------------------------------------------------------

/** Dollars from a number or numeric string, with at most 2 decimals → cents; null when invalid. */
function moneyCents(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return Math.abs(cents - n * 100) < 1e-6 ? cents : null;
}

export interface SaleInput {
  vehicleId: number;
  leadId: number | null;
  buyerName: string;
  salePriceCents: number;
  saleDate: string;
  notes: string | null;
}

export type SaleFieldErrors = Partial<Record<'vehicleId' | 'leadId' | 'buyerName' | 'salePrice' | 'saleDate' | 'notes', string>>;

const positiveId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
};

export function validateSale(raw: unknown, todayDate = today()): { ok: true; value: SaleInput } | { ok: false; errors: SaleFieldErrors } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: SaleFieldErrors = {};

  const vehicleId = positiveId(input.vehicleId);
  if (vehicleId === null) errors.vehicleId = 'Choose the vehicle that was sold';

  let leadId: number | null = null;
  if (input.leadId !== undefined && input.leadId !== null && input.leadId !== '') {
    leadId = positiveId(input.leadId);
    if (leadId === null) errors.leadId = 'Unknown lead';
  }

  const buyerName = typeof input.buyerName === 'string' ? input.buyerName.trim().replace(/\s+/g, ' ') : '';
  if (!buyerName) errors.buyerName = "Enter the buyer's name";
  else if (buyerName.length > BUYER_NAME_MAX) errors.buyerName = `Keep the name under ${BUYER_NAME_MAX} characters`;

  const salePriceCents = moneyCents(input.salePrice);
  if (salePriceCents === null) errors.salePrice = 'Enter the sale price, e.g. 31995 or 31995.50';
  else if (salePriceCents < 100 || salePriceCents > MAX_SALE_PRICE_CENTS) errors.salePrice = 'Sale price must be between $1 and $99,999,999';

  const saleDate = typeof input.saleDate === 'string' ? input.saleDate : '';
  if (!parseDate(saleDate)) errors.saleDate = 'Enter the date of the sale';
  else if (saleDate > todayDate) errors.saleDate = "The sale date can't be in the future";
  else if (daysBetween(saleDate, todayDate) > SALE_BACKDATE_DAYS) errors.saleDate = `Sales older than ${SALE_BACKDATE_DAYS} days can't be recorded`;

  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (notes.length > SALE_NOTES_MAX) errors.notes = `Keep notes under ${SALE_NOTES_MAX} characters`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { vehicleId: vehicleId!, leadId, buyerName, salePriceCents: salePriceCents!, saleDate, notes: notes || null } };
}

/** A reason for rejecting/voiding a sale or an adjustment note; null when acceptable. */
export function reasonProblem(reason: unknown, what = 'a reason'): string | null {
  if (typeof reason !== 'string' || !reason.trim()) return `Give ${what}`;
  if (reason.trim().length > REASON_MAX) return `Keep it under ${REASON_MAX} characters`;
  return null;
}

export interface PlanInput {
  effectiveFrom: string;
  managerOverrideCents: number;
  tiers: Tier[];
}

/** Checks a new commission plan version. Tiers: first starts at unit 1, ascending, amounts $0-$100,000. */
export function validatePlan(raw: unknown, todayDate = today()): { ok: true; value: PlanInput } | { ok: false; error: string } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const effectiveFrom = typeof input.effectiveFrom === 'string' ? input.effectiveFrom : '';
  if (!parseDate(effectiveFrom)) return { ok: false, error: 'Enter the date the new rates start' };
  if (effectiveFrom < todayDate) return { ok: false, error: "New rates can't start in the past (approved perks never change)" };
  const managerOverrideCents = moneyCents(input.managerOverride);
  if (managerOverrideCents === null || managerOverrideCents < 0 || managerOverrideCents > 10_000_000) {
    return { ok: false, error: 'Manager override must be between $0 and $100,000' };
  }
  if (!Array.isArray(input.tiers) || input.tiers.length === 0 || input.tiers.length > 10) return { ok: false, error: 'Add 1 to 10 tiers' };
  const tiers: Tier[] = [];
  for (const t of input.tiers as Record<string, unknown>[]) {
    const fromUnit = Number(t?.fromUnit);
    const cents = moneyCents(t?.perVehicle);
    if (!Number.isInteger(fromUnit) || fromUnit < 1 || fromUnit > 1000) return { ok: false, error: 'Tier start units must be whole numbers from 1' };
    if (cents === null || cents < 0 || cents > 10_000_000) return { ok: false, error: 'Per-vehicle amounts must be between $0 and $100,000' };
    tiers.push({ fromUnit, perVehicleCents: cents });
  }
  tiers.sort((a, b) => a.fromUnit - b.fromUnit);
  if (tiers[0].fromUnit !== 1) return { ok: false, error: 'The first tier must start at unit 1' };
  if (new Set(tiers.map((t) => t.fromUnit)).size !== tiers.length) return { ok: false, error: 'Each tier must start at a different unit' };
  return { ok: true, value: { effectiveFrom, managerOverrideCents, tiers } };
}

/** CSV field: quoted when needed; formula-like values are prefixed with ' so spreadsheets don't execute them. */
export function csvField(value: string | number | null): string {
  let s = value === null ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
