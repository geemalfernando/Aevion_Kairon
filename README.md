# Kairon

Delivery planning and operations for dispatchers, loaders, drivers and store managers. React shares its planning rules with a Fastify API backed by Supabase Auth and PostgreSQL.

The application starts empty. It does not create sample outlets, vehicles, products, orders, deliveries, GPS movements or forecasts. Synthetic data lives only in server test fixtures.

## Set up Supabase

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste and run [`supabase/migrations/202610010001_kairon.sql`](supabase/migrations/202610010001_kairon.sql).
3. Copy `.env.example` to `.env` and fill in your project URL, publishable key, secret key and JWKS URL. If `.env` already exists, add the missing settings without overwriting it.

The migration creates `kairon_state`, `kairon_events`, `kairon_media` and the `kairon_commit` function. It inserts no records and deletes no existing data. RLS blocks direct browser access; the server checks the authenticated user's role and assignments, then commits each operation, offline receipt and proof image in a single transaction. Version checks prevent overwrites across API instances.

Keep `SUPABASE_SECRET_KEY` on the server. Never give it a `VITE_` prefix or put it in browser code. `.env` is git-ignored.

## Create the four users

The seed manifest is [`server/seeds/users.json`](server/seeds/users.json). It covers dispatcher, loader, driver and store manager. Edit the display names there; set each role's email, password and depot in `.env`, using the `SEED_*` fields from `.env.example`. Driver and store assignments may be left blank when creating accounts. Add real vehicle/outlet IDs matching your imported data before using those workflows. Supported depots are `Peliyagoda` and `Kandy`.

```sh
npm --prefix server ci
npm --prefix server run seed:users
```

Passwords must be at least 10 characters. The script validates every account before writing, creates email-confirmed Supabase Auth users, and stores authorization in administrator-controlled `app_metadata`. Re-running skips existing emails; it does not reset passwords or change roles. No emails are sent by this script. To change an existing account's assignments, update its app metadata with a trusted Supabase Admin client and sign in again.

No default passwords or demo accounts are accepted. The SQL migration does not create Auth users; the seed script does that through Supabase's supported Admin API.

## Import your actual business data

Put the six reference CSVs and `catalog.json` in `data/`, following [`data/README.md`](data/README.md). Then run:

```sh
npm --prefix server run import:data
```

This explicit import replaces reference data and the product catalogue while preserving operational orders, trips, issues and history. It refuses to remove outlets/vehicles used by existing orders/trips. Missing data stays empty; it is never replaced with samples. Import forecasts through the authenticated dispatcher-only `POST /api/predictions` endpoint when genuine model output is available.

## Run locally

Requires Node.js 22.14+ and the SQL migration above.

```sh
npm --prefix server ci
npm --prefix web ci
npm --prefix server run dev
# In another terminal:
npm --prefix web run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://localhost:8080`. Sign in with one of the seeded accounts. The store creates orders; the dispatcher closes, plans and publishes the run; loaders confirm quantities; drivers deliver and attach proof; stores confirm receipt. Accounts without an imported outlet see an assignment message.

The API is always required. Field devices cache authenticated state and queue field actions in IndexedDB for reconnection. Commands such as ordering need the API to confirm the save. Supabase access tokens are renewed using the refresh token; API requests verify JWT signatures against your project's JWKS.

## Deployment

`docker compose up --build` runs the API and built frontend on port 8080, using `.env`. There is no local PostgreSQL container. Run the migration, user seed and reference import separately.

For a separately hosted frontend such as Vercel, set `VITE_API_URL` at build time to your public API origin. On the API, set `WEB_ORIGIN` to the frontend origin and `PUBLIC_API_URL` to the API origin so proof image URLs resolve correctly. Both should use HTTPS. See [`web/README.md`](web/README.md).

## Checks

```sh
npm --prefix server run typecheck
npm --prefix server test
npm --prefix web run lint
npm --prefix web run build
```

Local tests use an in-memory repository and synthetic fixtures; they do not create records in Supabase. Live authentication and persistence require the migration and configured accounts. `npm --prefix server run test:smoke` checks a running API using the seed credentials from `.env` without resetting or creating orders.
