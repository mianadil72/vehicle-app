// Downloads the manufacturer press photos listed in pressPhotos.ts into public/vehicles/models/ and
// attaches each one to the vehicles of that make and model that have no photos yet.
// Usage: npm run db:photos [-- --refresh]   (--refresh downloads every image again)
// Safe to re-run: existing files are kept and vehicles that already have photos are left alone.
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { closePools, getPool, sql } from '../db.ts';
import { PRESS_PHOTOS, imageExtension, photoSlug } from './pressPhotos.ts';

const DIR = new URL('../../public/vehicles/models/', import.meta.url);
const URL_PREFIX = '/vehicles/models/';
const MAX_BYTES = 5 * 1024 * 1024;
const refresh = process.argv.includes('--refresh');

/** Returns the file name in public/vehicles/models/, downloading the image unless it's already there. */
async function download(image: string, slug: string, existing: string[]): Promise<{ file: string; fetched: boolean }> {
  if (image.startsWith(URL_PREFIX)) {
    const file = image.slice(URL_PREFIX.length);
    if (!existsSync(new URL(file, DIR))) throw new Error(`local file public${image} is missing`);
    return { file, fetched: false };
  }
  const have = existing.find((f) => f.startsWith(`${slug}.`));
  if (have && !refresh) return { file: have, fetched: false };
  const res = await fetch(image, { headers: { 'User-Agent': 'vehicle-app-workshop photo import', Accept: 'image/jpeg,image/png,image/webp' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ext = imageExtension(res.headers.get('content-type') ?? '');
  if (!ext) throw new Error(`not an image (${res.headers.get('content-type')})`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error(`too large (${Math.round(body.length / 1024)} KB)`);
  const file = `${slug}.${ext}`;
  await writeFile(new URL(file, DIR), body);
  return { file, fetched: true };
}

try {
  await mkdir(DIR, { recursive: true });
  const existing = await readdir(DIR);
  const mssql = await sql();
  const db = await getPool();
  let downloaded = 0, linked = 0;
  const failed: string[] = [];

  for (const [make, model, , image] of PRESS_PHOTOS) {
    const slug = photoSlug(make, model);
    let file: string;
    try {
      const result = await download(image, slug, existing);
      file = result.file;
      if (result.fetched) downloaded++;
    } catch (err) {
      failed.push(`${make} ${model}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const { rowsAffected } = await db
      .request()
      .input('make', mssql.NVarChar(50), make)
      .input('model', mssql.NVarChar(100), model)
      .input('url', mssql.NVarChar(400), URL_PREFIX + file)
      .query(`INSERT INTO dbo.VehiclePhotos (VehicleId, SortOrder, Url)
              SELECT v.VehicleId, 0, @url FROM dbo.Vehicles v
              WHERE v.Make = @make AND v.Model = @model
                AND NOT EXISTS (SELECT 1 FROM dbo.VehiclePhotos p WHERE p.VehicleId = v.VehicleId)`);
    linked += rowsAffected[0];
  }

  console.log(`${PRESS_PHOTOS.length} models: ${downloaded} images downloaded, ${linked} vehicles given a photo`);
  if (failed.length) {
    console.warn(`${failed.length} failed (those vehicles keep the placeholder):\n  ${failed.join('\n  ')}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error('Photo import failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePools();
}
