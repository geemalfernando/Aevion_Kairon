# AI tool disclosure

Team **Aevion** · Kairon · Tech-Triathlon 2026

This file records where AI tools were used on Kairon. Sections marked **TEAM TO FILL IN** can only be written by the
team; they are left empty on purpose and must not be completed by an AI tool.

## 1. Tools used

| Tool | Version / model | Used for |
|---|---|---|
| Claude Code (Anthropic), VS Code extension | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | The work listed in section 2 |
| TEAM TO FILL IN | | Any other AI tool used on the product, the Figma files, the Datathon, copy or translations |

## 2. What Claude Code did (as recorded in the session of 30 Sep 2026)

Claude Code worked in this repository on branch `fix/brief-alignment`, at the request of a team member, and ran the
tests and type checks itself. Everything below is in commit `b489549` unless stated otherwise.

### 2.1 Rule tests

- Added `server/test/rules.test.ts`: unit tests for the booklet trip-time formula (Gampaha Fresh 101 min, Colombo
  Fresh 112 min, both trips 213 min within the 270 min budget, a third trip rejected) and a pass case and a fail case
  for each of the 12 hard constraints.
- Added the `test:smoke` script to `server/package.json`. The existing `test/api.smoke.ts` needs a running API, so it
  is kept out of `npm test`. The `npm test` glob (`test/*.test.ts`) matched no file before, so no tests ran.
- To check the tests can fail, Claude Code temporarily broke each rule in `core/src/rules.ts` and confirmed the suite
  failed, then restored the file.

### 2.2 Validator fixes in `core/src/rules.ts`

Three gaps were found while writing the tests and fixed:

1. The "one brand, one district per trip" check always passed. It now compares every order on each of the vehicle's
   trips with that trip's brand and district, so a mixed or hand-built trip is rejected with a message naming the order.
2. There was no explicit mall-window check. A new blocking `mall` check enforces `mall_window` for `mall_dock`
   outlets, independent of the narrowed outlet window.
3. `scheduleTrip` silently skipped stop ids whose order or outlet was missing. It now returns `unknownOrders`, and a
   new blocking `orders` check rejects a vehicle whose trips carry one. `validate()` also always includes the order
   under test, even if the caller's data does not list it yet.

New tests cover a mixed-brand trip, a mixed-district trip, a `joinTrip` onto the wrong trip, a mall delivery outside
the mall window, unknown order ids, and that dispatcher `assign()` goes through the same validator.

Verification run by Claude Code: 50 tests, 15 suites, all passing; `tsc --noEmit` clean for `server` and `web`; the
full generated demo plan (131 orders on 67 trips, placeholder data) re-validated with no false positives from the new
checks. No browser or UI testing was done.

### 2.3 Documentation

- This file and the rewrite of `README.md` (same session). The README's walkthrough was written from the routes and
  demo presets in the code, not by running the UI, so the team must walk through it once and correct it.

### 2.4 Not recorded here

- **Repo report.** No repository report was produced in the session this section is based on. If one was produced in
  another session or tool, the team should add it here: **TEAM TO FILL IN**.
- **`.claude/skills/waypoint-rules/SKILL.md`** (added in the same commit) holds the project rules Claude Code reads.
  Who drafted it, and from which sources, is not recorded: **TEAM TO FILL IN**.
- Earlier commits (the Figma pages, the demo presets, the Designathon screens, the shipped web, server and core code):
  the session record does not show whether AI tools were used. **TEAM TO FILL IN**.
- Sinhala and Tamil strings in `web/src/i18n/locales/` are believed to be AI-drafted and not reviewed by a native
  speaker. **TEAM TO FILL IN** (confirm, and say who reviewed them, if anyone).

## 3. What the team designed and wrote themselves

**TEAM TO FILL IN.** Suggested headings, replace with the truth:

- Problem framing and the Day 5 design (screens, degradation scenarios): who did what
- Architecture decisions (shared `core/`, PostgreSQL with JSONB documents, SSE, Dexie outbox)
- Team policies (fuel model, priority weights, recovery reserve, departures): who chose them and why
- Code written by hand, by person and area
- Datathon work (must be the team's own code; see the competition terms)

## 4. How the team reviewed AI output

**TEAM TO FILL IN.** Suggested questions:

- Who read the AI-written tests and validator changes line by line before committing?
- Which AI suggestions were rejected or changed?
- What was checked by running it (tests, walkthrough) as opposed to reading it?
- Was any AI-generated text (README, docs, translations) reviewed before submission, and by whom?

## 5. Running log

Add a line for each AI-assisted change from now on.

| Date | Tool | What it did | Reviewed by |
|---|---|---|---|
| 2026-09-30 | Claude Code (Sonnet 5.5) | Rule tests, three validator fixes (section 2) | TEAM TO FILL IN |
| 2026-09-30 | Claude Code (Sonnet 5.5) | `docs/ai-disclosure.md`, `README.md` rewrite | TEAM TO FILL IN |
| 2026-10-01 | Claude Code (Opus 5.5) | Planner phase A: id index for `byId`, multi-start construction, `auditPlan` with greedy fallback, locked stops (`lockStop`/`unlockStop`, `locked` check, lock button on the dispatcher order drawer), reefer-time deferral wording, `server/test/planner.test.ts` | TEAM TO FILL IN |
| 2026-10-01 | Claude Code (Opus 5.5) | Locked trips (`lockTrip`/`unlockTrip`, trip lock button), testable greedy fallback (`selectPlan`), README departures entry, docker compose and smoke-test run | TEAM TO FILL IN |
