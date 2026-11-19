import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Vehicle } from '../src/types.ts';
import { AGENT_TOOLS, inventorySummary, leadFromToolArgs, runTool, searchVehicles, toChatVehicle } from './agentTools.ts';

// Unit tests for the chat agent's tools. Pure functions only: no database or Foundry calls.
// Run with `npm test`.

const car = (id: string, over: Partial<Vehicle>): Vehicle => ({
  id, name: 'Toyota', model: 'Camry', year: 2022, price: 30000, category: 'Sedan', condition: 'Used',
  mileage: 20000, color: 'Silver', colorHex: '#c0c0c0', stockNumber: `S-${id}`, ...over,
});

const STOCK: Vehicle[] = [
  car('1', { name: 'Jeep', model: 'Grand Cherokee', category: 'SUV', price: 33900, mileage: 41875, year: 2021 }),
  car('2', { name: 'Toyota', model: 'RAV4 Hybrid', category: 'SUV', price: 34600, mileage: 16750, year: 2023, condition: 'Certified', color: 'Blueprint' }),
  car('3', { name: 'BMW', model: 'X5', category: 'SUV', price: 61000, mileage: 5, year: 2024, condition: 'New' }),
  car('4', { name: 'Ford', model: 'F-150', category: 'Truck', price: 45000, condition: 'New', color: 'Red' }),
  car('5', { name: 'Chevrolet', model: 'Silverado', category: 'Truck', price: 42300, mileage: 33190 }),
  car('6', { name: 'Tesla', model: 'Model 3', category: 'Electric', price: 38990, color: 'Red' }),
];

// Every filter is required in strict mode; null means "no filter".
const NONE = {
  category: null, condition: null, make: null, keywords: null, minPrice: null, maxPrice: null,
  minYear: null, maxYear: null, maxMileage: null, sort: null, limit: null,
};
const search = (args: Record<string, unknown>) => searchVehicles(STOCK, { ...NONE, ...args });
const ids = (r: ReturnType<typeof search>) => r.vehicles.map((v) => v.id);

describe('search_vehicles', () => {
  it('filters by category and max price, cheapest first by default', () => {
    const r = search({ category: 'SUV', maxPrice: 40000 });
    assert.equal(r.totalMatches, 2);
    assert.deepEqual(ids(r), ['1', '2']);
  });

  it('combines condition, year, mileage and price bounds', () => {
    assert.deepEqual(ids(search({ condition: 'Used', category: 'Truck' })), ['5']);
    assert.deepEqual(ids(search({ minYear: 2023, maxYear: 2023 })), ['2']);
    assert.deepEqual(ids(search({ maxMileage: 10 })), ['3']);
    assert.deepEqual(ids(search({ minPrice: 45000 })), ['4', '3']);
  });

  it('matches make and keywords case-insensitively, keywords against model and color', () => {
    assert.deepEqual(ids(search({ make: 'toyota' })), ['2']);
    assert.deepEqual(ids(search({ keywords: 'rav4' })), ['2']);
    assert.deepEqual(ids(search({ keywords: 'RED' })), ['6', '4']);
    assert.deepEqual(ids(search({ keywords: 'red ford' })), ['4']); // every word must match
  });

  it('finds electric vehicles by body style ("electric SUV" → Electric + "SUV")', () => {
    const evs: Vehicle[] = [
      car('e1', { name: 'Tesla', model: 'Model Y Long Range', category: 'Electric', price: 40000 }),
      car('e2', { name: 'Nissan', model: 'Leaf SV Plus', category: 'Electric', price: 15000 }),
      car('e3', { name: 'Rivian', model: 'R1T Adventure', category: 'Electric', price: 60000 }),
      car('e4', { name: 'Tesla', model: 'Cybertruck AWD', category: 'Electric', price: 80000 }),
    ];
    const find = (args: Record<string, unknown>) => searchVehicles(evs, { ...NONE, ...args }).vehicles.map((v) => v.id);
    assert.deepEqual(find({ category: 'Electric', keywords: 'SUV' }), ['e1']);
    assert.deepEqual(find({ category: 'Electric', keywords: 'trucks' }), ['e3', 'e4']);
    assert.deepEqual(find({ keywords: 'ev pickup' }), ['e3', 'e4']);
    assert.deepEqual(find({ category: 'Electric', keywords: 'sedan' }), ['e2']);
  });

  it('ignores filler words and matches plurals', () => {
    assert.deepEqual(ids(search({ keywords: 'used red cars' })), ['6', '4']);
    assert.deepEqual(ids(search({ keywords: 'SUVs', maxPrice: 40000 })), ['1', '2']);
  });

  it('returns no vehicles when nothing matches', () => {
    const r = search({ make: 'Ferrari' });
    assert.equal(r.totalMatches, 0);
    assert.deepEqual(r.vehicles, []);
  });

  it('sorts as requested', () => {
    assert.deepEqual(ids(search({ category: 'SUV', sort: 'price_desc' })), ['3', '2', '1']);
    assert.deepEqual(ids(search({ category: 'SUV', sort: 'year_desc' })), ['3', '2', '1']);
    assert.deepEqual(ids(search({ category: 'SUV', sort: 'mileage_asc' })), ['3', '2', '1']);
  });

  it('defaults to 5 results, clamps limit to 1-10, but still reports the full match count', () => {
    assert.equal(search({}).vehicles.length, 5);
    assert.equal(search({ limit: 2 }).vehicles.length, 2);
    assert.equal(search({ limit: 0 }).vehicles.length, 1);
    assert.equal(search({ limit: 999 }).vehicles.length, 6);
    assert.equal(search({ limit: 2 }).totalMatches, 6);
  });

  it('ignores invalid model arguments instead of failing or matching nothing', () => {
    const r = search({ category: 'Spaceship', condition: 42, maxPrice: 'cheap', sort: 'random', limit: 'many', make: '   ' });
    assert.equal(r.totalMatches, STOCK.length);
  });

  it('does not expose stock numbers, color hex or photos to the model', () => {
    const v = search({ category: 'Truck' }).vehicles[0] as Record<string, unknown>;
    assert.equal(v.stockNumber, undefined);
    assert.equal(v.colorHex, undefined);
    assert.equal(v.photos, undefined);
  });
});

describe('inventory_summary', () => {
  it('counts every category (including empty ones), by condition, with price ranges', () => {
    const s = inventorySummary(STOCK);
    assert.equal(s.totalVehicles, 6);
    const suv = s.categories.find((c) => c.category === 'SUV')!;
    assert.equal(suv.count, 3);
    assert.deepEqual(suv.byCondition, { New: 1, Used: 1, Certified: 1 });
    assert.deepEqual(suv.priceRange, { min: 33900, max: 61000 });
    const van = s.categories.find((c) => c.category === 'Van')!;
    assert.equal(van.count, 0);
    assert.equal(van.priceRange, null);
  });
});

describe('runTool', () => {
  it('rejects malformed JSON arguments without touching the database', async () => {
    const r = await runTool('search_vehicles', '{not json');
    assert.match(r.output, /not valid JSON/);
    assert.equal(r.vehicles, undefined);
  });
});

describe('create_lead', () => {
  const ARGS = {
    first_name: 'Ada', last_name: 'Lovelace', email: 'Ada@Example.com', mobile: '555 123 4567',
    preferred_contact: 'Email', condition: 'New', urgency_days: 30, vehicle_id: null, message: null,
    customer_agreed_to_contact: true,
  };

  it('maps the model\'s arguments onto the shared lead validation', () => {
    const r = leadFromToolArgs(ARGS);
    assert.ok(r.ok);
    assert.equal(r.value.email, 'ada@example.com');
    assert.equal(r.value.mobile, '5551234567');
    assert.equal(r.value.interestCondition, 'New');
    assert.equal(r.value.consent, true);
  });

  it('refuses without the customer\'s agreement, even for email', () => {
    const r = leadFromToolArgs({ ...ARGS, customer_agreed_to_contact: false });
    assert.ok(!r.ok && r.errors.consent);
  });

  it('returns field errors for invented or malformed details without touching the database', async () => {
    const r = await runTool('create_lead', JSON.stringify({ ...ARGS, email: 'unknown', urgency_days: 0 }));
    const out = JSON.parse(r.output) as { error?: string; fields?: Record<string, string> };
    assert.ok(out.error);
    assert.deepEqual(Object.keys(out.fields ?? {}).sort(), ['email', 'urgency_days']);
  });
});

describe('tool definitions', () => {
  it('lists every parameter as required, as strict mode demands', () => {
    for (const tool of AGENT_TOOLS) {
      const { properties, required, additionalProperties } = tool.parameters as {
        properties: Record<string, unknown>; required: string[]; additionalProperties: boolean;
      };
      assert.deepEqual([...required].sort(), Object.keys(properties).sort(), tool.name);
      assert.equal(additionalProperties, false);
      assert.equal(tool.strict, true);
    }
  });

  it('toChatVehicle keeps only the fields the widget shows', () => {
    assert.deepEqual(Object.keys(toChatVehicle(STOCK[0])).sort(), ['category', 'condition', 'id', 'mileage', 'model', 'name', 'price', 'year']);
  });
});
