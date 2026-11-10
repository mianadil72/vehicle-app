// Creates the database (if missing), applies schema.sql and loads seed.sql.
// Usage: npm run db:setup   (idempotent, safe to re-run)
import { readFile } from 'node:fs/promises';
import { DB_NAME, closePools, getPool, sql } from '../db.ts';

const batches = async (file: string) =>
  (await readFile(new URL(file, import.meta.url), 'utf8'))
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);

try {
  const mssql = await sql();
  const master = await getPool('master');
  await master
    .request()
    .input('name', mssql.NVarChar(128), DB_NAME)
    .query(`IF DB_ID(@name) IS NULL
            BEGIN
              DECLARE @sql NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(@name);
              EXEC sp_executesql @sql;
            END`);
  console.log(`Database ${DB_NAME} ready`);

  const db = await getPool();
  for (const file of ['schema.sql', 'seed.sql']) {
    for (const batch of await batches(file)) await db.request().batch(batch);
    console.log(`Applied ${file}`);
  }

  const { recordset } = await db.request().query<{ n: number }>('SELECT COUNT(*) AS n FROM dbo.Vehicles');
  console.log(`${recordset[0].n} vehicles in inventory`);
} catch (err) {
  console.error('Database setup failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePools();
}
