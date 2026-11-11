// Vehicle validation shared by the form (src/) and the API (server/), so both enforce the same rules.
// Imports use the `.ts` extension because Node runs this file directly on the server.
import { CATEGORIES, CONDITIONS, type Category, type Condition, type Vehicle } from './types.ts';

/** Everything except the database-assigned id. */
export type VehicleInput = Omit<Vehicle, 'id' | 'photos'> & { photos: string[] };

export type FieldErrors = Partial<Record<keyof VehicleInput, string>>;

export type Validation = { ok: true; value: VehicleInput } | { ok: false; errors: FieldErrors };

export const LIMITS = {
  minYear: 1900,
  maxYear: () => new Date().getFullYear() + 2,
  maxPrice: 99_999_999,
  maxMileage: 2_000_000,
  maxPhotos: 20,
} as const;

const STOCK_NUMBER = /^[A-Z0-9][A-Z0-9-]*$/;
const COLOR_HEX = /^#[0-9a-f]{6}$/i;
const PHOTO_URL = /^(\/|https?:\/\/)\S+$/i;

export function validateVehicle(raw: unknown): Validation {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: FieldErrors = {};

  const text = (key: keyof VehicleInput, label: string, max: number) => {
    const value = typeof input[key] === 'string' ? (input[key] as string).trim() : '';
    if (!value) errors[key] = `${label} is required`;
    else if (value.length > max) errors[key] = `${label} must be ${max} characters or fewer`;
    return value;
  };
  const whole = (key: keyof VehicleInput, label: string, min: number, max: number) => {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) errors[key] = `${label} is required`;
    else if (!Number.isInteger(value)) errors[key] = `${label} must be a whole number`;
    else if (value < min || value > max) errors[key] = `${label} must be between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}`;
    return value as number;
  };

  const name = text('name', 'Name', 50);
  const model = text('model', 'Model', 100);
  const year = whole('year', 'Year', LIMITS.minYear, LIMITS.maxYear());
  const mileage = whole('mileage', 'Mileage', 0, LIMITS.maxMileage);
  const color = text('color', 'Color', 50);

  const price = input.price;
  if (typeof price !== 'number' || !Number.isFinite(price)) errors.price = 'Price is required';
  else if (price <= 0 || price > LIMITS.maxPrice) errors.price = `Price must be between $1 and $${LIMITS.maxPrice.toLocaleString('en-US')}`;
  else if (Math.round(price * 100) !== price * 100) errors.price = 'Price can have at most 2 decimal places';

  const category = input.category as Category;
  if (!(CATEGORIES as readonly unknown[]).includes(category)) errors.category = 'Choose a category';

  const condition = input.condition as Condition;
  if (!(CONDITIONS as readonly unknown[]).includes(condition)) errors.condition = 'Choose a condition';

  const colorHex = typeof input.colorHex === 'string' ? input.colorHex.trim().toLowerCase() : '';
  if (!COLOR_HEX.test(colorHex)) errors.colorHex = 'Use a hex color like #1f5eff';

  const stockNumber = text('stockNumber', 'Stock #', 20).toUpperCase();
  if (stockNumber && !errors.stockNumber && !STOCK_NUMBER.test(stockNumber)) {
    errors.stockNumber = 'Use letters, numbers and dashes only';
  }

  const rawPhotos = input.photos ?? [];
  const photos = Array.isArray(rawPhotos)
    ? rawPhotos.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean)
    : [];
  if (!Array.isArray(rawPhotos)) errors.photos = 'Photos must be a list of URLs';
  else if (photos.length > LIMITS.maxPhotos) errors.photos = `At most ${LIMITS.maxPhotos} photos`;
  else {
    const bad = photos.find((p) => p.length > 400 || !PHOTO_URL.test(p));
    if (bad) errors.photos = `"${bad.slice(0, 60)}" isn't a valid URL. Use /vehicles/<id>/photo.jpg or https://…`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, model, year, price: price as number, category, condition, mileage, color, colorHex, stockNumber, photos },
  };
}
