# Vehicle Inventory

Dealership inventory browser: React + Vite front end, Express API, SQL Server database.

## Setup

1. Copy `.env.example` to `.env` and set the connection details:
   - **Local SQL Server Express on Windows** (default in the template): Windows authentication through
     the ODBC driver (`DB_DRIVER=msnodesqlv8`). Requires *ODBC Driver 17 or 18 for SQL Server*.
   - **Docker / Linux / Azure SQL**: `DB_DRIVER=tedious` with `DB_SERVER`, `DB_PORT`, `DB_USER` and `DB_PASSWORD`.
2. `npm install`
3. `npm run db:setup` creates the `VehicleInventory` database, its tables and the sample inventory. It is safe to re-run.

## Run

```sh
npm run dev:api   # API on http://localhost:3001
npm run dev       # UI on http://localhost:5173 (proxies /api to the API)
```

Production: `npm run build && npm start` serves the API and the built UI from one server.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/vehicles` | Optional `category`, `exclude` (vehicle id), `limit` |
| GET | `/api/vehicles/:id` | 404 if not found |
| GET | `/api/health` | Checks the database connection |
