import type { ConnectionPool } from 'mssql';
import { sql } from '../db.ts';
import type { Category, Condition } from '../../src/types.ts';

/**
 * Generated demo inventory: BULK_COUNT vehicles from economy to exotic, across the major brands.
 * Deterministic (fixed PRNG seed), so every database gets the same rows, and stock numbers
 * `G-00001`… let `npm run db:setup` skip rows that already exist (safe to re-run).
 */

export const BULK_COUNT = 1000;

// [make, model, category, new price (USD), popularity weight, first model year?, last model year?]
// The years keep the data believable: no 2017 Model Y, no new Charger R/T after it ended in 2023.
type Entry = [string, string, Category, number, number, number?, number?];

const CATALOG: Entry[] = [
  // Economy & mainstream
  ['Toyota', 'Corolla LE', 'Sedan', 23500, 9], ['Toyota', 'Camry SE', 'Sedan', 29500, 9], ['Toyota', 'Prius', 'Sedan', 29000, 4],
  ['Toyota', 'RAV4 XLE', 'SUV', 33500, 10], ['Toyota', 'Highlander XLE', 'SUV', 45500, 6], ['Toyota', '4Runner SR5', 'SUV', 42000, 4],
  ['Toyota', 'Tacoma TRD Sport', 'Truck', 40000, 7], ['Toyota', 'Tundra SR5', 'Truck', 49000, 4], ['Toyota', 'Sienna XLE', 'Van', 44000, 4],
  ['Toyota', 'GR86', 'Coupe', 31000, 2, 2022], ['Toyota', 'bZ4X', 'Electric', 44000, 2, 2023],
  ['Honda', 'Civic EX', 'Sedan', 26500, 9], ['Honda', 'Accord Sport', 'Sedan', 31500, 7], ['Honda', 'CR-V EX', 'SUV', 34000, 9],
  ['Honda', 'HR-V LX', 'SUV', 25500, 5, 2016], ['Honda', 'Pilot EX-L', 'SUV', 45000, 5], ['Honda', 'Ridgeline RTL', 'Truck', 44000, 3],
  ['Honda', 'Odyssey EX', 'Van', 41000, 4], ['Honda', 'Prologue EX', 'Electric', 49000, 2, 2024],
  ['Ford', 'Escape SE', 'SUV', 31000, 6], ['Ford', 'Explorer XLT', 'SUV', 42000, 6], ['Ford', 'Bronco Big Bend', 'SUV', 42500, 4, 2021],
  ['Ford', 'F-150 XLT', 'Truck', 52000, 12], ['Ford', 'Ranger XLT', 'Truck', 38000, 5, 2019], ['Ford', 'Maverick XLT', 'Truck', 29000, 5, 2022],
  ['Ford', 'Mustang EcoBoost', 'Coupe', 33000, 4], ['Ford', 'Mustang GT', 'Coupe', 44000, 3], ['Ford', 'Mustang Mach-E Select', 'Electric', 42000, 3, 2021],
  ['Ford', 'Transit Connect XLT', 'Van', 36000, 2, 2016, 2023],
  ['Chevrolet', 'Malibu LT', 'Sedan', 27500, 5, 2016, 2025], ['Chevrolet', 'Trax LT', 'SUV', 23500, 6], ['Chevrolet', 'Equinox LT', 'SUV', 31000, 7],
  ['Chevrolet', 'Tahoe LT', 'SUV', 64000, 4], ['Chevrolet', 'Silverado 1500 LT', 'Truck', 52000, 10], ['Chevrolet', 'Colorado LT', 'Truck', 36000, 4],
  ['Chevrolet', 'Camaro 1LT', 'Coupe', 33000, 2, 2016, 2024], ['Chevrolet', 'Corvette Stingray', 'Coupe', 70000, 2, 2016], ['Chevrolet', 'Bolt EUV', 'Electric', 29000, 3, 2022, 2023],
  ['Chevrolet', 'Equinox EV', 'Electric', 35000, 2, 2024],
  ['Nissan', 'Sentra SV', 'Sedan', 22500, 7], ['Nissan', 'Altima SV', 'Sedan', 28000, 6], ['Nissan', 'Rogue SV', 'SUV', 32000, 8],
  ['Nissan', 'Pathfinder SL', 'SUV', 44000, 3], ['Nissan', 'Frontier SV', 'Truck', 36000, 3], ['Nissan', 'Leaf SV Plus', 'Electric', 37000, 2],
  ['Nissan', 'Z Performance', 'Coupe', 53000, 1, 2023],
  ['Hyundai', 'Elantra SEL', 'Sedan', 23500, 7], ['Hyundai', 'Sonata SEL', 'Sedan', 29000, 4], ['Hyundai', 'Tucson SEL', 'SUV', 31500, 7],
  ['Hyundai', 'Santa Fe SEL', 'SUV', 37000, 5], ['Hyundai', 'Palisade SEL', 'SUV', 44000, 3, 2020], ['Hyundai', 'Ioniq 5 SE', 'Electric', 44000, 3, 2022],
  ['Hyundai', 'Santa Cruz SEL', 'Truck', 33000, 2, 2022],
  ['Kia', 'Forte LXS', 'Sedan', 21500, 6], ['Kia', 'K5 GT-Line', 'Sedan', 29000, 4, 2021], ['Kia', 'Sportage EX', 'SUV', 32000, 7],
  ['Kia', 'Sorento EX', 'SUV', 38000, 4], ['Kia', 'Telluride EX', 'SUV', 45000, 4, 2020], ['Kia', 'Carnival EX', 'Van', 41000, 3, 2022],
  ['Kia', 'EV6 Wind', 'Electric', 48000, 3, 2022], ['Kia', 'EV9 Light', 'Electric', 56000, 1, 2024],
  ['Subaru', 'Impreza Sport', 'Sedan', 25000, 3], ['Subaru', 'Crosstrek Premium', 'SUV', 28000, 6, 2016], ['Subaru', 'Forester Premium', 'SUV', 32000, 6],
  ['Subaru', 'Outback Premium', 'SUV', 33000, 6], ['Subaru', 'Ascent Premium', 'SUV', 40000, 2, 2019], ['Subaru', 'WRX Premium', 'Sedan', 35000, 2],
  ['Subaru', 'BRZ Limited', 'Coupe', 33000, 1],
  ['Mazda', 'Mazda3 Select', 'Sedan', 25500, 5], ['Mazda', 'CX-30 Select', 'SUV', 27500, 5, 2020], ['Mazda', 'CX-5 Preferred', 'SUV', 31500, 7],
  ['Mazda', 'CX-50 Preferred', 'SUV', 34000, 3, 2023], ['Mazda', 'CX-90 Preferred', 'SUV', 44000, 2, 2024], ['Mazda', 'MX-5 Miata Club', 'Coupe', 34500, 2],
  ['Volkswagen', 'Jetta SE', 'Sedan', 25000, 5], ['Volkswagen', 'Golf GTI', 'Coupe', 34000, 2], ['Volkswagen', 'Tiguan SE', 'SUV', 33000, 5],
  ['Volkswagen', 'Atlas SE', 'SUV', 42000, 3, 2018], ['Volkswagen', 'ID.4 Pro', 'Electric', 44000, 3, 2021],
  ['Jeep', 'Wrangler Sport', 'SUV', 38000, 6], ['Jeep', 'Grand Cherokee Limited', 'SUV', 48000, 6], ['Jeep', 'Compass Latitude', 'SUV', 31000, 4],
  ['Jeep', 'Gladiator Sport', 'Truck', 42000, 2, 2020],
  ['Ram', '1500 Big Horn', 'Truck', 50000, 9], ['Ram', '2500 Laramie', 'Truck', 68000, 3], ['Ram', 'ProMaster 2500', 'Van', 48000, 2],
  ['GMC', 'Sierra 1500 SLE', 'Truck', 55000, 6], ['GMC', 'Canyon Elevation', 'Truck', 40000, 2], ['GMC', 'Terrain SLE', 'SUV', 33000, 3],
  ['GMC', 'Yukon SLT', 'SUV', 72000, 3], ['GMC', 'Hummer EV Pickup', 'Electric', 97000, 1, 2022],
  ['Dodge', 'Charger R/T', 'Sedan', 43000, 2, 2016, 2023], ['Dodge', 'Challenger R/T', 'Coupe', 41000, 2, 2016, 2023], ['Dodge', 'Durango GT', 'SUV', 44000, 2],
  ['Chrysler', 'Pacifica Touring L', 'Van', 43000, 3], ['Buick', 'Encore GX Preferred', 'SUV', 27500, 3, 2020], ['Buick', 'Enclave Essence', 'SUV', 47000, 2],
  ['Mini', 'Cooper S Hardtop', 'Coupe', 33000, 2], ['Mini', 'Countryman S', 'SUV', 40000, 1],
  ['Tesla', 'Model 3 Long Range', 'Electric', 47000, 6, 2017], ['Tesla', 'Model Y Long Range', 'Electric', 50000, 8, 2020],
  ['Tesla', 'Model S', 'Electric', 80000, 2], ['Tesla', 'Model X', 'Electric', 90000, 1], ['Tesla', 'Cybertruck AWD', 'Electric', 82000, 1, 2024],
  ['Rivian', 'R1S Adventure', 'Electric', 84000, 1, 2022], ['Rivian', 'R1T Adventure', 'Electric', 79000, 1, 2022], ['Polestar', '2 Long Range', 'Electric', 51000, 1, 2021],
  ['Lucid', 'Air Touring', 'Electric', 79000, 1, 2022],
  // Premium
  ['BMW', '330i', 'Sedan', 47000, 5], ['BMW', '540i xDrive', 'Sedan', 64000, 3], ['BMW', 'M3 Competition', 'Sedan', 82000, 1],
  ['BMW', 'X3 xDrive30i', 'SUV', 50000, 5], ['BMW', 'X5 xDrive40i', 'SUV', 68000, 4], ['BMW', 'X7 xDrive40i', 'SUV', 84000, 1, 2019],
  ['BMW', 'M4 Competition', 'Coupe', 84000, 1], ['BMW', 'i4 eDrive40', 'Electric', 57000, 2, 2022], ['BMW', 'iX xDrive50', 'Electric', 88000, 1, 2022],
  ['Mercedes-Benz', 'C 300', 'Sedan', 48000, 5], ['Mercedes-Benz', 'E 350', 'Sedan', 62000, 3], ['Mercedes-Benz', 'S 500 4MATIC', 'Sedan', 120000, 1],
  ['Mercedes-Benz', 'GLC 300', 'SUV', 50000, 5], ['Mercedes-Benz', 'GLE 350', 'SUV', 63000, 3], ['Mercedes-Benz', 'GLS 450', 'SUV', 90000, 1],
  ['Mercedes-Benz', 'AMG G 63', 'SUV', 180000, 1, 2016], ['Mercedes-Benz', 'EQE 350+', 'Electric', 76000, 1, 2023], ['Mercedes-Benz', 'Sprinter 2500 Cargo', 'Van', 56000, 2],
  ['Audi', 'A4 Premium', 'Sedan', 44000, 4], ['Audi', 'A6 Premium Plus', 'Sedan', 61000, 2], ['Audi', 'Q3 Premium', 'SUV', 39000, 3],
  ['Audi', 'Q5 Premium Plus', 'SUV', 51000, 5], ['Audi', 'Q7 Premium Plus', 'SUV', 66000, 2], ['Audi', 'R8 V10 Performance', 'Coupe', 160000, 1],
  ['Audi', 'Q8 e-tron', 'Electric', 76000, 1, 2024],
  ['Lexus', 'IS 300', 'Sedan', 42000, 3], ['Lexus', 'ES 350', 'Sedan', 44000, 4], ['Lexus', 'NX 350', 'SUV', 45000, 5, 2022],
  ['Lexus', 'RX 350', 'SUV', 52000, 5], ['Lexus', 'GX 550', 'SUV', 66000, 2, 2024], ['Lexus', 'LC 500', 'Coupe', 100000, 1, 2018],
  ['Acura', 'Integra A-Spec', 'Sedan', 35000, 3, 2023], ['Acura', 'TLX A-Spec', 'Sedan', 47000, 2, 2021], ['Acura', 'RDX A-Spec', 'SUV', 49000, 3],
  ['Acura', 'MDX Technology', 'SUV', 56000, 2],
  ['Infiniti', 'Q50 Luxe', 'Sedan', 45000, 2, 2016, 2024], ['Infiniti', 'QX60 Luxe', 'SUV', 56000, 2, 2016],
  ['Genesis', 'G70 2.5T', 'Sedan', 43000, 2, 2022], ['Genesis', 'G80 2.5T', 'Sedan', 56000, 1, 2021], ['Genesis', 'GV70 2.5T', 'SUV', 48000, 2, 2022],
  ['Genesis', 'GV80 2.5T', 'SUV', 60000, 1, 2021], ['Genesis', 'GV60 Advanced', 'Electric', 54000, 1, 2023],
  ['Cadillac', 'CT5 Premium Luxury', 'Sedan', 50000, 2, 2020], ['Cadillac', 'XT5 Premium Luxury', 'SUV', 52000, 2], ['Cadillac', 'Escalade Premium Luxury', 'SUV', 98000, 2],
  ['Cadillac', 'Lyriq Luxury', 'Electric', 63000, 1, 2023],
  ['Lincoln', 'Corsair Reserve', 'SUV', 47000, 2, 2020], ['Lincoln', 'Aviator Reserve', 'SUV', 68000, 1, 2020], ['Lincoln', 'Navigator Reserve', 'SUV', 98000, 1],
  ['Volvo', 'S60 B5 Plus', 'Sedan', 47000, 2], ['Volvo', 'XC40 B5 Plus', 'SUV', 45000, 2, 2019], ['Volvo', 'XC60 B5 Plus', 'SUV', 52000, 3],
  ['Volvo', 'XC90 B6 Plus', 'SUV', 66000, 2], ['Volvo', 'EX30 Twin Motor', 'Electric', 46000, 1, 2025],
  ['Alfa Romeo', 'Giulia Ti', 'Sedan', 47000, 1, 2017], ['Alfa Romeo', 'Stelvio Ti', 'SUV', 50000, 1, 2018],
  ['Land Rover', 'Defender 110 S', 'SUV', 66000, 2, 2020], ['Land Rover', 'Range Rover Sport SE', 'SUV', 92000, 2], ['Land Rover', 'Range Rover Velar S', 'SUV', 64000, 1],
  ['Porsche', 'Macan S', 'SUV', 75000, 2], ['Porsche', 'Cayenne', 'SUV', 86000, 2], ['Porsche', '911 Carrera', 'Coupe', 122000, 2],
  ['Porsche', '718 Cayman', 'Coupe', 72000, 1], ['Porsche', 'Taycan 4S', 'Electric', 120000, 1, 2020], ['Porsche', 'Panamera 4', 'Sedan', 108000, 1],
  // Exotic & ultra-luxury
  ['Maserati', 'Ghibli Modena', 'Sedan', 92000, 1, 2021, 2024], ['Maserati', 'Grecale Modena', 'SUV', 85000, 1, 2023], ['Maserati', 'MC20', 'Coupe', 240000, 0.5, 2022],
  ['Jaguar', 'F-Pace P250', 'SUV', 60000, 1, 2017], ['Jaguar', 'F-Type R', 'Coupe', 105000, 0.5],
  ['Aston Martin', 'Vantage', 'Coupe', 195000, 0.5, 2019], ['Aston Martin', 'DBX707', 'SUV', 250000, 0.5, 2022],
  ['Bentley', 'Continental GT V8', 'Coupe', 250000, 0.5], ['Bentley', 'Bentayga V8', 'SUV', 210000, 0.5], ['Bentley', 'Flying Spur V8', 'Sedan', 225000, 0.3],
  ['Rolls-Royce', 'Ghost', 'Sedan', 360000, 0.3], ['Rolls-Royce', 'Cullinan', 'SUV', 410000, 0.3, 2019], ['Rolls-Royce', 'Spectre', 'Electric', 430000, 0.2, 2024],
  ['Lamborghini', 'Huracán EVO', 'Coupe', 270000, 0.4, 2020, 2024], ['Lamborghini', 'Urus S', 'SUV', 240000, 0.5, 2023], ['Lamborghini', 'Revuelto', 'Coupe', 610000, 0.2, 2024],
  ['Ferrari', 'Roma', 'Coupe', 250000, 0.4, 2021], ['Ferrari', '296 GTB', 'Coupe', 340000, 0.4, 2022], ['Ferrari', 'F8 Tributo', 'Coupe', 330000, 0.3, 2020, 2023],
  ['Ferrari', 'Purosangue', 'SUV', 400000, 0.2, 2023], ['Ferrari', '812 Competizione', 'Coupe', 600000, 0.1, 2022, 2023],
  ['McLaren', '750S', 'Coupe', 330000, 0.2, 2024], ['McLaren', 'Artura', 'Coupe', 240000, 0.2, 2023],
];

const COLORS: [string, string][] = [
  ['Super White', '#f2f2ee'], ['Pearl White', '#f4f3ef'], ['Silver Metallic', '#b8bcc2'], ['Magnetic Gray', '#5a5e63'],
  ['Midnight Black', '#15171b'], ['Jet Black', '#0e0f12'], ['Deep Blue Pearl', '#1e2a44'], ['Bright Blue', '#1f78d1'],
  ['Ruby Red', '#a3141c'], ['Candy Red', '#c8102e'], ['Forest Green', '#1f4d3a'], ['Sand Beige', '#c9b99a'],
  ['Burnt Orange', '#c45a1c'], ['Racing Yellow', '#f2c200'], ['Champagne', '#d8c8a8'], ['Graphite', '#3b3f45'],
];

// mulberry32: tiny seeded PRNG, so the generated inventory is the same every time.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BulkVehicle {
  make: string; model: string; year: number; price: number; category: Category; condition: Condition;
  mileage: number; color: string; colorHex: string; stockNumber: string;
}

/** The generated vehicles. Model years run from 10 years ago to next year (current model year). */
export function generateVehicles(count = BULK_COUNT, now = new Date(2026, 10, 1)): BulkVehicle[] {
  const random = prng(20261113);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  const totalWeight = CATALOG.reduce((sum, e) => sum + e[4], 0);
  // One of every catalog model first (so rare exotics like Lamborghini always appear), then the
  // rest by popularity weight.
  const pickModel = (i: number) => {
    if (i < CATALOG.length) return CATALOG[i];
    let r = random() * totalWeight;
    for (const e of CATALOG) if ((r -= e[4]) <= 0) return e;
    return CATALOG[CATALOG.length - 1];
  };
  const thisYear = now.getFullYear();
  const newestModelYear = thisYear + 1;

  return Array.from({ length: count }, (_, i) => {
    const [make, model, category, msrp, , firstYear = 0, lastYear = newestModelYear] = pickModel(i);
    // About a third new, a quarter certified pre-owned, the rest used.
    const roll = random();
    let condition: Condition = roll < 0.33 ? 'New' : roll < 0.58 ? 'Certified' : 'Used';
    // Discontinued models (last model year before this one) can't be sold new.
    if (condition === 'New' && lastYear < thisYear) condition = 'Certified';
    let year =
      condition === 'New' ? newestModelYear - Math.floor(random() * 2)
      : condition === 'Certified' ? thisYear - 1 - Math.floor(random() * 5)
      : thisYear - 2 - Math.floor(random() * 9);
    // Keep the year within the model's production run.
    year = Math.min(Math.max(year, firstYear), lastYear);
    if (condition !== 'New' && year >= thisYear) year = Math.max(firstYear, thisYear - 1);
    const age = Math.max(0, thisYear - year);
    // ~7-15k miles a year; exotics (MSRP $150k+) are weekend cars, ~1.5-4k a year.
    const yearly = msrp >= 150000 ? 1500 + random() * 2500 : 7000 + random() * 8000;
    const mileage = condition === 'New' ? Math.floor(random() * 60) : Math.round((age + 0.5) * yearly);
    // Depreciation ~13%/year plus a mileage penalty; exotics hold value better.
    const keep = msrp >= 150000 ? 0.92 : 0.87;
    const value = msrp * keep ** age * (condition === 'Certified' ? 1.04 : 1) * (1 - Math.min(0.25, mileage / 600000));
    const noisy = value * (0.94 + random() * 0.12);
    const price = Math.max(4500, Math.round(noisy / 50) * 50 - (random() < 0.5 ? 5 : 0)); // e.g. 23,495 / 23,500
    const [color, colorHex] = pick(COLORS);
    return {
      make, model, year, price, category, condition, mileage, color, colorHex,
      stockNumber: `G-${String(i + 1).padStart(5, '0')}`,
    };
  });
}

/** Inserts the generated vehicles that aren't in the database yet. Returns how many were added. */
export async function seedBulkVehicles(pool: ConnectionPool): Promise<number> {
  const mssql = await sql();
  const rows = generateVehicles();
  let added = 0;
  // 100 rows × 10 parameters per statement stays under SQL Server's 2,100-parameter limit.
  for (let start = 0; start < rows.length; start += 100) {
    const request = pool.request();
    const values = rows.slice(start, start + 100).map((v, i) => {
      request
        .input(`make${i}`, mssql.NVarChar(50), v.make)
        .input(`model${i}`, mssql.NVarChar(100), v.model)
        .input(`year${i}`, mssql.SmallInt, v.year)
        .input(`price${i}`, mssql.Decimal(10, 2), v.price)
        .input(`category${i}`, mssql.NVarChar(20), v.category)
        .input(`condition${i}`, mssql.NVarChar(20), v.condition)
        .input(`mileage${i}`, mssql.Int, v.mileage)
        .input(`color${i}`, mssql.NVarChar(50), v.color)
        .input(`colorHex${i}`, mssql.Char(7), v.colorHex)
        .input(`stock${i}`, mssql.VarChar(20), v.stockNumber);
      return `(@make${i}, @model${i}, @year${i}, @price${i}, @category${i}, @condition${i}, @mileage${i}, @color${i}, @colorHex${i}, @stock${i})`;
    });
    const result = await request.query(`
      INSERT INTO dbo.Vehicles (Make, Model, ModelYear, Price, Category, Condition, Mileage, Color, ColorHex, StockNumber)
      SELECT v.* FROM (VALUES ${values.join(',\n')})
        AS v (Make, Model, ModelYear, Price, Category, Condition, Mileage, Color, ColorHex, StockNumber)
      WHERE NOT EXISTS (SELECT 1 FROM dbo.Vehicles x WHERE x.StockNumber = v.StockNumber)`);
    added += result.rowsAffected[0] ?? 0;
  }
  return added;
}
