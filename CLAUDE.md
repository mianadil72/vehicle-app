# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Car dealership vehicle management system: browse the inventory for sale, classified by category, with name (make), model, year and price as the core fields. Vite + React 19 + TypeScript front end, Express 5 API in `server/`, SQL Server database.

## Commands

- `npm run db:setup`: create the `VehicleInventory` database if missing, apply `server/db/schema.sql`, seed `server/db/seed.sql` (idempotent)
- `npm run dev:api`: Express API on http://localhost:3001 (`node --watch`, runs the `.ts` files directly via Node type stripping)
- `npm run dev`: Vite dev server with HMR at http://localhost:5173; proxies `/api` to the API, so run both
- `npm start`: API plus the built `dist/` front end from a single server
- `npm run build`: `tsc -b` type-check (app, vite config and `server/`), then a production build to `dist/`. Use this to verify changes.
- `npm run lint`: Oxlint (config in `.oxlintrc.json`)
- `npm run preview`: serve the built `dist/`

There is no test runner configured.

## Architecture

- **Data model** (`src/types.ts`): `Vehicle` interface plus `CATEGORIES`, an `as const` tuple from which the `Category` union is derived. To add a category, add it to the tuple **and** add a silhouette for it in `SHAPES` in `src/components/VehicleIllustration.tsx`; the `Record<Category, …>` type makes the build fail until you do. Condition badges are styled by class name (`.cond-<lowercase condition>` in `App.css`).
- **Database** (`server/db/`): `dbo.Vehicles` (columns `Make`/`ModelYear` map to `name`/`year`) and `dbo.VehiclePhotos` (ordered photo URLs). Category and Condition are `CHECK` constraints, so adding a category also means updating `CK_Vehicles_Category` in `schema.sql` (and writing a migration for existing databases). Schema scripts must stay re-runnable; batches are split on `GO`.
- **Connection** (`server/db.ts`): configured by `.env` (template in `.env.example`, loaded via `node --env-file-if-exists`). `DB_DRIVER=msnodesqlv8` uses ODBC + Windows auth, which works with the local SQL Express instance without TCP/IP enabled; the default `tedious` driver needs TCP and a SQL login (`DB_USER`/`DB_PASSWORD`). Always pass values as `request.input(...)` parameters, never by string concatenation.
- **API** (`server/index.ts`, queries in `server/vehicles.ts`): `GET /api/vehicles?category=&exclude=&limit=`, `GET /api/vehicles/:id` (404 when missing), `GET /api/health`. Rows are mapped to the shared `Vehicle` type from `src/types.ts`, so the server and the UI use one type definition. Server code must use only erasable TS syntax and import with `.ts` extensions (`tsconfig.server.json`).
- **Client data loading** (`src/api.ts`): `fetchVehicles`/`fetchVehicle` plus the `useRemote(key, load)` hook (loading/error/ready, with retry); `components/RemoteStatus.tsx` renders the loading/error states. The inventory page loads everything once and filters client-side; filter bounds (min year, max price) are derived from the loaded data. The detail page fetches the vehicle and its "similar" vehicles separately.
- **Routing** (React Router, `BrowserRouter` in `src/main.tsx`, routes in `src/App.tsx`): `/` → `pages/InventoryPage.tsx`, `/vehicles/:id` → `pages/VehicleDetailPage.tsx`. Any unknown path also renders the detail page, which shows its "not found" state.
- **Inventory filters live in the URL query string** (`cat`, `q`, `minYear`, `maxPrice`, `sort`, `view`), read and written via `useSearchParams`, with default values left out of the URL. Links to a detail page pass `state.from` (the current path + query), and the detail page's back link uses it so filters are preserved. Keep that pattern when adding new links into the detail page.
- **Photos**: `Vehicle.photos` is an optional list of URLs (files go in `public/vehicles/<id>/`). `src/slides.ts` turns a vehicle into gallery "slides", and `components/VehiclePhoto.tsx` renders one. When a vehicle has no photos, it uses generated SVG placeholders from `VehicleIllustration.tsx` (a category silhouette tinted with `colorHex`). Cards, gallery and thumbnails all render through `VehiclePhoto`, so real photos replace the placeholders everywhere at once.
- **Formatting** (`src/format.ts`): shared `Intl` formatters for USD price and mileage; use them rather than formatting inline.
- **Styling**: plain CSS, no framework. Theme tokens (`--bg`, `--surface`, `--accent`, …) are in `src/index.css`, with a `prefers-color-scheme: dark` override. Component styles are in `src/App.css`. Use the tokens so both themes keep working.
