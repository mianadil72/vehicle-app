import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { CATEGORIES, type Category } from '../src/types.ts';
import { closePools, getPool } from './db.ts';
import { getVehicle, listVehicles } from './vehicles.ts';

const app = express();
app.disable('x-powered-by');

const toId = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : undefined;
};

app.get('/api/health', async (_req, res) => {
  await (await getPool()).request().query('SELECT 1 AS ok');
  res.json({ ok: true });
});

// GET /api/vehicles?category=SUV&exclude=4&limit=3
app.get('/api/vehicles', async (req, res) => {
  const { category, exclude, limit } = req.query;
  if (category !== undefined && !(CATEGORIES as readonly unknown[]).includes(category)) {
    res.status(400).json({ error: `Unknown category. Expected one of: ${CATEGORIES.join(', ')}` });
    return;
  }
  const lim = limit === undefined ? undefined : Number(limit);
  if (lim !== undefined && !(Number.isInteger(lim) && lim > 0 && lim <= 500)) {
    res.status(400).json({ error: 'limit must be an integer between 1 and 500' });
    return;
  }
  res.json(
    await listVehicles({
      category: category as Category | undefined,
      excludeId: exclude === undefined ? undefined : toId(exclude),
      limit: lim,
    }),
  );
});

app.get('/api/vehicles/:id', async (req, res) => {
  const id = toId(req.params.id);
  const vehicle = id === undefined ? null : await getVehicle(id);
  if (!vehicle) {
    res.status(404).json({ error: 'Vehicle not found' });
    return;
  }
  res.json(vehicle);
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// In production (`npm start` after `npm run build`), also serve the built front end.
const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: dist }));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Database error' });
});

const port = Number(process.env.API_PORT) || 3001;
const server = app.listen(port, () => console.log(`API listening on http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void closePools().finally(() => process.exit(0));
  });
}
