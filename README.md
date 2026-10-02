# Kairon

Kairon is a delivery planning system for **Waypoint Group**, a fictional Sri Lankan retailer with 120 outlets in three
brands (Fresh, Style, Tech), two depots (Peliyagoda, Kandy) and 60 vehicles. It was built by team **Aevion** for
Tech-Triathlon 2026.

Kairon turns the day's orders into a plan that obeys the operating rules, and keeps four people in step while the day
goes wrong:

| Role | Device | What they do in Kairon |
|---|---|---|
| **Dispatcher** | Large screen | Closes orders at the cutoff, reviews the generated plan, allocates or defers orders, decides shortfalls, moves stops mid-route, handles breakdowns |
| **Loader** | Shared tablet | Loads each trip in reverse stop order, flags shortfalls before departure, confirms late plan changes |
| **Driver** | Personal phone, often offline | Follows the route, records arrivals and deliveries, reports road problems, syncs and acknowledges route changes on reconnect |
| **Store manager** | Desktop or phone | Places orders before the cutoff, sees the delivery ETA or the deferral and its reason, confirms receipt or reports an issue |

Every action by one role reaches the next through a live stream (server-sent events). Field actions are queued on the
device when offline and replayed in order on reconnect.

For AWS staging, security prerequisites, notification delivery work and the paths to the cloud blueprint, see
[the deployment guide](docs/deployment.md). The release template includes ECS notification workers, optional encrypted Redis and production security controls. Live provider checks and account configuration are required before production.

## For judges: run it in one command

Needs only Docker.

```sh
docker compose up --build
```

Open <http://localhost:8080> and sign in with one of the four accounts (the sign-in page also has one-tap buttons).
Every account uses the password **`kairon-demo`**.

| Role | Email | Who |
|---|---|---|
| Dispatcher | `dispatcher@kairon.demo` | Geemal, Peliyagoda |
| Loader | `loader@kairon.demo` | Kamal, Peliyagoda |
| Driver | `driver@kairon.demo` | Nimal, drives VEH014 |
| Store manager | `store@kairon.demo` | Dilini, outlet OUT032 |

The stack has three containers: **frontend** (nginx serving the web app on port 8080 and forwarding `/api`), **backend** (the API) and **database** (PostgreSQL 16). The first start creates the
schema and seeds one realistic delivery day: the network, fleet and calendar from the competition CSVs when they are in
`data/`, otherwise placeholders, and about 150 orders. The clock starts at 15:20 on the ordering day, 40 minutes before
the cutoff. Then follow the [judge walkthrough](#judge-walkthrough). The **Demo** pill at the bottom left (presenter
only) moves the clock, simulates offline and resets the day.

`GET http://localhost:8080/api/health` reports which data files were loaded (`dataSources`). To start again from a
clean database: `docker compose down -v && docker compose up --build`. To check the whole story automatically:
`npm --prefix server ci && npm --prefix server run test:walkthrough`.

> Dataset note: the competition datasets are confidential and are **not** in this repository. Without them the demo
> day runs on built-in placeholder data. Placeholder figures are invented, except the examples quoted in the challenge
> booklet.

## Tech stack

| Layer | Technology |
|---|---|
| Shared domain logic | TypeScript in `core/`, imported by both the web app and the server (`@core/*`) |
| Web | React 19, TypeScript, Vite, Tailwind CSS v4, Zustand, React Router, i18next (English, Sinhala, Tamil), Leaflet; Capacitor for the Android and iOS apps |
| Offline | vite-plugin-pwa (Workbox service worker), IndexedDB outbox, conflict detection in `web/src/store/conflict.ts` |
| Server | Fastify 5, TypeScript run with tsx, server-sent events at `GET /api/stream` |
| Storage | PostgreSQL: Supabase on the hosted site, a local PostgreSQL container with `docker compose` (see [Data model](#data-model)) |
| Auth | Supabase Auth on the hosted site (JWTs checked against the project's JWKS); the four demo accounts with HMAC-signed tokens locally |
| Deploy | Vercel (web + serverless API) with Supabase; or `docker compose up` on any machine |

## Two ways to run, one switch

| | Hosted (live site) | Local (`docker compose up`) |
|---|---|---|
| Selected by | `SUPABASE_URL` is set | `SUPABASE_URL` is empty, `DATABASE_URL` is set |
| Storage | Supabase PostgreSQL (`server/src/db-supabase.ts`) | Local PostgreSQL (`server/src/db-postgres.ts`) |
| Sign-in | Supabase Auth accounts created by `seed:users` | The four `…@kairon.demo` accounts |
| Starting data | Empty; real data via `import:data` | One seeded delivery day (`SEED_DEMO_DAY=true`) |
| Demo tools | Off | On (`DEMO_MODE=true`, web built with `VITE_DEMO_MODE=true`) |

Both backends use the same tables and the same `kairon_commit` function, so the server code above the storage layer is
identical. Keep `DEMO_MODE` and `SEED_DEMO_DAY` off for real use.

## Repository structure

```
core/         Shared rules and logic (single source of truth)
  src/rules.ts     Validation, trip time, planner, priority, deferral explanations
  src/ops.ts       Operation state, commands, field events (applyEvent)
  src/adapter.ts   CSV rows to app model, mall window narrowing
  src/csv.ts       CSV row types and header validation
  src/catalog.ts   Product catalogue, order cutoff, chilled/dry split
  src/demo.ts      The demo delivery day and demo accounts (used only with the demo flags and by tests)
  src/reference.ts, predict.ts, time.ts, types.ts
server/       Fastify API
  src/app.ts       All endpoints
  src/operation.ts The authoritative operation: commands, field events, persistence
  src/db.ts        Storage switch: db-supabase.ts (hosted) or db-postgres.ts (local)
  src/auth.ts      Sign-in switch: Supabase Auth or auth-local.ts
  src/vercel.ts    Serverless entry for Vercel
  test/            Unit tests, Supabase flow test, smoke and walkthrough tests
  scripts/         seed-users, import-data, Vercel bundle, planner calibration
supabase/     SQL migrations for the hosted database
web/          React app: pages per role in src/pages/, demo states in src/demo/; android/ and ios/ (Capacitor)
data/         Put the competition CSVs and catalog.json here (git-ignored)
docs/         Project documentation (AI disclosure)
Dockerfile, docker-compose.yml, .env.example, .github/workflows/ci.yml
```

## Hosted deployment (Supabase and Vercel)

The live site runs on Vercel with Supabase. It starts empty: it does not create sample outlets, vehicles, products,
orders, deliveries, GPS movements or forecasts.

### Set up Supabase

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste and run [`supabase/migrations/202610010001_kairon.sql`](supabase/migrations/202610010001_kairon.sql), then
   [`202610010002_photos_bucket.sql`](supabase/migrations/202610010002_photos_bucket.sql).
3. Copy `.env.example` to `.env` and fill in your project URL, publishable key, secret key and JWKS URL. If `.env`
   already exists, add the missing settings without overwriting it.

The migration creates `kairon_state`, `kairon_events`, `kairon_media` and the `kairon_commit` function. It inserts no
records and deletes no existing data. RLS blocks direct browser access; the server checks the authenticated user's role
and assignments, then commits each operation, offline receipt and proof image in a single transaction. Version checks
prevent overwrites across API instances.

Keep `SUPABASE_SECRET_KEY` on the server. Never give it a `VITE_` prefix or put it in browser code. `.env` is git-ignored.

### Create the four users

The seed manifest is [`server/seeds/users.json`](server/seeds/users.json). It covers dispatcher, loader, driver and
store manager. Edit the display names there; set each role's email, password and depot in `.env`, using the `SEED_*`
fields from `.env.example`. Driver and store assignments may be left blank when creating accounts. Add real
vehicle/outlet IDs matching your imported data before using those workflows. Supported depots are `Peliyagoda` and
`Kandy`.

```sh
npm --prefix server ci
npm --prefix server run seed:users
```

Passwords must be at least 10 characters. The script validates every account before writing, creates email-confirmed
Supabase Auth users, and stores authorization in administrator-controlled `app_metadata`. Re-running skips existing
emails; it does not reset passwords or change roles. No emails are sent by this script. To change an existing
account's assignments, update its app metadata with a trusted Supabase Admin client and sign in again.

With Supabase, no default passwords or demo accounts are accepted. The `…@kairon.demo` accounts exist only in local
mode.

### Import your actual business data

Put the six reference CSVs and `catalog.json` in `data/`, following [`data/README.md`](data/README.md). Then run:

```sh
npm --prefix server run import:data
```

This explicit import replaces reference data and the product catalogue while preserving operational orders, trips,
issues and history. It refuses to remove outlets/vehicles used by existing orders/trips. Missing data stays empty; it is
never replaced with samples. Import forecasts through the authenticated dispatcher-only `POST /api/predictions`
endpoint when genuine model output is available.

### Develop against Supabase

Requires Node.js 22.14+ and the SQL migration above.

```sh
npm --prefix server ci
npm --prefix web ci
npm --prefix server run dev
# In another terminal:
npm --prefix web run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://localhost:8080`. Sign in with one of the seeded accounts.
Accounts without an imported outlet see an assignment message.

The API is always required. Field devices cache authenticated state and queue field actions in IndexedDB for
reconnection. Commands such as ordering need the API to confirm the save. Supabase access tokens are renewed using the
HttpOnly refresh cookie in browsers (in-memory bearer credentials on native); API requests verify JWT signatures and current Supabase session/administrator assignments.

To develop in local mode instead, leave `SUPABASE_URL` empty and point `DATABASE_URL` at any PostgreSQL; set
`DEMO_MODE`, `SEED_DEMO_DAY` and `VITE_DEMO_MODE` for the demo day and tools (see `.env.example`).

### Deploy

For a separately hosted frontend such as Vercel, set `VITE_API_URL` at build time to your public API origin. On the
API, set `WEB_ORIGIN` to the frontend origin and `PUBLIC_API_URL` to the API origin so proof image URLs resolve
correctly. Both should use HTTPS. See [`web/README.md`](web/README.md).

## Datasets

Copy the competition CSVs into `data/` (`import:data` reads them from `data/` itself; the demo seed also finds them in
sub-folders such as `General Data/`):

| File | Used for |
|---|---|
| `outlets.csv` | Outlets, brand, district, depot, `dock_type`, `parking_constraint`, `mall_window`, delivery windows |
| `vehicles.csv` | Fleet: type, temperature, capacities, fuel profile, home depot |
| `calendar.csv` | Operating days (`is_operating`), paydays, festivals |
| `district_travel.csv` | `depot_to_district_freeflow_min` and `inter_stop_freeflow_min` for trip time |
| `service_allowance.csv` | Handling allowance per brand and dock type |
| `fleet_status.csv` | `vehicle_id,status` (`available` or `in_workshop`) |

In local demo mode, the server loads what is present on the first start (or **Demo, Reset**) and falls back to
placeholders for anything missing. `traffic_speed.csv` and `road_conditions.csv` are not used.

**Never commit the CSVs.** The competition terms forbid sharing the datasets, and `data/**/*.csv` is in `.gitignore`.
`docker compose` mounts `data/` into the backend read-only at start; the CSVs are never copied into an image.

## Data model

**Domain model** (`core/src/types.ts`). One `OpsData` per operation: reference data (`outlets`, `vehicles`,
`districts`, `allowances`, `calendar`, `catalog`), the day's `orders` (one per outlet, brand and temperature; whole
orders only), `trips` (vehicle, trip number 1 or 2, ordered stops), the `plan` status, `issues` (shortfalls,
breakdowns, store reports), `notifications`, `syncLog` (offline sync reports), an `audit` log, `predictions` loaded from the Datathon
models, the operation `clock`, and a `version`. An order points at its trip (`tripId`) and may carry a `lock` to a vehicle.

**Storage** (`supabase/migrations/202610010001_kairon.sql`, the same schema locally):

| Table | Holds |
|---|---|
| `kairon_state` | One row: the whole `OpsData` as JSONB, plus its `version` |
| `kairon_events` | One receipt per field event a device sent, keyed by the device-generated id |
| `kairon_media` | Proof-of-delivery photos and signatures (base64), referenced by URL from the state |

Every write goes through `kairon_commit`: it checks the version the server read, then writes the new state, the event
receipts and the media in one transaction.

**Why a snapshot and not one table per entity.** A plan is only valid as a whole: moving one stop changes the arrival
times of every later stop on that trip, and the rules (trip time, two-trip limit, fuel quota) are checked across all of
a vehicle's trips. The shared core validates and changes the whole operation in memory, so the server stores the result
of each command as one versioned document. This keeps every commit consistent, makes concurrent writes from several
devices or serverless instances safe (a stale version is refused with 409 and the client reloads), and lets an offline
outbox be replayed exactly once (`kairon_events`). The cost: the database can't be queried per order with SQL, and the
document grows with the day's history. That is acceptable for one regional operation of about 150 orders a day; a
multi-day archive or reporting would need per-entity tables.

## Checks and tests

```sh
cd server
npm test                  # 101 unit tests: rules, planner, Supabase flow (in-memory repository, no database)
npm run typecheck         # tsc, includes core/ and the tests
npm run test:walkthrough  # full 4-role story against a local demo stack (docker compose up); resets the demo
npm run test:smoke        # read-only check of a deployed API with the SEED_* accounts from .env

cd ../web
npm run lint              # oxlint
npm run build             # type-checks the web app and shared core, then builds
```

`server/test/rules.test.ts` covers the booklet trip-time examples (101, 112 and 213 minutes, a third trip rejected) and
a pass and a fail case for each of the 12 hard constraints below. `server/test/planner.test.ts` covers the planner:
the objective order, determinism, never worse than the original greedy plan, the audit (on the demo day, on 24 seeded
random smaller worlds, and on deliberately broken plans), the greedy fallback, locked stops and locked trips, the
recovery reserve and the deferral wording. `server/test/supabase-flow.test.ts` covers the operation against an
in-memory repository: version checks, offline replay and proof media. Unit tests never create records in Supabase. The
web app has no unit tests.

CI (`.github/workflows/ci.yml`) runs the API tests and typecheck, the Vercel bundle, web lint and build, the Docker
stack with the 4-role walkthrough, the Android and iOS builds, and a production smoke test.

## Judge walkthrough

This follows one delivery day across all four roles on the local stack (`docker compose up`). Use one browser window per role (each browser tab keeps its own
sign-in, so roles can sit side by side), and phone-sized windows for the loader and driver. **Demo** is the pill at
the bottom left of the app; it is presenter-only.

> **TODO (team): this walkthrough was written from the routes, demo presets and code, not by clicking through the
> running app. Walk through it once on a fresh `docker compose up` and correct any step, button name or ID.** Order and
> outlet IDs come from the seeded data and can differ when the real CSVs are loaded.

**Ordering day**

1. **Store manager** (`store@kairon.demo`): open `/store/orders/new` and place an order for OUT032 before the 16:00
   cutoff. Chilled and dry goods are split into two deliveries. The order enters planning at the cutoff.
2. **Dispatcher** (`dispatcher@kairon.demo`): open `/dispatcher/orders` and use Demo, **Close orders & generate plan**.
   Confirmed orders enter one queue, ordered by priority, then earliest window close. On the planning page
   (`/dispatcher/planning`) read the draft plan: served and deferred counts, the binding resource (with the placeholder
   data, reefer capacity), and the recovery-reserve trade-off (VEH008 and VEH031 held back).
3. **A rule blocks an allocation.** Drag a chilled order onto a dry truck. Every rule is checked, there is no override,
   and vehicles that fit are suggested. Shortcut: `/dispatcher/planning?modal=blocked&demo=blocked`.
4. **A deferral.** Open `/dispatcher/deferred` to review each deferral with its constraint, calculation and next run.
   Then defer one order by hand from its drawer (choose a reason; `dispatcher_choice` needs a note) and check the store
   manager's `/store` shows the notice with the reason and the new date. TODO: confirm which of OUT032's orders to
   defer without breaking the VEH014 story below (its chilled order is on TRP-014-1). Shortcut showing the store's
   view: `/store?demo=store-deferred`.
5. **Dispatcher**: Demo, **Publish plan to loaders & drivers**. Loader, driver and store are notified.

**Loading (phone-sized, loader)**

6. **Loader** (`loader@kairon.demo`): open `/loader/trips`, then `/loader/load/TRP-014-1`. Load in reverse stop order
   (last stop goes in first) and count each item.
7. **Shortfall before departure.** Flag missing dairy on OUT032 (for example 3 crates damaged). The dispatcher decides
   at `/dispatcher/issues`; the decision appears on the loader's stop and on the store's dashboard. Shortcuts:
   `/loader/load/TRP-014-1?modal=shortfall&demo=shortfall`, `/dispatcher/issues/shortfall?demo=shortfall-reported`.
8. **Plan changed after loading started** (second degradation scenario). Dispatcher: Demo, **Change VEH014's plan
   during loading**. The loader gets a checklist for the change, and the driver cannot depart until the loader confirms
   the new load. Shortcuts: `?demo=plan-changed`, `?demo=change-pending`.
9. **Loader**: complete loading of TRP-014-1.

**On the road (phone-sized, driver, offline)**

10. **Driver** (`driver@kairon.demo`, VEH014): open `/driver`, start the route, arrive at and deliver the first stop.
11. **Go offline** (the hero degradation scenario). In the driver's window use Demo, **Simulate offline**. The app shows
    "You're offline" with a pending count. The driver reports the road to OUT032 as blocked with a delay, then keeps
    delivering; each action is saved on the phone and listed at `/driver/sync`. TODO: confirm the exact screens for
    reporting a road problem. Shortcut: `/driver/route?demo=offline`.
12. **Dispatcher**: open `/dispatcher/routes/TRP-014-1`. A quiet driver is still assumed on plan; a stop moves only on
    the driver's own report. The move-stop dialog compares staying with moving, including fuel. Use Demo, **Move a
    VEH014 stop to the reserve van** (VEH031). Shortcut: `/dispatcher/routes/TRP-014-1?modal=move-stop&demo=move-stop`.
13. **Reconnect.** Turn Simulate offline off. The queued events replay in order. On `/driver/reconcile` the route
    change cannot be missed: it shows what was kept, what moved and what to do now, and the driver acknowledges it.
    Dispatcher `/dispatcher/live` shows the sync report and that the driver saw the change. Shortcuts:
    `/driver/reconcile?demo=conflict`, `/dispatcher/live?demo=synced`.
14. **Edge case.** If the driver delivered the moved stop offline before the change reached them, the offline record
    wins and the reserve van's re-pick is cancelled. Shortcut: `/driver/reconcile?demo=conflict-collided`.
15. **Breakdown recovery** (third scenario). A reefer failing before 08:00 with chilled goods is rescued using the
    reserve reefer. Shortcuts: `/dispatcher/issues/breakdown?demo=breakdown`, `/driver?demo=recovered`.

**Delivery and receipt**

16. **Store manager**: at `/store` see the ETA, then confirm what arrived or report an issue (missing, damaged or wrong
    goods, with a photo) which reaches the dispatcher. Shortcuts: `/store?demo=store-delivered`,
    `/store?modal=report-issue&demo=store-issue`.

The `?demo=<id>` links open a sandboxed copy of the operation in a named state; nothing is saved or synced. The full
list of states is in `web/src/demo/presets.ts`. Other URL switches: `frame=1` hides presenter chrome, `theme=dark|light`,
`lang=en|si|ta`, `day=YYYY-MM-DD` pins the ordering day. TODO: confirm whether a preset link needs the matching role to
be signed in first.

Other useful screens: `/dispatcher/capacity` (demand forecast), `/dispatcher/simulator`, `/states` (index of screen
states). The `?demo=` links, `/states` and the Demo pill exist only in the demo build (`VITE_DEMO_MODE=true`, which
`docker compose` uses); the hosted site has none of them.

## Booklet rules enforced

These are hard constraints from the challenge booklet. Every allocation, automatic or manual, goes through
`validate()` in `core/src/rules.ts` and a blocked allocation cannot be overridden. The check names below are the
`key` of each check in the validator result.

| # | Rule | Check |
|---|---|---|
| 1 | All orders on a trip share brand and district. Checked against every stop of every trip on the vehicle, so a hand-built mixed trip is rejected | `trip` |
| 2 | `chilled` needs a reefer; a reefer may carry ambient; ambient never carries chilled | `temperature` |
| 3 | `van_only` outlets need a van | `access` |
| 4 | A vehicle serves only its own depot's outlets | `depot` |
| 5 | Whole orders: one order, one vehicle, one trip, never split | Planner and `validate()` allocate whole orders only |
| 6 | Trip weight within `weight_cap_kg` and trip volume within `volume_cap_m3` | `weight`, `volume` |
| 7 | At most 2 trips per vehicle per day, all brands combined | `trips` |
| 8 | Fresh trips together within 270 min (03:30 to 08:00); Style and Tech trips together within 480 min. Separate budgets, shared 2-trip limit | `budget` |
| 9 | Each outlet's own delivery window governs arrival; an early vehicle waits for it to open | `window` |
| 10 | `mall_dock` outlets accept deliveries only inside `mall_window` | `mall` |
| 11 | A vehicle's route distance is charged against `weekly_fuel_quota_l` (distance model is a team policy, below) | `fuel` |
| 12 | Vehicles in the workshop or otherwise unavailable cannot be allocated | `status` |

Also enforced: every stop id on a vehicle's trips must resolve to a known order and outlet (`orders`). Orders are keyed
by order id, not outlet id, because a Fresh outlet can have a dry and a chilled order on the same day.

**Trip time** (booklet formula, no return leg):

```
trip_minutes = depot_to_district_freeflow_min
             + inter_stop_freeflow_min x (stops - 1)
             + sum of service_allowance_min(brand, dock_type)
```

Worked examples, kept as passing unit tests: Gampaha Fresh with 3 stops (rear_dock, rear_dock, street) is
37 + 18 + 15 + 15 + 16 = **101** min; Colombo Fresh with 4 street stops is 24 + 24 + 64 = **112** min; the same
vehicle running both is 101 + 112 = **213** min, within 270, and a third trip is rejected.

The rest of the booklet setup (Mon to Sat operation from `calendar.csv`, 4 PM cutoff for next-day delivery, all times
in Asia/Colombo) is applied in `core/src/time.ts`, `core/src/catalog.ts` and the seed in `core/src/ops.ts`.

## Assumptions and team policies

These are Aevion's own design decisions, not booklet rules. Each is a deliberate choice where the booklet is silent.
The constants live in `core/src/rules.ts` unless noted.

**Fuel model.** The booklet gives a weekly quota but no distance model. We assume
`trip_km = 2 x depot_to_district_km + inter_stop_km x (stops - 1)` and `litres = trip_km / km_per_l`. An allocation is
blocked when the fuel already used this week plus today's litres exceed `weekly_fuel_quota_l`. Fuel already used is
seeded deterministically on the demo day (fixed seed 29, 25 to 60 percent of the quota) so a fresh install behaves the
same every time. VEH024 is fixed at 93 percent of its quota as the intentional fuel demo case, and VEH014 (the story
vehicle) at 40 L (`enrichForDemo` in `core/src/demo.ts`).

**Priority score** (`priorityOf`). Fresh chilled +60, Fresh dry +50, Tech +40, Style +30; skipped on the previous run
+35; +20 for each run already deferred; +4 per day since the last delivery (up to 4 days); capped at 99. The queue is
ordered by priority first, so the promise holds whatever else the planner tries: an outlet skipped yesterday goes
first today and is flagged if skipped again. Every component is shown to the dispatcher as a reason.

**Planner objective and multi-start** (`generatePlan`, `comparePlans`). Plans are compared lexicographically: no
rule violations, then the least total priority deferred, then the most orders served, then the fewest trips, then the
fewest km. Within each priority band, the order in which equal-priority orders are tried decides how many fit, so the
plan is built four ways (`PLAN_STARTS`): earliest window close (the original planner), scarcest orders first,
short-haul districts first, and largest district groups first; all but the first keep each brand and district group
together. The best plan by the objective is kept. Every candidate is re-checked by `auditPlan`, and if the best one
fails, the original greedy plan is used instead.

**Locked stops** (`order.lock`, `lockStop` / `unlockStop`). A dispatcher can lock a stop to a vehicle. Re-planning then
keeps it on that vehicle at the same arrival time, and other orders may only use the vehicle's remaining capacity and
time where they don't change a locked stop's arrival (the `locked` check in `validate`). A dispatcher can also lock a
whole trip (`lockTrip` / `unlockTrip`): its stops are locked as one closed trip, and no other order may join it.
Moving a locked stop by hand needs an unlock first; unassigning, deferring, moving it mid-route or a breakdown recovery
clears the lock. The demo story trip on VEH014 is seeded as a locked trip, which replaces the old rule that reserved
VEH014 for the story.

**Vehicle choice** (`fitScore`, lower is better). Joining an existing trip scores 0; a new trip scores 10 if the vehicle
already has one, otherwise 20; a reefer used for ambient goods +30; a van used where a truck could go +25; a reserve
vehicle +100; fuller vehicles are slightly preferred. This saves scarce reefers and vans for the orders that need them.

**Recovery reserve.** Two reefers, **VEH008 and VEH031**, are held back from planning unless the dispatcher releases
them (`RECOVERY_RESERVE` in `core/src/demo.ts`; the planner honours any vehicle with `reserve` set), so a breakdown before 08:00 can be rescued. Holding them costs
served orders. Deferrals it causes are labelled as a dispatcher and policy choice, never as unavoidable capacity
shortage. On the placeholder data the figure depends on the calendar day; for the 28 September demo day it is 6 extra
orders (11 before the multi-start planner, because the better plan already serves some of them).
TODO: the Designathon trade-off page quotes about 11 orders on the demo day; reconcile the two figures on the real data.
For the Datathon, a deferral caused by the reserve is a chosen deferral and must be justified in the written policy.

**Operational times.**

| Constant | Value | Meaning |
|---|---|---|
| `RELOAD_MIN` | 20 min | Return, unload and reload between a vehicle's two trips |
| `REPICK_MIN` | 25 min | Re-pick at the depot before a moved stop leaves on another vehicle |
| `TRANSFER_MIN` | 30 min | Rescue vehicle drives out and takes over the load after a breakdown |
| `FRESH_START` | 03:30 | Earliest departure of a Fresh trip |
| `STYLE_TECH_START` | 06:30 | Earliest departure of a Style or Tech trip |

An editable trip leaves just in time to reach its first window, never before the vehicle is back and reloaded.

**Mall windows.** The window a delivery must hit is the outlet's requested window narrowed to its `mall_window`
(`effectiveWindow` in `core/src/adapter.ts`). If the two never overlap, the mall window wins, because mall security
will not admit the vehicle otherwise.

**Arrival-based mall check.** The `mall` check fails a mall delivery if service would start before the mall bay opens
or the vehicle arrives after it closes. An early vehicle waits for the bay to open. It compares the arrival time, not
the time service finishes, so a service that starts inside the window may run past the close. This matches how the
delivery-window check works. It is stricter than the narrowed window only when an outlet's window was never narrowed.

**The 08:00 warning.** The booklet says Fresh must arrive before 08:00, but individual outlets' windows can differ. The
outlet's own window is therefore the hard check, and a Fresh stop that would finish after 08:00 is shown as a visible
warning on the planning page (`Planning.tsx`) and does not block the allocation.

**Code fallbacks.** If `service_allowance.csv` has no row for a brand and dock type, 15 minutes is used; if a district is
missing from `district_travel.csv`, a generic suburban district is used. Both are placeholders to keep the app running,
not figures from the booklet.

**Data.** Without the real CSVs the app uses invented placeholder values, except the booklet examples (Fresh with
rear_dock 15 min, Fresh with street 16 min, Colombo 24 min out and 8 min between stops, Gampaha 37 and 9).

## Departures from the Day 5 design

> **TODO (team):** list every other place where the implementation differs from the Day 5 design: screens not built,
> changed or merged, flows changed, and why. Judges score fidelity to the design, so an honest list is better than an
> empty section. Suggested table columns: Design screen or behaviour | What was built | Why it differs.

### Planner: more orders served on the same fleet

The Day 5 design showed a single greedy pass: orders by priority, then earliest window close. The planner now builds
the plan four ways and keeps the best by the team's objective (no rule violations, then the least total priority
deferred, then the most orders served, then the fewest trips, then the fewest km); see "Planner objective and
multi-start" above. Every candidate is re-checked by an independent audit, and if the best one failed, the original
greedy plan would be used. Priority bands are unchanged, so an outlet skipped yesterday still goes first. Measured on
the 28 September demo day (placeholder data):

| Metric | Day 5 design (greedy) | Now (multi-start) |
|---|---|---|
| Orders served / deferred | 132 / 20 | 139 / 13 |
| Total priority deferred | 1180 | 760 |
| Chilled orders served | 39 / 57 | 46 / 57 |
| Trips (vehicles used) | 67 (37) | 57 (33) |
| Distance / fuel | 6,669 km / 1,099 L | 5,523 km / 938 L |
| Planner runtime | about 650 ms | about 200 ms |

The deferral wording also changed: a chilled order blocked by windows or the Fresh time budget now says it is short of
reefer *time* ("No reefer can reach OUT019 before 07:30 …"), not reefer space, because on the demo day reefers are
only about 18 percent full by volume. The reason codes are unchanged.

### Recovery reserve trade-off: 11 orders becomes 6

The Day 5 core trade-off page says holding VEH008 and VEH031 in reserve costs about 11 orders on the demo day. With
the better planner the cost is 6 orders: the plan without the reserve already serves several of the orders that
releasing it used to add. The trade-off itself is unchanged; only the figure moved. The planning page computes it live
for the day being planned.

### Locked stops and locked trips (new)

Not in the Day 5 design. A dispatcher can lock a stop to its vehicle, or lock a whole trip (Planning page: the lock
button in an order's drawer, and "Lock trip" on a trip card). Re-planning keeps locked stops on their vehicle at the
same arrival times, and adds nothing to a locked trip; other orders may only use the room around them. Unassigning,
deferring, moving a stop mid-route or a breakdown recovery clears the lock for that stop. The demo story's trip
TRP-014-1 (VEH014, five Colombo stops) is seeded as a locked trip, which replaces an earlier rule that reserved VEH014
for the story and kept its spare capacity out of planning. The hero trip therefore stays exactly the five designed
stops at the designed times.

## Known limitations

- The real CSVs are not in the repository, so the default local run uses placeholder data.
- The recovery reserve and fuel already used this week are set only on the demo day. Real imports carry neither yet,
  so on the hosted site no vehicle is held in reserve and every vehicle starts the week with a full quota.
- Late-risk and service-time estimates appear only after Datathon model output is loaded (`POST /api/predictions`);
  there are no placeholder predictions, so screens from the Designathon that showed late risk are blank until then.
- Demo outlets are placed near their district centre (approximate); real maps need `latitude`/`longitude` in
  `outlets.csv`.
- The Sinhala and Tamil translations are AI-drafted and need review by native speakers (see `docs/ai-disclosure.md`).
- The web app has no automated tests; `npm run lint` and `npm run build` are its checks.

## AI tool disclosure

See [`docs/ai-disclosure.md`](docs/ai-disclosure.md).
