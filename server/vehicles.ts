import type { ConnectionPool, Transaction } from 'mssql';
import { getPool, sql } from './db.ts';
import type { Category, Condition, Vehicle } from '../src/types.ts';
import type { VehicleInput } from '../src/validation.ts';

/** Thrown when the stock number is already used by another vehicle. */
export class DuplicateStockNumberError extends Error {
  constructor(stockNumber: string) {
    super(`Stock # ${stockNumber} is already in use`);
    this.name = 'DuplicateStockNumberError';
  }
}

// SQL Server error numbers for unique constraint / unique index violations.
const isUniqueViolation = (err: unknown) => {
  const number = (err as { number?: number } | null)?.number;
  return number === 2627 || number === 2601;
};

interface VehicleRow {
  VehicleId: number;
  Make: string;
  Model: string;
  ModelYear: number;
  Price: number;
  Category: Category;
  Condition: Condition;
  Mileage: number;
  Color: string;
  ColorHex: string;
  StockNumber: string;
  PhotosJson: string | null;
}

const selectVehicles = (top = '') => `
  SELECT ${top}v.VehicleId, v.Make, v.Model, v.ModelYear, v.Price, v.Category, v.Condition,
         v.Mileage, v.Color, v.ColorHex, v.StockNumber,
         (SELECT p.Url FROM dbo.VehiclePhotos p
           WHERE p.VehicleId = v.VehicleId
           ORDER BY p.SortOrder
           FOR JSON PATH) AS PhotosJson
  FROM dbo.Vehicles v`;

function toVehicle(row: VehicleRow): Vehicle {
  const photos = row.PhotosJson ? (JSON.parse(row.PhotosJson) as { Url: string }[]).map((p) => p.Url) : [];
  return {
    id: String(row.VehicleId),
    name: row.Make,
    model: row.Model,
    year: row.ModelYear,
    price: Number(row.Price),
    category: row.Category,
    condition: row.Condition,
    mileage: row.Mileage,
    color: row.Color,
    colorHex: row.ColorHex,
    stockNumber: row.StockNumber,
    ...(photos.length > 0 && { photos }),
  };
}

export interface VehicleQuery {
  category?: Category;
  /** Leave this vehicle out of the results (used for "similar vehicles"). */
  excludeId?: number;
  limit?: number;
}

export async function listVehicles(query: VehicleQuery = {}): Promise<Vehicle[]> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const request = pool.request();
  const where: string[] = [];

  if (query.category) {
    request.input('category', mssql.NVarChar(20), query.category);
    where.push('v.Category = @category');
  }
  if (query.excludeId !== undefined) {
    request.input('excludeId', mssql.Int, query.excludeId);
    where.push('v.VehicleId <> @excludeId');
  }
  const top = query.limit !== undefined ? 'TOP (@limit) ' : '';
  if (top) request.input('limit', mssql.Int, query.limit);

  const result = await request.query<VehicleRow>(
    selectVehicles(top) +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY v.VehicleId',
  );
  return result.recordset.map(toVehicle);
}

export async function getVehicle(id: number): Promise<Vehicle | null> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const result = await pool
    .request()
    .input('id', mssql.Int, id)
    .query<VehicleRow>(`${selectVehicles()} WHERE v.VehicleId = @id`);
  const row = result.recordset[0];
  return row ? toVehicle(row) : null;
}

/** Runs `work` in a transaction: commits when it resolves, rolls back when it throws. */
async function inTransaction<T>(pool: ConnectionPool, work: (tx: Transaction) => Promise<T>): Promise<T> {
  const mssql = await sql();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/** Saves a vehicle, translating a duplicate stock number into a `DuplicateStockNumberError`. */
async function save<T>(input: VehicleInput, work: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await inTransaction(await getPool(), work);
  } catch (err) {
    throw isUniqueViolation(err) ? new DuplicateStockNumberError(input.stockNumber) : err;
  }
}

async function writeFields(tx: Transaction, input: VehicleInput) {
  const mssql = await sql();
  return tx
    .request()
    .input('make', mssql.NVarChar(50), input.name)
    .input('model', mssql.NVarChar(100), input.model)
    .input('year', mssql.SmallInt, input.year)
    .input('price', mssql.Decimal(10, 2), input.price)
    .input('category', mssql.NVarChar(20), input.category)
    .input('condition', mssql.NVarChar(20), input.condition)
    .input('mileage', mssql.Int, input.mileage)
    .input('color', mssql.NVarChar(50), input.color)
    .input('colorHex', mssql.Char(7), input.colorHex)
    .input('stockNumber', mssql.VarChar(20), input.stockNumber);
}

async function replacePhotos(tx: Transaction, vehicleId: number, photos: string[]) {
  const mssql = await sql();
  await tx.request().input('id', mssql.Int, vehicleId).query('DELETE FROM dbo.VehiclePhotos WHERE VehicleId = @id');
  for (const [i, url] of photos.entries()) {
    await tx
      .request()
      .input('id', mssql.Int, vehicleId)
      .input('sort', mssql.Int, i)
      .input('url', mssql.NVarChar(400), url)
      .query('INSERT INTO dbo.VehiclePhotos (VehicleId, SortOrder, Url) VALUES (@id, @sort, @url)');
  }
}

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  const id = await save(input, async (tx) => {
    const result = await (await writeFields(tx, input)).query<{ VehicleId: number }>(`
      INSERT INTO dbo.Vehicles (Make, Model, ModelYear, Price, Category, Condition, Mileage, Color, ColorHex, StockNumber)
      OUTPUT INSERTED.VehicleId
      VALUES (@make, @model, @year, @price, @category, @condition, @mileage, @color, @colorHex, @stockNumber)`);
    const newId = result.recordset[0].VehicleId;
    await replacePhotos(tx, newId, input.photos);
    return newId;
  });
  return (await getVehicle(id))!;
}

/** Returns `null` when the vehicle doesn't exist. */
export async function updateVehicle(id: number, input: VehicleInput): Promise<Vehicle | null> {
  const mssql = await sql();
  const updated = await save(input, async (tx) => {
    const result = await (await writeFields(tx, input)).input('id', mssql.Int, id).query(`
      UPDATE dbo.Vehicles
         SET Make = @make, Model = @model, ModelYear = @year, Price = @price, Category = @category,
             Condition = @condition, Mileage = @mileage, Color = @color, ColorHex = @colorHex,
             StockNumber = @stockNumber, UpdatedAt = SYSUTCDATETIME()
       WHERE VehicleId = @id`);
    if (result.rowsAffected[0] === 0) return false;
    await replacePhotos(tx, id, input.photos);
    return true;
  });
  return updated ? getVehicle(id) : null;
}

/** Returns `false` when the vehicle doesn't exist. Photos are removed by ON DELETE CASCADE. */
export async function deleteVehicle(id: number): Promise<boolean> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const result = await pool.request().input('id', mssql.Int, id).query('DELETE FROM dbo.Vehicles WHERE VehicleId = @id');
  return result.rowsAffected[0] > 0;
}
