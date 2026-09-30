---
name: waypoint-rules
description: Domain rules, team policies and engineering guardrails for Kairon, team Aevion's Waypoint Group delivery planning system (Tech-Triathlon 2026 hackathon). Use this skill for ANY work in this repo that touches orders, vehicles, outlets, trips, allocation, priority scores, deferrals, trip-time or fuel math, delivery or mall windows, the dispatcher/loader/driver/store screens, offline outbox and sync, seed data, tests, Docker, the README or the docs folder, even if the request doesn't mention Waypoint, rules or constraints.
---

# Waypoint rules for Kairon

Kairon is team **Aevion**'s delivery planning system for Waypoint Group (fictional Sri Lankan retailer), built for Tech-Triathlon 2026. **Hackathon deadline: Sunday 4 Oct 2026, 11:59 PM Asia/Colombo.** Code pushed after that is not judged.

Two kinds of rules live in this project, and they must never be confused:

- **Booklet rules** come from the official challenge booklet. They are hard constraints. Never relax one to make a plan fit.
- **Team policies** are Aevion's own design decisions. They are allowed, but each must be documented in `README.md` under "Assumptions and team policies" so judges can see it's a deliberate choice, not a misunderstanding of the brief.

When you add or change any constant, threshold or rule, say which kind it is in a code comment and update the README list.

## Project map

| Area | Where | Notes |
|---|---|---|
| Shared domain logic | `core/src/` (`rules.ts`, `ops.ts`, `adapter.ts`, `csv.ts`, `reference.ts`, `types.ts`, `users.ts`, `predict.ts`, `time.ts`, `catalog.ts`) | Imported as `@core/*` by web and server. **Single source of truth for rules.** Never duplicate rule logic in web or server |
| Backend | `server/src/` (Fastify 5, TypeScript via tsx) | `app.ts` has all endpoints; SSE at `GET /api/stream` |
| Database | PostgreSQL 16, raw SQL via `pg`, `server/src/schema.sql`, `server/src/db.ts` | No ORM. Typed columns plus a `doc` JSONB column per row |
| Frontend | `web/src/` (React 19, TS, Vite, Tailwind v4, Zustand, React Router, i18next en/si/ta, Leaflet) | Pages per role in `web/src/pages/` |
| Offline | vite-plugin-pwa (Workbox), Dexie outbox in `web/src/store/index.ts`, conflict logic in `web/src/store/conflict.ts` | |
| Auth | scrypt + HMAC tokens, `server/src/auth.ts`, users in `core/src/users.ts` | 4 seeded accounts, password `kairon-demo` |
| Demo states | `web/src/demo/presets.ts`, Figma pages in `web/src/pages/figma/` (`frames.json` holds screen rationale) | |
| Data | `data/` (CSVs are **git-ignored**, never commit them) | See "Datasets" |
| Tests | Node built-in runner via `tsx --test` in `server/` | Web has only `oxlint` |
| Deploy | `docker-compose.yml` (Postgres + app on port 8080), `Dockerfile`, `.env.example` | |

Check each `package.json` for exact script names before running commands.

## Datasets (confidential)

- Competition terms forbid sharing the datasets publicly. `data/**/*.csv` is in `.gitignore`; keep it that way. Never paste dataset rows into commits, docs, issues or the README.
- The loader must read real CSVs from `data/` when present and fall back to `core/src/reference.ts` placeholders only when absent. Log clearly which source was used at startup.
- Placeholder values in `reference.ts` are invented except the booklet examples (Fresh+rear_dock 15, Fresh+street 16, Colombo 24 min / 8 min, Gampaha 37 min / 9 min). Never present placeholder figures as real in the UI, README or demo.
- Expected columns are documented in `core/src/csv.ts`. Validate headers on load and fail loudly on mismatch.

## Booklet rules (hard constraints)

Network: 3 brands (Fresh 80 outlets, daily, before stores open at 8 AM; Style 25, weekly, volume-bound, about half in malls; Tech 15, heavy/fragile/high-value, as needed). 120 outlets, 2 depots (Peliyagoda, Kandy), 60 vehicles (12 reefer trucks, 40 dry trucks, 8 vans of which 4 reefer). Operates Mon–Sat; use `calendar.csv` `is_operating`. Order cutoff 4 PM for next day. A Fresh outlet can have two orders the same day (dry + chilled), so key on order id, not outlet id. All times Asia/Colombo.

Every allocation, automatic or manual, must pass all of these:

1. **Brand and district:** all orders on one vehicle trip share brand and district.
2. **Refrigeration:** `chilled` needs a `reefer`. Reefers may carry ambient. Ambient never carries chilled.
3. **Access:** `parking_constraint = van_only` needs `type = van`.
4. **Home depot:** vehicles serve only their own depot's outlets.
5. **Whole orders:** one order, one vehicle, one trip. Never split.
6. **Capacity per trip:** total weight ≤ `weight_cap_kg` AND total volume ≤ `volume_cap_m3`.
7. **Trips:** max 2 per vehicle per day, all brands combined.
8. **Time budgets:** a vehicle's Fresh trips together ≤ 270 min (3:30–8:00 AM); its Style + Tech trips together ≤ 480 min (trading day). Separate budgets, but the 2-trip limit is shared.
9. **Delivery windows:** each outlet's own window governs arrival; early vehicles wait until it opens. The booklet says Fresh must arrive before 8 AM but individual outlets' windows may differ, so the outlet window is the hard check and "after 08:00" stays a visible warning.
10. **Mall access:** `mall_dock` outlets accept deliveries only inside `mall_window`.
11. **Fuel:** a vehicle's route distance consumes its `weekly_fuel_quota_l`.
12. **Availability:** vehicles in the workshop or otherwise unavailable can't be allocated.

### Trip time (booklet formula, exact)

```
trip_minutes = depot_to_district_freeflow_min
             + inter_stop_freeflow_min × (stops − 1)
             + Σ service_allowance_min(brand, dock_type)
```

No return leg; the budgets already allow for it. These must stay as passing unit tests:

- Gampaha Fresh, 3 stops (rear_dock, rear_dock, street): 37 + 18 + 15 + 15 + 16 = **101**
- Colombo Fresh, 4 street stops: 24 + 24 + 64 = **112**
- Same vehicle, both trips: 101 + 112 = **213 ≤ 270** valid; a third trip is rejected

## Team policies (document every one in README)

**Fuel** (`core/src/rules.ts` ~146, 158, 276, 312):
`trip_km = 2 × depot_to_district_km + inter_stop_km × (stops − 1)`; `litres = trip_km / km_per_l`; blocking when `fuelUsedL + today's litres > weekly_fuel_quota_l`. The booklet doesn't define the distance model, so this is an assumption. `fuelUsedL` must be seeded **deterministically** (fixed values or derived from seeded earlier days), not random, so the judge walkthrough behaves the same on every fresh install. VEH024 at 93% is the intentional fuel demo case.

**Priority score** (`rules.ts` ~353–365): Fresh chilled +60, Fresh dry +50, Tech +40, Style +30, skipped on previous run +35, +20 per run already deferred, +4 per day since last delivery (max 4 days). Queue order: priority, then earliest window close (`planQueue`). Every component is shown to the dispatcher as a reason. Design promise: *an outlet skipped yesterday goes first today and is flagged if skipped again.* Don't change weights without updating the README and the D5 rationale.

**Vehicle choice** (`fitScore`, ~339–346, lower is better): join existing trip 0; new trip 10 if the vehicle already has one, else 20; reefer used for ambient +30; van used where trucks can go +25; reserve vehicle +100; fuller vehicles slightly preferred. Purpose: save scarce reefers and vans for orders that need them.

**Recovery reserve:** VEH008 and VEH031 (reefers) are held back unless the dispatcher releases them (`RECOVERY_RESERVE` in `reference.ts`). Designathon trade-off page: costs about 11 orders on the demo day. Deferrals caused by the reserve must be labelled as a dispatcher/policy choice, never as unavoidable capacity shortage.

**Operational constants** (`rules.ts` ~14–24): reload between trips 20 min (`RELOAD_MIN`), re-pick 25 min (`REPICK_MIN`), roadside transfer 30 min (`TRANSFER_MIN`), departures 03:30 Fresh and 06:30 Style/Tech. These are team assumptions, not booklet rules.

**Mall windows** (`adapter.ts` ~13–19): effective window = requested window narrowed to the mall window; if they don't overlap, the mall window wins. Team assumption.

## Deferral reason codes (existing, keep these names)

`reefer_capacity`, `van_capacity`, `vehicle_capacity`, `weight_cap`, `volume_cap`, `time_budget`, `delivery_window`, `fuel_quota`, `vehicle_unavailable`, `dispatcher_choice`, `inventory`, `breakdown`. Each maps to a store-facing message in `customerMessageFor`; `explainDeferral` finds the most common blocking rule and the earliest possible arrival. Any new code needs both a message and an explanation path. `dispatcher_choice` requires a note.

## Degradation scenarios (from the Day 5 design; build exactly these)

1. **Offline driver, changed route (hero).** Screens R5 → D6 → L5 → S7 → R6 → D7, edge case R7. The design assumes a quiet driver is still on plan. A stop moves **only on evidence** (the driver's own report). D6 compares staying vs moving, including fuel cost. If the driver's offline delivery syncs before the rescue leaves, the rescue is cancelled. Every offline record is kept. On reconnect the change is impossible to miss and the driver must acknowledge it (`ROUTE_ACK`).
2. **Plan changed after loading started.** L4, R8. A late change becomes a checklist on the loader tablet and departure is blocked until the new load is confirmed.
3. **Breakdown recovery.** D8. A reefer failing before 08:00 with chilled goods uses the reserve reefers.

## Offline and sync rules

- Every field action goes into the Dexie outbox, sent immediately when online, otherwise queued and replayed in order.
- `applyEvent` in `core/src/ops.ts` returns `applied`, `duplicate` or `rejected`; replaying the same event must never create duplicates.
- Conflict rule: a delivery recorded offline wins over a later reassignment, and the rescue re-pick is cancelled. `detectConflict` reports what was kept, moved and collided.
- UI must show "You're offline" with the pending count (R5), the sync screens (`/driver/sync`, `/loader/sync`), and "driver saw the route change" on D7.

## Roles and cross-role flow

Dispatcher (large screen), loader (shared tablet, load in **reverse stop order**, flag shortfalls **before** departure), driver (personal phone, offline, used when safely stopped), store manager (desktop or phone: order confirmation, ETA, deferral notice with reason, receipt and issues). Judges test loader and driver on **phone-sized screens**. Each role's action must visibly reach the next role through SSE.

## Working rules for Claude in this repo

- Put rule logic in `core/`, never in React components or route handlers.
- For every rule change, add or update a test in `server/` that runs under `tsx --test`, and run the tests before saying the change is done.
- Keep new UI strings in i18n (en/si/ta). Sinhala and Tamil are AI-drafted and need native-speaker review; don't claim otherwise.
- Don't commit datasets, secrets or `.env`. Config goes through `.env.example`.
- Keep a short running log of what Claude wrote or reviewed so the AI disclosure in `docs/` stays accurate.
- Don't delete or rewrite major features without asking; the Day 5 design is the implementation spec (fidelity is judged).

## Known gaps (fix before submission)

- Real CSVs are missing from `data/`; the app runs on placeholders.
- `README.md` is outdated (wrong product description, old `src/domain` and `mobile/` references, no server/Docker/judge walkthrough/seeded accounts/assumptions/departures).
- `docs/` is empty: needs architecture diagram, data model, AI tool disclosure.
- `npm test` in `server/` matches `test/*.test.ts` but the only file is `test/api.smoke.ts`, so no tests run.
- No public deployment yet.
- Repo must be named `Aevion_Kairon`; `mobile/` deletion and branch `fix/brief-alignment` are unpushed.
- `traffic_speed.csv` and `road_conditions.csv` are unused (optional, not required for the hackathon).

## Datathon note

The Datathon (due 9 Oct) is judged separately and forbids pre-trained models (except for synthetic data or preprocessing), proprietary API-based modelling or preprocessing, and low-code/no-code or fully automated modelling tools. Help the team write and understand their own code there. For Task 2B, the recovery reserve is a team policy, not a booklet rule: any deferral it causes counts as a chosen deferral and must be justified in the written policy.
