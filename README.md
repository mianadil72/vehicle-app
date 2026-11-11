# Vehicle Inventory

Dealership inventory browser: React + Vite front end, Express API, SQL Server database.

## Setup

1. Copy `.env.example` to `.env` and set the connection details:
   - **Local SQL Server Express on Windows** (default in the template): Windows authentication through
     the ODBC driver (`DB_DRIVER=msnodesqlv8`). Requires *ODBC Driver 17 or 18 for SQL Server*.
   - **Docker / Linux / Azure SQL**: `DB_DRIVER=tedious` with `DB_SERVER`, `DB_PORT`, `DB_USER` and `DB_PASSWORD`.
2. `npm install`
3. `npm run db:setup` creates the `VehicleInventory` database, its tables and the sample inventory. It is safe to re-run.
4. Create an admin account: `npm run user -- <username> --role admin` (it asks for a password, minimum 10 characters).

## Users and permissions

Anyone can browse the inventory. Only signed-in **admin** accounts can add, edit or delete vehicles. **Staff** accounts can sign in but only view. The API enforces this, not just the UI.

```sh
npm run user -- jsmith --role staff      # create a view-only account, or reset its password
npm run user -- jsmith --role admin      # make an admin (or reset an admin's password)
npm run user -- jsmith --deactivate      # block sign-in and end their sessions
npm run user -- --list                   # show all accounts
```

Signed-in admins can also change their own password, or reset another user's, from **Passwords** in the top bar (`/account/password`).

**Forgot password (no email):** a user clicks **Forgot password?** on the sign-in page and enters their username. Admins see the request on the Passwords page (the top-bar link shows a red count) and click **Create reset link**. They pass the link on in person or by chat. The user opens it and chooses a new password. Links work once and expire after 24 hours.

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
| POST | `/api/vehicles` | JSON vehicle without `id`; 201 with the created vehicle |
| PUT | `/api/vehicles/:id` | Replaces all fields, including the photo list |
| DELETE | `/api/vehicles/:id` | 204; photos are deleted with it |
| GET | `/api/health` | Checks the database connection |
| POST | `/api/auth/login` | `{ username, password }`; sets the session cookie |
| POST | `/api/auth/logout` | Ends the session |
| GET | `/api/auth/me` | `{ user }` (or `null` when signed out) |
| POST | `/api/auth/password` | Admin: `{ currentPassword, newPassword }` changes your own password |
| POST | `/api/auth/forgot` | `{ username }`; records a reset request (always 202) |
| POST | `/api/auth/reset/check` | `{ token }` → `{ username }` if the reset link is valid |
| POST | `/api/auth/reset` | `{ token, newPassword }` sets the password; the link stops working |
| GET | `/api/password-resets/requests` | Admin: open reset requests |
| DELETE | `/api/password-resets/requests/:userId` | Admin: dismiss a request |
| POST | `/api/users/:id/reset-link` | Admin: create a one-time reset link (24 h) |
| GET | `/api/users` | Admin: list accounts |
| POST | `/api/users/:id/password` | Admin: `{ newPassword }` resets another user's password |
| GET | `/api/vehicles/:id/comments` | Comments on a vehicle, newest first |
| POST | `/api/vehicles/:id/comments` | Admin: `{ body }` adds a comment |
| DELETE | `/api/vehicles/:id/comments/:commentId` | Admin: delete a comment |

Write requests return `400` (invalid fields) or `409` (stock # already used) as `{ "error": "...", "fields": { "<field>": "message" } }`.

POST, PUT and DELETE on `/api/vehicles` require a signed-in admin: they return `401` when signed out and `403` for staff.
