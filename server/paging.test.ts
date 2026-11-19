import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pageList } from '../src/paging.ts';
import { BULK_COUNT, generateVehicles } from './db/bulkVehicles.ts';
import { validateVehicle } from '../src/validation.ts';

describe('pageList', () => {
  it('shows every page when there are few', () => {
    assert.deepEqual(pageList(1, 1), [1]);
    assert.deepEqual(pageList(2, 3), [1, 2, 3]);
    assert.deepEqual(pageList(3, 5), [1, 2, 3, 4, 5]);
  });

  it('keeps first, last and neighbours, with ellipses for gaps', () => {
    assert.deepEqual(pageList(1, 52), [1, 2, '…', 52]);
    assert.deepEqual(pageList(26, 52), [1, '…', 25, 26, 27, '…', 52]);
    assert.deepEqual(pageList(52, 52), [1, '…', 51, 52]);
  });

  it('never hides a single page behind an ellipsis', () => {
    assert.deepEqual(pageList(4, 10), [1, 2, 3, 4, 5, '…', 10]);
    assert.deepEqual(pageList(7, 10), [1, '…', 6, 7, 8, 9, 10]);
  });

  it('lists each page at most once, in order', () => {
    for (let pages = 1; pages <= 30; pages++) {
      for (let page = 1; page <= pages; page++) {
        const nums = pageList(page, pages).filter((p) => p !== '…') as number[];
        assert.deepEqual(nums, [...new Set(nums)].sort((a, b) => a - b), `page ${page}/${pages}`);
        assert.ok(nums.includes(1) && nums.includes(pages) && nums.includes(page), `page ${page}/${pages}`);
      }
    }
  });
});

describe('generated inventory', () => {
  const rows = generateVehicles();

  it(`has ${BULK_COUNT} vehicles with unique stock numbers`, () => {
    assert.equal(rows.length, BULK_COUNT);
    assert.equal(new Set(rows.map((r) => r.stockNumber)).size, BULK_COUNT);
  });

  it('is the same every time (so re-running setup adds nothing)', () => {
    assert.deepEqual(generateVehicles(), rows);
  });

  it('passes the same validation as the add/edit form', () => {
    const invalid = rows.filter((r) => !validateVehicle({ ...r, name: r.make }).ok);
    assert.deepEqual(invalid, []);
  });

  it('spans economy to exotic, across major brands and every category', () => {
    const makes = new Set(rows.map((r) => r.make));
    for (const make of ['Toyota', 'Honda', 'Ford', 'Chevrolet', 'BMW', 'Mercedes-Benz', 'Audi', 'Lexus', 'Porsche', 'Tesla', 'Ferrari', 'Lamborghini', 'Rolls-Royce', 'Bentley', 'McLaren']) {
      assert.ok(makes.has(make), make);
    }
    assert.ok(makes.size >= 30);
    assert.equal(new Set(rows.map((r) => r.category)).size, 6);
    assert.ok(rows.some((r) => r.price < 20000));
    assert.ok(rows.some((r) => r.price > 200000));
  });

  it('gives new cars delivery mileage and used cars real mileage', () => {
    assert.ok(rows.filter((r) => r.condition === 'New').every((r) => r.mileage < 100));
    assert.ok(rows.filter((r) => r.condition === 'Used').every((r) => r.mileage > 1000));
  });

  it("keeps model years within each model's production run", () => {
    const years = (model: string) => rows.filter((r) => r.model === model).map((r) => r.year);
    assert.ok(years('Model Y Long Range').every((y) => y >= 2020));
    assert.ok(years('Cybertruck AWD').every((y) => y >= 2024));
    assert.ok(years('Ioniq 5 SE').every((y) => y >= 2022));
    assert.ok(years('Charger R/T').every((y) => y <= 2023));
    assert.ok(rows.filter((r) => r.model === 'Charger R/T').every((r) => r.condition !== 'New'));
  });

  it('keeps exotic mileage low', () => {
    const exotic = rows.filter((r) => ['Ferrari', 'Lamborghini', 'McLaren', 'Rolls-Royce'].includes(r.make));
    assert.ok(exotic.length > 0);
    assert.ok(exotic.every((r) => r.mileage <= 4000 * 11), JSON.stringify(exotic.map((r) => [r.year, r.mileage])));
    assert.ok(exotic.every((r) => r.mileage <= 4000 * Math.max(1, 2026 - r.year + 1)));
  });

  it('never has used or certified cars from a future model year', () => {
    assert.ok(rows.filter((r) => r.condition !== 'New').every((r) => r.year <= 2026));
  });
});
