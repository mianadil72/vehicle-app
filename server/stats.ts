import { getPool } from './db.ts';
import { CATEGORIES, CONDITIONS, type Category, type Condition, type InventoryFigures, type InventoryStats } from '../src/types.ts';

interface GroupRow {
  Category: Category;
  Condition: Condition;
  Units: number;
  TotalValue: number;
  TotalMileage: number;
  TotalYear: number;
}

interface Sums {
  count: number;
  byCondition: Record<Condition, number>;
  value: number;
  mileage: number;
  year: number;
}

const emptySums = (): Sums => ({
  count: 0,
  byCondition: Object.fromEntries(CONDITIONS.map((c) => [c, 0])) as Record<Condition, number>,
  value: 0,
  mileage: 0,
  year: 0,
});

const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;

const toFigures = (s: Sums): InventoryFigures => ({
  count: s.count,
  byCondition: s.byCondition,
  totalValue: round(s.value, 2),
  avgPrice: s.count ? round(s.value / s.count) : null,
  avgMileage: s.count ? round(s.mileage / s.count) : null,
  avgYear: s.count ? round(s.year / s.count, 1) : null,
});

/** Inventory counts and value per category, split by condition. One grouped query; the rest is summing. */
export async function inventoryStats(): Promise<InventoryStats> {
  const pool = await getPool();
  // Sums rather than averages so categories and the grand total can be combined exactly.
  const { recordset } = await pool.request().query<GroupRow>(`
    SELECT Category, Condition,
           COUNT(*)                          AS Units,
           SUM(CAST(Price AS DECIMAL(19,2))) AS TotalValue,
           SUM(CAST(Mileage AS BIGINT))      AS TotalMileage,
           SUM(CAST(ModelYear AS BIGINT))    AS TotalYear
      FROM dbo.Vehicles
     WHERE SaleStatus = 'Available'
     GROUP BY Category, Condition`);

  const total = emptySums();
  const perCategory = new Map<Category, Sums>(CATEGORIES.map((c) => [c, emptySums()]));
  for (const row of recordset) {
    const units = Number(row.Units);
    for (const s of [total, perCategory.get(row.Category)]) {
      if (!s) continue; // a category in the database that the app doesn't know about
      s.count += units;
      s.byCondition[row.Condition] = (s.byCondition[row.Condition] ?? 0) + units;
      s.value += Number(row.TotalValue);
      s.mileage += Number(row.TotalMileage);
      s.year += Number(row.TotalYear);
    }
  }

  return {
    total: toFigures(total),
    categories: CATEGORIES.map((category) => ({ category, ...toFigures(perCategory.get(category)!) })),
    generatedAt: new Date().toISOString(),
  };
}
