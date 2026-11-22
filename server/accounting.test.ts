import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  csvField,
  monthRange,
  ordinal,
  parseDate,
  periodFor,
  periodSalaryCents,
  tierAmountCents,
  today,
  validatePlan,
  validateSale,
  weekStart,
  type Tier,
} from './accounting.ts';

// Unit tests for the accounting rules. Pure functions only: no database. Run with `npm test`.

const TIERS: Tier[] = [
  { fromUnit: 1, perVehicleCents: 200_00 },
  { fromUnit: 9, perVehicleCents: 300_00 },
  { fromUnit: 13, perVehicleCents: 400_00 },
];

describe('tiered perks (marginal)', () => {
  it('pays each vehicle at the rate of the tier it falls in', () => {
    assert.equal(tierAmountCents(1, TIERS), 200_00);
    assert.equal(tierAmountCents(8, TIERS), 200_00);
    assert.equal(tierAmountCents(9, TIERS), 300_00);
    assert.equal(tierAmountCents(12, TIERS), 300_00);
    assert.equal(tierAmountCents(13, TIERS), 400_00);
    assert.equal(tierAmountCents(40, TIERS), 400_00);
  });

  it('totals $3,200 for 13 vehicles in a month (8×200 + 4×300 + 1×400)', () => {
    let total = 0;
    for (let unit = 1; unit <= 13; unit++) total += tierAmountCents(unit, TIERS);
    assert.equal(total, 3200_00);
  });

  it('does not depend on tier order', () => {
    assert.equal(tierAmountCents(10, [...TIERS].reverse()), 300_00);
  });
});

describe('dates and pay periods', () => {
  it('parses only real calendar dates', () => {
    assert.ok(parseDate('2026-11-19'));
    assert.equal(parseDate('2026-02-30'), null);
    assert.equal(parseDate('2026-1-5'), null);
    assert.equal(parseDate(20261119), null);
  });

  it('starts weeks on Monday (Sunday belongs to the week before)', () => {
    assert.equal(weekStart('2026-11-16'), '2026-11-16'); // Monday
    assert.equal(weekStart('2026-11-19'), '2026-11-16'); // Thursday
    assert.equal(weekStart('2026-11-22'), '2026-11-16'); // Sunday
    assert.equal(weekStart('2026-11-23'), '2026-11-23'); // next Monday
    assert.equal(weekStart('2027-01-01'), '2026-12-28'); // across the year end
  });

  it('finds the bi-weekly period from the 2026-11-02 anchor, before and after it', () => {
    assert.deepEqual(periodFor('2026-11-02'), { start: '2026-11-02', end: '2026-11-15' });
    assert.deepEqual(periodFor('2026-11-15'), { start: '2026-11-02', end: '2026-11-15' });
    assert.deepEqual(periodFor('2026-11-16'), { start: '2026-11-16', end: '2026-11-29' });
    assert.deepEqual(periodFor('2026-11-20'), { start: '2026-11-16', end: '2026-11-29' });
    assert.deepEqual(periodFor('2026-11-01'), { start: '2026-10-19', end: '2026-11-01' });
    assert.deepEqual(periodFor('2027-01-01'), { start: '2026-12-28', end: '2027-01-10' });
  });

  it('gives month boundaries, including February and December', () => {
    assert.deepEqual(monthRange('2026-11-19'), { first: '2026-11-01', last: '2026-11-30' });
    assert.deepEqual(monthRange('2028-02-10'), { first: '2028-02-01', last: '2028-02-29' });
    assert.deepEqual(monthRange('2026-12-31'), { first: '2026-12-01', last: '2026-12-31' });
  });

  it("returns today's date in the dealership's time zone", () => {
    const utcEvening = new Date('2026-11-20T05:00:00Z'); // 9 PM on Nov 19 in Los Angeles
    assert.equal(today('America/Los_Angeles', utcEvening), '2026-11-19');
    assert.equal(today('UTC', utcEvening), '2026-11-20');
  });
});

describe('salary per period', () => {
  it('pays annual ÷ 26, rounded to the cent', () => {
    assert.equal(periodSalaryCents(30_000_00), 1153_85);
    assert.equal(periodSalaryCents(54_000_00), 2076_92);
  });
});

describe('validateSale', () => {
  const TODAY = '2026-11-20';
  const VALID = { vehicleId: '42', leadId: '', buyerName: '  Ada   Lovelace ', salePrice: '31995.50', saleDate: '2026-11-19', notes: '' };

  it('accepts and normalizes a sale', () => {
    const r = validateSale(VALID, TODAY);
    assert.ok(r.ok);
    assert.deepEqual(r.value, { vehicleId: 42, leadId: null, buyerName: 'Ada Lovelace', salePriceCents: 3199550, saleDate: '2026-11-19', notes: null });
  });

  it('rejects future, too-old and impossible dates', () => {
    assert.ok(!validateSale({ ...VALID, saleDate: '2026-11-21' }, TODAY).ok);
    assert.ok(!validateSale({ ...VALID, saleDate: addDays(TODAY, -61) }, TODAY).ok);
    assert.ok(validateSale({ ...VALID, saleDate: addDays(TODAY, -60) }, TODAY).ok);
    assert.ok(!validateSale({ ...VALID, saleDate: '2026-02-30' }, TODAY).ok);
  });

  it('rejects bad prices, missing buyer and vehicle', () => {
    const r = validateSale({ ...VALID, salePrice: '12.345', buyerName: ' ', vehicleId: 'x' }, TODAY);
    assert.ok(!r.ok);
    assert.deepEqual(Object.keys(r.errors).sort(), ['buyerName', 'salePrice', 'vehicleId']);
    assert.ok(!validateSale({ ...VALID, salePrice: 0 }, TODAY).ok);
    assert.ok(!validateSale({ ...VALID, salePrice: 100_000_000 }, TODAY).ok);
  });
});

describe('validatePlan', () => {
  const TODAY = '2026-11-20';
  it('accepts tiers in any order and sorts them', () => {
    const r = validatePlan({ effectiveFrom: '2026-12-01', managerOverride: 75, tiers: [{ fromUnit: 10, perVehicle: 350 }, { fromUnit: 1, perVehicle: 250 }] }, TODAY);
    assert.ok(r.ok);
    assert.deepEqual(r.value.tiers, [{ fromUnit: 1, perVehicleCents: 250_00 }, { fromUnit: 10, perVehicleCents: 350_00 }]);
  });

  it('requires a first tier at unit 1, unique starts and a date that is not in the past', () => {
    assert.ok(!validatePlan({ effectiveFrom: '2026-12-01', managerOverride: 50, tiers: [{ fromUnit: 2, perVehicle: 200 }] }, TODAY).ok);
    assert.ok(!validatePlan({ effectiveFrom: '2026-12-01', managerOverride: 50, tiers: [{ fromUnit: 1, perVehicle: 200 }, { fromUnit: 1, perVehicle: 300 }] }, TODAY).ok);
    assert.ok(!validatePlan({ effectiveFrom: '2026-11-01', managerOverride: 50, tiers: [{ fromUnit: 1, perVehicle: 200 }] }, TODAY).ok);
  });
});

describe('helpers', () => {
  it('formats ordinals', () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });

  it('escapes CSV fields and neutralizes spreadsheet formulas', () => {
    assert.equal(csvField('plain'), 'plain');
    assert.equal(csvField('a,b'), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvField(-12.5), '-12.5');
  });
});
