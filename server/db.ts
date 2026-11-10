import type { ConnectionPool, config as SqlConfig } from 'mssql';

/**
 * SQL Server connection settings, read from environment variables (see `.env.example`).
 *
 * Two drivers are supported:
 * - `tedious` (default): pure JavaScript, connects over TCP with SQL logins. Works with Docker,
 *   Linux/macOS and Azure SQL. Requires TCP/IP to be enabled on the server.
 * - `msnodesqlv8`: Windows only, goes through the ODBC driver. Supports Windows authentication
 *   (leave DB_USER empty) and local shared-memory connections, so a default SQL Server Express
 *   install works without enabling TCP/IP.
 */
const env = process.env;
const useOdbc = env.DB_DRIVER === 'msnodesqlv8';

export const DB_NAME = env.DB_NAME || 'VehicleInventory';

function buildConfig(database: string): SqlConfig {
  const config: SqlConfig = {
    server: env.DB_SERVER || 'localhost',
    database,
    options: {
      encrypt: env.DB_ENCRYPT !== 'false',
      trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
  };
  if (env.DB_INSTANCE) config.options!.instanceName = env.DB_INSTANCE;
  else if (env.DB_PORT) config.port = Number(env.DB_PORT);

  if (env.DB_USER) {
    config.user = env.DB_USER;
    config.password = env.DB_PASSWORD ?? '';
  } else if (useOdbc) {
    config.options!.trustedConnection = true;
  } else {
    throw new Error('DB_USER is required with the tedious driver. Set DB_DRIVER=msnodesqlv8 to use Windows authentication.');
  }
  if (useOdbc) {
    config.driver = env.DB_ODBC_DRIVER || 'ODBC Driver 18 for SQL Server';
    // mssql's ODBC adapter doesn't pass trustServerCertificate through; add it to the connection string.
    if (config.options!.trustServerCertificate) {
      config.beforeConnect = (conn) => {
        const cfg = conn as unknown as { conn_str: string };
        cfg.conn_str = `${cfg.conn_str.replace(/;?$/, ';')}TrustServerCertificate=yes;`;
      };
    }
  }
  return config;
}

type Mssql = typeof import('mssql');
let driver: Promise<Mssql> | undefined;

/** The `mssql` module for the configured driver (loaded once, on first use). */
export function sql(): Promise<Mssql> {
  driver ??= (useOdbc ? import('mssql/msnodesqlv8.js') : import('mssql')).then(
    (m) => (m.default ?? m) as Mssql,
  );
  return driver;
}

const pools = new Map<string, Promise<ConnectionPool>>();

/** A shared connection pool for `database` (the app database by default). */
export function getPool(database = DB_NAME): Promise<ConnectionPool> {
  let pool = pools.get(database);
  if (!pool) {
    pool = sql().then((mssql) => new mssql.ConnectionPool(buildConfig(database)).connect());
    // Don't cache a failed connection attempt, so the next request retries.
    pool.catch(() => pools.delete(database));
    pools.set(database, pool);
  }
  return pool;
}

export async function closePools(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  await Promise.allSettled(all.map(async (p) => (await p).close()));
}
