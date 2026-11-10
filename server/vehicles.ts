import { getPool, sql } from './db.ts';
import type { Category, Condition, Vehicle } from '../src/types.ts';

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
