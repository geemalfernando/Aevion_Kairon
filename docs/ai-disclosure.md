# AI tool disclosure

Team **Aevion** (Thisuka, Geemal, Chanith) · Kairon · Tech-Triathlon 2026

This file records where AI tools were used on Kairon and what the team decided and checked itself. Sections 3 and 4
are the team's own account: Thisuka gave the facts and decisions, Claude Code typed them up on 4 October 2026, and
the team checked them before submission.

## 1. Tools used

| Tool | Version / model | Used for |
|---|---|---|
| Claude Code (Anthropic), VS Code extension | Claude Sonnet 5.5, then Claude Opus 5.5 | Used by Thisuka: code, tests, documentation, diagrams, the demo-video voiceover script and recording plan (section 2 and the log in section 5) |
| OpenAI Codex | GPT-6 | Used by Geemal: notifications, security, AWS templates and deployment documentation, hosted account checks (log in section 5) |
| Microsoft Edge neural text-to-speech (`edge-tts`) | `en-GB-SoniaNeural` voice | The AI voiceover of the Designathon and Hackathon demo videos (the script was written with Claude Code and reviewed by Thisuka) |
| No AI tool | | Datathon work: not part of this repository yet; it will be the team's own code, as the competition terms require |

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

- **Repo reports.** Claude Code produced read-only reports on the repository for Thisuka (how the planner works, the
  booklet requirements, deferral causes, engineering quality). They were used for team discussion and are not files
  in the repository.
- **`.claude/skills/waypoint-rules/SKILL.md`** holds the project rules Claude Code reads. It was drafted with Claude
  Code from the challenge booklet and reviewed by Thisuka.
- **Earlier code and design work.** The web, server and core code was written with AI coding assistants under the
  team's direction: Claude Code (Thisuka) and OpenAI Codex (Geemal). The demo presets and the Figma helper pages that
  turned app screens into Figma frames were built with Claude Code. The Designathon design itself (screens, flows,
  colours, the Kairon name and story) was decided by the team; Thisuka built the Figma file and prototype.
- **Sinhala and Tamil strings** in `web/src/i18n/locales/` are AI-drafted and have **not** been reviewed by a native
  speaker yet. They are listed under Known limitations in the README.

## 3. What the team designed and wrote themselves

**Team members:** Thisuka (ThisukaMW), Geemal (geemalfernando) and Chanith.

| Area | Who | What |
|---|---|---|
| Problem framing and the Day 5 design | The team · Thisuka built the Figma file and prototype | The four roles and their devices, the screens and flows, the three degradation scenarios, the colours, the Kairon name and the delivery-day story (Nimal, Dilini, the flooded road to Borella) |
| Architecture decisions | The team | One shared rules engine in `core/` used by the browser and the server; one versioned operation document with an atomic commit; server-sent events for live updates; an offline outbox replayed exactly once; the server always decides |
| The 10 merge decisions (2 Oct) | Thisuka and Geemal | `main` as the final branch, two storage backends behind one switch, demo accounts only in local and demo mode, the seeded demo day, demo tools only with `DEMO_MODE`, keeping all tests, CI, README structure, honest data model |
| Team policies | The team | Fuel model, priority weights, the recovery reserve (two reefers), locked stops and trips, mall and window rules, the departures from the Day 5 design. Each policy and why is in the README under Assumptions and team policies |
| Planning engine | Thisuka, with Claude Code | Multi-start planner with an independent audit, locked stops and trips, deferral explanations, the weekly fuel quota and day close, the live rule check |
| Hosting and deployment | Geemal and Thisuka | First on Vercel with Supabase; then AWS in Sydney (CloudFront, ECS Fargate, RDS, S3, SQS, WAF, CodeBuild), built mainly by Geemal with Codex, decided and tested together |
| Mobile apps, sign-in, notifications, security | Geemal, with Codex | Android and iOS builds (Capacitor), hosted sign-in and sessions, the notification outbox and workers, depot and assignment isolation, signed proof links |
| Data | The team | Chose the five competition CSVs used by the Hackathon app; kept the datasets out of the repository as the terms require |
| Testing and walkthrough | Thisuka | Ran the test suites and the 4-role walkthrough on Docker and on the live AWS site; clicked through every walkthrough step while recording |
| Demo video | Thisuka recorded the clips; Chanith edited the video | Story, clip plan and voiceover timing by the team |
| Datathon work | The team | Not in this repository yet; it will be the team's own code |

## 4. How the team reviewed AI output

- **Everything went through pull requests.** Thisuka's AI-assisted changes were opened as pull requests and reviewed
  and merged by Geemal (for example #7 and #8); Geemal's changes were merged by Geemal, and #26 was merged by
  Thisuka with Geemal's go-ahead. Conflicts between the two lines of work were resolved by hand and re-tested.
- **Checked by running, not only by reading.** After every change: the server tests (130 at submission), type checks
  and the web build; the full 4-role walkthrough test on `docker compose up`, on placeholder data and on the real
  competition data; on 4 October the same walkthrough against the live AWS site, followed by a demo reset. Thisuka
  also clicked through every step of the README walkthrough in the app while recording the video.
- **The planner was checked against the data.** Plans for 40 delivery days on the real CSVs were re-checked by the
  independent audit with no rule violations, and planner figures in the README were re-measured on the real data
  instead of being kept from placeholder runs.
- **AI suggestions the team rejected or changed:**
  - A schedule cache proposed for planner speed was measured, found slower, and removed.
  - An AI-generated architecture poster that showed services Kairon doesn't use (Next.js, Flutter, FastAPI, Google
    Maps) was not used; the submitted poster was redrawn from the real AWS templates and code.
  - Suggested poster edits that would have placed AWS WAF on CloudFront and added PostGIS were rejected because they
    contradict `infra/aws/rds.json` and the code.
  - Traffic data was kept out of the hard rules, because the booklet defines trip time with free-flow minutes; traffic
    is left for later risk warnings (Datathon).
  - The deferral-classification work ("Phase B") and a smaller recovery reserve were proposed and deliberately left
    out of the Hackathon submission by the team.
- **Text.** The README, the docs and the voiceover script were AI-drafted and reviewed by Thisuka; facts in them
  (rules, figures, IDs, AWS services) were checked against the code and the running app. The Sinhala and Tamil
  strings were not reviewed by a native speaker (see section 2.4).

## 5. Running log

Add a line for each AI-assisted change from now on.

| Date | Tool | What it did | Reviewed by |
|---|---|---|---|
| 2026-09-30 | Claude Code (Sonnet 5.5) | Rule tests, three validator fixes (section 2) | TEAM TO FILL IN |
| 2026-09-30 | Claude Code (Sonnet 5.5) | `docs/ai-disclosure.md`, `README.md` rewrite | TEAM TO FILL IN |
| 2026-10-01 | Claude Code (Opus 5.5) | Planner phase A: id index for `byId`, multi-start construction, `auditPlan` with greedy fallback, locked stops (`lockStop`/`unlockStop`, `locked` check, lock button on the dispatcher order drawer), reefer-time deferral wording, `server/test/planner.test.ts` | TEAM TO FILL IN |
| 2026-10-01 | Claude Code (Opus 5.5) | Locked trips (`lockTrip`/`unlockTrip`, trip lock button), testable greedy fallback (`selectPlan`), README departures entry, docker compose and smoke-test run | TEAM TO FILL IN |
| 2026-10-01 | Claude Code (Opus 5.5) | Failure messages on every smoke-test check; LOAD_COMPLETE asserted before the driver starts | TEAM TO FILL IN |
| 2026-10-02 | Claude Code (Opus 5.5) | Merge of `dev` into `main` per the team's 10 decisions: storage switch (Supabase or local PostgreSQL, `db-postgres.ts`), local demo sign-in (`auth-local.ts`), demo day in `core/src/demo.ts` behind `SEED_DEMO_DAY`, demo reset and web demo tools behind `DEMO_MODE`/`VITE_DEMO_MODE`, docker compose with PostgreSQL, CI Docker walkthrough job, merged README with data model | TEAM TO FILL IN |
| 2026-10-02 | OpenAI Codex (GPT-6) | Notification outbox/workers, browser and native push integration, cookie sessions, depot/assignment isolation, signed media, security tests, AWS templates and release/deployment documentation; new Sinhala/Tamil strings are AI drafts | TEAM TO FILL IN |
| 2026-10-02 | Claude Code (Opus 5.5) | Judge deployment: `seed:demo` script, demo reset rebuilt from stored reference rows (no CSVs on the server), demo story recast onto ids that fit the competition CSVs (VEH002, OUT005, VEH007/VEH036), `test/demo.test.ts`, README deployed-site section and real-data planner figures | TEAM TO FILL IN |
| 2026-10-03 | Claude Code (Opus 5.5) | Demo move-stop follows the story (reported stop first), store dashboard shows a moved or delayed delivery first, demo-only `simulateRun` so the reserve van delivers; `docs/architecture.md` and `docs/data-model.md` with Mermaid diagrams and PNG copies; README walkthrough steps 16–19 | TEAM TO FILL IN |
| 2026-10-03 | Claude Code (Opus 5.5) | Weekly fuel quota carried across days (`startNextDay`: Close day & plan next), live re-check of the current plan on the planning page (`checkAllocations`), demo Finish every trip (`simulateDayEnd`), `test/next-day.test.ts` | TEAM TO FILL IN |
| 2026-10-04 | Claude Code (Opus 5.5) | AWS architecture poster (`docs/architecture/kairon-architecture.html` and `.png`, drawn from `infra/aws/rds.json` and the server code), `docs/architecture.md` and `docs/data-model.md` updated for the AWS deployment (RDS, S3, notifications, security), README judges section with the deployed site and hosted accounts, walkthrough TODOs resolved | TEAM TO FILL IN |
| 2026-10-04 | OpenAI Codex (GPT-6) | Verified hosted judge account metadata and provisioning-secret consistency, checked authenticated story trip/store order, reset the demo day, and documented observed results for a follow-up PR; no identity or secret edits were needed | TEAM TO FILL IN |
| 2026-10-04 | OpenAI Codex (GPT-6) | Added AWS and Vercel links to the repository About/README and explained the zero-downtime rollout goal, manual site selection and separate account/data stores | TEAM TO FILL IN |
| 2026-10-04 | OpenAI Codex (GPT-6) | Verified eight AWS public demo logins and added README password tables covering all roles, both depot loaders and all four store-manager accounts; no account updates were performed | TEAM TO FILL IN |
| 2026-10-04 | OpenAI Codex (GPT-6) | Changed the theme fallback to System for every role and the signed-out screen, retaining valid saved preferences instead of forcing driver dark mode on login | TEAM TO FILL IN |
| 2026-10-04 | OpenAI Codex (GPT-6) | Prepared a revert of merged PR #35 to restore Vercel support; preserved shared demo accounts and AWS APK/CI targets; documented separate hosting without automatic failover | TEAM TO FILL IN |
