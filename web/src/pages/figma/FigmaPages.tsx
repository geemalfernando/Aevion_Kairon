/**
 * Pages built to be imported into Figma with html.to.design (free plan: one import per page).
 *   /figma             how to import, and every URL
 *   /figma/doc         cover, framing, personas, scope, connections, domain rules, trade-off, style guide, AI disclosure
 *   /figma/board/:id   one role's screens with a rationale paragraph each
 *   /figma/degradation the degradation storyboards
 * Screens are captured by `npm run figma:capture` into /public/figma.
 */
import {
  ArrowRight,
  CloudOff,
  Leaf,
  LifeBuoy,
  Monitor,
  Smartphone,
  Snowflake,
  Store as StoreIcon,
  TabletSmartphone,
  TriangleAlert,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { OrderStatus } from "@core/types";
import {
  Badge,
  BrandTag,
  Button,
  Callout,
  CheckRow,
  cn,
  Logo,
  Meter,
  ModelChip,
  SeverityBadge,
  StatusBadge,
  TempTag,
} from "../../components/ui";
import data from "./frames.json";

type Frame = (typeof data.frames)[number] & { degradation?: boolean };
const frames = data.frames as Frame[];
const frameById = (id: string) => frames.find((f) => f.id === id)!;

function useLightTheme() {
  useEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "light";
    return () => {
      document.documentElement.dataset.theme = prev;
    };
  }, []);
}

/** One Figma artboard: fixed width, generous padding, a small label above. */
function Artboard({
  label,
  title,
  children,
  className,
}: {
  label: string;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      data-export={label}
      className={cn(
        "mx-auto mb-24 w-[1440px] rounded-3xl bg-surface p-16 shadow-card",
        className,
      )}
    >
      <div className="eyebrow mb-2 !text-brand-ink">{label}</div>
      {title && (
        <h2 className="mb-10 max-w-5xl font-display text-[44px] font-semibold leading-tight">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function Shot({ f, width }: { f: Frame; width: number }) {
  const phone = f.w < 600;
  return (
    <img
      src={`/figma/${f.id}.png`}
      alt={f.title}
      width={width}
      style={{ aspectRatio: `${f.w} / ${f.h}` }}
      className={cn(
        "block h-auto border border-line bg-surface-2 object-cover object-top shadow-card",
        phone ? "rounded-[28px]" : "rounded-xl",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export function FigmaIndex() {
  useLightTheme();
  const pages = [
    [
      "/figma/doc",
      "1440",
      "Document: cover, problem framing, workflow, scope, personas, connections, domain rules, trade-off, style guide, AI disclosure",
    ],
    ...data.boards.map((b) => [
      `/figma/board/${b.id}`,
      "1920",
      `Screen flow · ${b.title}`,
    ]),
    [
      "/figma/degradation",
      "1920",
      "Degradation screens: hero storyboard, second and third scenarios",
    ],
  ];
  return (
    <div className="min-h-dvh bg-bg px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <Logo />
        <h1 className="mt-6 text-3xl font-semibold">Figma import</h1>
        <p className="mt-2 text-muted">
          Import each page below with the html.to.design plugin (Figma → Plugins
          → html.to.design → paste the URL → set the width → Import). Six
          imports build the whole file; every text layer stays editable.
        </p>
        <ol className="mt-6 space-y-2">
          {pages.map(([url, w, what], i) => (
            <li
              key={url}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4"
            >
              <span className="grid size-7 place-items-center rounded-full bg-brand-fill text-sm font-bold text-white">
                {i + 1}
              </span>
              <Link to={url} className="id text-brand-ink underline">
                {location.origin}
                {url}
              </Link>
              <Badge>width {w}</Badge>
              <span className="w-full text-sm text-muted">{what}</span>
            </li>
          ))}
        </ol>
        <h2 className="mt-10 text-xl font-semibold">
          Optional: key screens as fully editable layers
        </h2>
        <p className="mt-1 text-sm text-muted">
          If you have imports left, bring these in at their own size (phone 390,
          desktop 1440). They replace the screenshot on the boards with real
          layers.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {[
            "R6-reconcile",
            "D3-planning",
            "L4-plan-changed",
            "R2-route",
            "D6-move-stop",
          ].map((id) => {
            const f = frameById(id);
            const u = `${f.url}${f.url.includes("?") ? "&" : "?"}frame=1`;
            return (
              <li key={id} className="flex flex-wrap gap-2">
                <Badge tone={f.w < 600 ? "info" : "neutral"}>
                  {f.w < 600 ? "390" : "1440"}
                </Badge>
                <span className="font-semibold">{f.title}</span>
                <a
                  className="id break-all text-brand-ink underline"
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                >
                  {location.origin}
                  {u}
                </a>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-xs text-muted">
          Screens refresh with <code>npm run figma:capture</code> (dev server
          running).
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role boards
// ---------------------------------------------------------------------------

export function FigmaBoard() {
  useLightTheme();
  const { id } = useParams();
  const board = data.boards.find((b) => b.id === id);
  if (!board) return <p className="p-10">Unknown board</p>;
  const list = frames.filter((f) => f.board === id);
  const desktop = list.filter((f) => f.w >= 600);
  const phone = list.filter((f) => f.w < 600);
  return (
    <div className="min-h-dvh bg-bg py-16">
      <div className="mx-auto w-[1840px]">
        <div
          data-export="Title"
          className="mb-12 flex items-end justify-between"
        >
          <div>
            <div className="eyebrow !text-brand-ink">Screen flow</div>
            <h1 className="font-display text-5xl font-semibold">
              {board.title}
            </h1>
            <p className="mt-2 text-lg text-muted">{board.subtitle}</p>
          </div>
          <Logo />
        </div>
        {desktop.map((f, i) => (
          <div
            key={f.id}
            data-export={f.id}
            className="mb-16 grid grid-cols-[1100px_1fr] gap-12 rounded-3xl bg-surface p-10 shadow-card"
          >
            <Shot f={f} width={1100} />
            <FrameText f={f} n={i + 1} />
          </div>
        ))}
        {phone.length > 0 && (
          <div className="grid grid-cols-3 gap-10">
            {phone.map((f, i) => (
              <div
                key={f.id}
                data-export={f.id}
                className="rounded-3xl bg-surface p-8 shadow-card"
              >
                <div className="flex justify-center">
                  <Shot f={f} width={360} />
                </div>
                <div className="mt-6">
                  <FrameText f={f} n={desktop.length + i + 1} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FrameText({ f, n }: { f: Frame; n: number }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-full bg-brand-fill text-sm font-bold text-white">
          {n}
        </span>
        {f.degradation && (
          <Badge tone="attention">
            <TriangleAlert className="size-3" /> Degradation
          </Badge>
        )}
        <Badge>{f.w < 600 ? "390 × 844" : "1440 × 900"}</Badge>
      </div>
      <h3 className="mt-3 font-display text-2xl font-semibold">{f.title}</h3>
      <p className="mt-3 text-[17px] leading-relaxed">{f.rationale}</p>
      <p className="mt-4 font-mono text-xs text-faint">{f.url}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Degradation storyboards
// ---------------------------------------------------------------------------

export function FigmaDegradation() {
  useLightTheme();
  const { hero, second, third } = data.degradation;
  return (
    <div className="min-h-dvh bg-bg py-16">
      <div className="mx-auto w-[1840px]">
        <div
          data-export="Title"
          className="mb-12 flex items-end justify-between"
        >
          <div>
            <div className="eyebrow !text-attention-ink">
              Degradation screens
            </div>
            <h1 className="font-display text-5xl font-semibold">
              When the normal workflow breaks down
            </h1>
          </div>
          <Logo />
        </div>

        <section className="mb-16 rounded-3xl bg-surface p-12 shadow-card">
          <div data-export="Hero storyboard">
            <Badge tone="attention">Hero scenario</Badge>
            <h2 className="mt-3 font-display text-4xl font-semibold">
              {hero.name}
            </h2>
            <p className="mt-4 max-w-5xl text-lg leading-relaxed">{hero.why}</p>
            <div className="mt-12 grid grid-cols-3 gap-x-10 gap-y-14">
              {hero.steps.map((s, i) => {
                const f = frameById(s.frame);
                return (
                  <div key={i} className="relative">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="rounded-full bg-ink px-3 py-1 font-mono text-sm font-semibold text-bg">
                        {s.time}
                      </span>
                      {i < hero.steps.length - 1 && (
                        <ArrowRight className="size-5 text-steel" />
                      )}
                    </div>
                    <div className="flex h-[640px] items-start justify-center overflow-hidden rounded-2xl bg-surface-2 p-4">
                      <Shot f={f} width={f.w < 600 ? 290 : 520} />
                    </div>
                    <p className="mt-4 text-lg font-medium leading-snug">
                      {s.caption}
                    </p>
                    <p className="mt-1 text-xs text-muted">{f.title}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            data-export="Hero screen"
            className="mt-14 grid grid-cols-[1fr_560px] gap-12 rounded-2xl border-2 border-attention/60 p-10"
          >
            <div>
              <div className="eyebrow !text-attention-ink">The hero screen</div>
              <h3 className="mt-1 font-display text-3xl font-semibold">
                {frameById("R6-reconcile").title}
              </h3>
              <p className="mt-3 text-lg leading-relaxed">
                {frameById("R6-reconcile").rationale}
              </p>
              <ul className="mt-6 space-y-3 text-[16px]">
                {[
                  [
                    "Reassure first",
                    "the first line says nothing recorded was lost — the driver’s biggest worry after being offline.",
                  ],
                  [
                    "Then what changed, in the driver’s terms",
                    "outlet names, the vehicle it moved to and the reason the dispatcher gave.",
                  ],
                  [
                    "Then what to do physically",
                    "“keep these goods on board and return them to the depot” — the step a driver would otherwise guess.",
                  ],
                  [
                    "Then the route now",
                    "with the next stop and time, and one large confirm button.",
                  ],
                  [
                    "Close the loop",
                    "the confirmation reaches the dispatcher’s Live operations as “driver saw the route change”.",
                  ],
                ].map(([a, b]) => (
                  <li key={a} className="flex gap-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-attention" />
                    <span>
                      <b>{a}:</b> {b}
                    </span>
                  </li>
                ))}
              </ul>
              <Callout tone="info" title="Edge case designed" className="mt-6">
                {hero.edge}
              </Callout>
            </div>
            <div className="flex items-start gap-4">
              <Shot f={frameById("R6-reconcile")} width={270} />
              <Shot f={frameById("R7-collided")} width={270} />
            </div>
          </div>
        </section>

        {[second, third].map((sc, k) => (
          <section
            key={sc.name}
            data-export={sc.name}
            className="mb-16 grid grid-cols-[minmax(0,1fr)_auto] gap-12 rounded-3xl bg-surface p-12 shadow-card"
          >
            <div className="min-w-0">
              <Badge tone="attention">
                {k === 0 ? "Second scenario" : "Third scenario"}
              </Badge>
              <h2 className="mt-3 font-display text-4xl font-semibold">
                {sc.name}
              </h2>
              <p className="mt-4 max-w-3xl text-lg leading-relaxed">{sc.why}</p>
              {sc.frames.map((id) => (
                <p
                  key={id}
                  className="mt-4 max-w-3xl text-[15px] leading-relaxed text-muted"
                >
                  <b className="text-ink">{frameById(id).title}.</b>{" "}
                  {frameById(id).rationale}
                </p>
              ))}
            </div>
            <div className="flex items-start gap-6">
              {sc.frames.map((id) => (
                <Shot
                  key={id}
                  f={frameById(id)}
                  width={frameById(id).w < 600 ? 300 : 760}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const PROBLEMS: [string, string, string][] = [
  [
    "Planning is fragmented",
    "Store orders arrive already confirmed; closing at 16:00 builds one queue; the recommended plan explains itself, so the plan no longer lives in one dispatcher’s head.",
    "D2 · D3",
  ],
  [
    "Delivery progress is hard to track",
    "Live operations shows every vehicle’s next stop, arrival time and late risk, and flags vehicles that have gone quiet. Stores see their own arrival time.",
    "D7 · S2",
  ],
  [
    "Deferrals lack a clear record",
    "Every deferral carries a reason code, the calculation behind it, the next run and the store’s message. An outlet skipped yesterday goes first today and is flagged if skipped again.",
    "D3 · D5 · S3",
  ],
  [
    "Communication has no feedback",
    "Loaders flag shortfalls before departure, drivers record proof of delivery, and every plan change must be acknowledged by the loader or driver it affects.",
    "L3 · R3 · L4 · R6",
  ],
  [
    "Demand is hard to anticipate",
    "A ten-week forecast of total and chilled volume per depot and brand against refrigerated capacity (Datathon Task 2A slot).",
    "D9",
  ],
  [
    "Service time and lateness are not predicted",
    "Each planned stop shows predicted handling time and late probability (Datathon Task 1 slot), marked as model estimates.",
    "R2 · D6 · D7",
  ],
  [
    "Field connectivity is unreliable",
    "Driver and loader work offline by default; records replay in order and route changes are reconciled on reconnect.",
    "R5 · R6 · R7",
  ],
];

const PERSONAS = [
  {
    name: "Geemal",
    role: "Dispatcher",
    icon: Monitor,
    where: "Peliyagoda planning office · large screen · stable connection",
    day: "Closes orders at 16:00 and has the next morning’s plan published by early evening; watches Fresh runs from 03:30 and handles whatever breaks until the trading day ends.",
    today:
      "Plans in a spreadsheet from memory of which outlets are van-only and which trucks have working reefers. Learns about problems when a driver phones.",
    needs: [
      "A plan that respects every rule without him re-checking it",
      "To see what limited the day and explain each deferral",
      "To see vehicles and drivers after they leave the depot",
      "To know which outlets were already skipped",
    ],
    fromOthers:
      "Shortfalls from the loader before departure; delivery records and breakdowns from drivers; receipt problems from stores.",
    design:
      "Leads with “What limited today”; hard constraints are never overridable; deferrals carry their calculation; live view shows who is offline and whether a change was seen.",
  },
  {
    name: "Kamal",
    role: "Loader",
    icon: TabletSmartphone,
    where:
      "Peliyagoda or Kandy dock · shared tablet or terminal · noisy, gloves on",
    day: "Loads Fresh trips from about 03:00 so the first trucks leave from 03:30, then Style and Tech trips for the trading day.",
    today:
      "Works from a printed loading list that goes stale as soon as the dispatcher changes something; shortfalls are shouted across the dock or discovered at the outlet.",
    needs: [
      "The stop sequence, reversed, so the first delivery comes off first",
      "To count quickly and flag what’s missing before the truck leaves",
      "To see a late plan change as a clear list of what to take off and put on",
    ],
    fromOthers:
      "Published trips and late changes from the dispatcher; shortfall decisions back from the dispatcher.",
    design:
      "Large touch targets, one stop at a time, a “plan changed” checklist that blocks departure until confirmed, works offline on the dock terminal.",
  },
  {
    name: "Nimal",
    role: "Driver",
    icon: Smartphone,
    where:
      "In the cab on his own phone · dark early mornings · signal drops in hill country and the Kandy corridor",
    day: "Leaves Peliyagoda around 04:30 with a reefer load for five Colombo supermarkets that open at 08:00; sometimes runs a second trip.",
    today:
      "Paper run sheet; changes arrive by phone call; proof of delivery is a signature on paper that can be lost.",
    needs: [
      "Next stop, arrival time and window at a glance when safely stopped",
      "To record outcome and proof even without signal",
      "To be told clearly — and once — when his route changed",
    ],
    fromOthers:
      "A loaded, confirmed vehicle from the loader; route changes from the dispatcher; the outlet’s access rules and window.",
    design:
      "Night theme by default, large buttons, Sinhala and Tamil, offline-first outbox, a reconciliation screen after reconnecting that must be acknowledged.",
  },
  {
    name: "Dilini",
    role: "Store manager",
    icon: StoreIcon,
    where: "Fresh Borella (OUT032) · outlet counter PC or phone",
    day: "Orders dairy, meat, frozen and dry goods before 16:00; needs a receiving team at the back door before the store opens at 08:00.",
    today:
      "Phones or messages the order and never knows if it was received or scheduled; finds out about a missed delivery when the truck doesn’t come.",
    needs: [
      "Confirmation that the order was received, and for which day",
      "An arrival time to plan staff",
      "Clear notice and a reason if the order is moved",
      "A way to confirm receipt and report problems",
    ],
    fromOthers:
      "The dispatcher’s schedule and deferral reasons; the driver’s delivery record and proof.",
    design:
      "Countdown to the cutoff, the chilled/dry split made visible, a 20-minute arrival slot, a plain-language deferral card, receipt confirmation that opens an issue if anything is wrong.",
  },
];

const HANDOFFS: [string, string, string][] = [
  [
    "Store manager → Dispatcher",
    "Confirmed order, split chilled/dry, dated to the right run",
    "S1 → D2",
  ],
  [
    "Dispatcher → Loader",
    "Published trips with stop sequence; late changes as a checklist",
    "D3 → L2 · L4",
  ],
  [
    "Loader → Dispatcher",
    "Shortfall with reason and photo, before departure",
    "L3 → D issues",
  ],
  [
    "Loader → Driver",
    "Vehicle loaded and confirmed; Start route unlocks",
    "L2 → R1",
  ],
  [
    "Dispatcher → Driver",
    "Route change, shown on reconnect and acknowledged",
    "D6 → R6 → D7",
  ],
  [
    "Dispatcher → Store manager",
    "Arrival time, vehicle changes, deferral reason and new date",
    "D3 → S2 · S3 · S7",
  ],
  [
    "Driver → Store manager",
    "Delivery record with proof, even if recorded offline",
    "R3 → S4",
  ],
  [
    "Store manager → Dispatcher",
    "Receipt confirmed or issue reported",
    "S4 · S5 → D issues",
  ],
];

const RULES: [string, string][] = [
  [
    "Weight and volume",
    "Every trip is checked against both weight_cap_kg and volume_cap_m3.",
  ],
  [
    "Refrigeration",
    "Chilled orders only on reefers (12 trucks + 4 vans = 16); reefers may carry ambient.",
  ],
  [
    "Access",
    "van_only outlets only by vans; mall_dock outlets only inside the mall window.",
  ],
  [
    "Home depot",
    "Vehicles serve only their own depot’s outlets (Peliyagoda or Kandy).",
  ],
  [
    "One brand, one district per trip",
    "Enforced by construction — an order joins a matching trip or opens a new one.",
  ],
  [
    "Two trips, two budgets",
    "At most two trips per vehicle in any mix; Fresh trips share 270 min (03:30–08:00), Style + Tech share 480 min.",
  ],
  [
    "Trip time",
    "outbound + inter-stop × (stops − 1) + Σ service allowance, no return leg (booklet Task 2B).",
  ],
  [
    "Delivery windows",
    "Arrive by the window close; early arrivals wait for the window to open.",
  ],
  [
    "Weekly fuel quota",
    "Round-trip distance ÷ km per litre, against weekly_fuel_quota_l.",
  ],
  [
    "Cutoff and operating days",
    "Orders close at 16:00; runs Monday–Saturday per calendar.csv.",
  ],
  [
    "Separate chilled orders",
    "Fresh outlets order dry goods daily and chilled goods on several days, so one outlet can have two orders.",
  ],
  [
    "Network",
    "120 outlets (80 Fresh, 25 Style, 15 Tech), 12 districts, 60 vehicles, two depots.",
  ],
];

export function FigmaDoc() {
  useLightTheme();
  return (
    <div className="min-h-dvh bg-bg py-16">
      {/* 1 · Cover */}
      <section
        data-export="Cover"
        className="mx-auto mb-24 flex h-[900px] w-[1440px] flex-col justify-between overflow-hidden rounded-3xl bg-teal p-20 text-white shadow-card"
      >
        <div className="flex items-center justify-between">
          <Logo inverse />
          <span className="text-sm text-white/80">
            Tech-Triathlon 2026 · Designathon · Team Aevion
          </span>
        </div>
        <div>
          <div className="text-lg font-semibold uppercase tracking-[0.2em] text-white/80">
            Waypoint Group delivery planning
          </div>
          <h1 className="landing-wordmark mt-4 text-[120px] leading-none">
            Kairon
          </h1>
          <p className="mt-6 max-w-3xl text-3xl leading-snug text-white/90">
            One operation for dispatchers, loaders, drivers and store managers —
            that explains every decision, and keeps working when the signal
            doesn’t.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-6 text-sm text-white/85">
          {[
            "Dispatcher · Geemal",
            "Loader · Kamal",
            "Driver · Nimal",
            "Store manager · Dilini",
          ].map((r) => (
            <div key={r} className="border-t border-white/30 pt-3">
              {r}
            </div>
          ))}
        </div>
      </section>

      {/* 2 · Problem framing */}
      <Artboard
        label="Problem framing"
        title="On most days Waypoint can’t deliver everything. The problem isn’t only capacity — it’s that nobody can see or explain the trade-offs."
      >
        <div className="mb-10 grid grid-cols-3 gap-6">
          {[
            [
              "Demand exceeds capacity is the normal day",
              "The brief says the fleet usually can’t meet every brand’s needs. So deferral is part of everyday planning, not an error state — our degradation screens are reserved for real breakdowns.",
            ],
            [
              "The binding resource is refrigerated time before 08:00",
              "80 Fresh supermarkets must be served before opening, chilled orders need one of 16 reefers, and some outlets only take vans. That is where deferrals come from.",
            ],
            [
              "Information doesn’t flow back",
              "Printed lists, phone calls and paper signatures mean decisions don’t reach the loader, and delivery records don’t reach the store.",
            ],
          ].map(([t, b]) => (
            <div key={t} className="rounded-2xl bg-surface-2 p-6">
              <h3 className="font-display text-xl font-semibold">{t}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </div>
        <table className="w-full text-left text-[15px]">
          <thead className="border-b-2 border-ink text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-3 pr-6">Problem from the brief</th>
              <th className="py-3 pr-6">What Kairon does</th>
              <th className="py-3">Screens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {PROBLEMS.map(([p, a, s]) => (
              <tr key={p} className="align-top">
                <td className="w-72 py-4 pr-6 font-semibold">{p}</td>
                <td className="py-4 pr-6 leading-relaxed">{a}</td>
                <td className="w-40 py-4 font-mono text-sm text-brand-ink">
                  {s}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Artboard>

      {/* 3 · Workflow */}
      <Artboard
        label="The system"
        title="One workflow, four roles — every hand-off is a screen, not a phone call"
      >
        <WorkflowDiagram />
      </Artboard>

      {/* 4 · Personas */}
      <Artboard
        label="User personas"
        title="Designed around where and when each person works"
      >
        <div className="grid grid-cols-2 gap-8">
          {PERSONAS.map((p) => (
            <div key={p.name} className="rounded-2xl border border-line p-8">
              <div className="flex items-center gap-4">
                <span className="grid size-16 place-items-center rounded-full bg-teal font-display text-2xl font-semibold text-white">
                  {p.name[0]}
                </span>
                <div>
                  <div className="font-display text-2xl font-semibold">
                    {p.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <p.icon className="size-4" /> {p.role}
                  </div>
                </div>
              </div>
              <p className="mt-4 rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium">
                {p.where}
              </p>
              <dl className="mt-4 space-y-3 text-[15px] leading-relaxed">
                <div>
                  <dt className="eyebrow">A normal day</dt>
                  <dd>{p.day}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Today</dt>
                  <dd>{p.today}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Needs</dt>
                  <dd>
                    <ul className="list-disc pl-5">
                      {p.needs.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Needs from other roles</dt>
                  <dd>{p.fromOthers}</dd>
                </div>
                <div className="rounded-lg border-l-4 border-brand bg-brand-soft px-4 py-3">
                  <dt className="eyebrow !text-brand-ink">So we designed</dt>
                  <dd>{p.design}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </Artboard>

      {/* 5 · Scope */}
      <Artboard
        label="Scope and prioritisation"
        title="We designed the flows that move goods and information — and deliberately left the rest out"
      >
        <div className="grid grid-cols-2 gap-10">
          <div>
            <h3 className="mb-4 font-display text-2xl font-semibold text-brand-ink">
              Designed in depth
            </h3>
            <ul className="space-y-3 text-[16px] leading-relaxed">
              {[
                "Ordering with confirmation and a visible cutoff",
                "Planning an over-capacity day with explained deferrals",
                "Loading in stop order with shortfalls decided before departure",
                "Delivering with proof, offline",
                "Receipt confirmation and issue reporting",
                "Three failure scenarios, one of them end to end across all four roles",
                "Forecast and prediction slots for the Datathon models",
              ].map((x) => (
                <li key={x} className="flex gap-3">
                  <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" />
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-4 font-display text-2xl font-semibold text-attention-ink">
              Deliberately not designed
            </h3>
            <ul className="space-y-3 text-[16px] leading-relaxed">
              {[
                [
                  "Turn-by-turn navigation",
                  "drivers already have navigation apps; we show the stop on a map and link to OpenStreetMap directions.",
                ],
                [
                  "Route optimisation maps",
                  "within one district the stop order follows window close times; a map editor adds effort without adding a decision.",
                ],
                [
                  "Driver rostering",
                  "the brief says driver availability is not a separate constraint.",
                ],
                [
                  "Pricing, invoicing, shopper apps",
                  "outside the delivery workflow.",
                ],
                [
                  "Native apps",
                  "the brief requires a responsive web app; ours installs as a PWA and works offline.",
                ],
                [
                  "Secondary screens",
                  "history, vehicle and outlet lists, what-if simulator and settings exist in the prototype but are not core flows, so they are not in this file.",
                ],
              ].map(([a, b]) => (
                <li key={a} className="flex gap-3">
                  <span className="mt-2 size-2 shrink-0 rounded-full bg-attention" />
                  <span>
                    <b>{a}</b> — {b}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Artboard>

      {/* 6 · Connections */}
      <Artboard
        label="Connecting the roles"
        title="A dispatcher’s decision reaches the loader; a driver’s record gives the store something to act on"
      >
        <table className="w-full text-left text-[16px]">
          <thead className="border-b-2 border-ink text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-3 pr-6">From → to</th>
              <th className="py-3 pr-6">What travels</th>
              <th className="py-3">Screens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {HANDOFFS.map(([a, b, c]) => (
              <tr key={a + c}>
                <td className="w-80 py-4 pr-6 font-semibold">{a}</td>
                <td className="py-4 pr-6">{b}</td>
                <td className="w-56 py-4 font-mono text-sm text-brand-ink">
                  {c}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-8 text-[15px] text-muted">
          Every status uses the same word and colour in all four roles, so “On
          the way” on the store’s screen means exactly what it means on the
          dispatcher’s.
        </p>
      </Artboard>

      {/* 7 · Domain rules */}
      <Artboard
        label="Domain accuracy"
        title="Every allocation is checked against Waypoint’s operating rules"
      >
        <div className="grid grid-cols-2 gap-x-12 gap-y-5">
          {RULES.map(([a, b]) => (
            <div key={a} className="flex gap-4 border-b border-line pb-4">
              <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink">
                ✓
              </span>
              <div>
                <div className="font-semibold">{a}</div>
                <div className="text-[15px] text-muted">{b}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-8 rounded-xl bg-surface-2 p-5 text-[15px]">
          Example from the prototype: VEH014’s Fresh trip to Colombo — 24 min
          outbound + 4 × 8 min between stops + 5 stops × 15 min handling ={" "}
          <b>131 min</b> of its 270 Fresh minutes, leaving at 04:36 to meet
          05:00 windows.
        </p>
      </Artboard>

      {/* 8 · Trade-off */}
      <Artboard
        label="Core design trade-off"
        title="Serve 11 more orders today, or keep two reefers to rescue a breakdown?"
      >
        <div className="grid grid-cols-[1fr_120px_1fr] items-stretch gap-6">
          <div className="rounded-2xl border-2 border-line p-8">
            <div className="eyebrow">Option A</div>
            <h3 className="mt-1 font-display text-2xl font-semibold">
              Plan every vehicle
            </h3>
            <ul className="mt-4 space-y-2 text-[16px]">
              <li>+11 orders served on a typical day</li>
              <li>Utilisation looks better on the dashboard</li>
              <li className="text-critical-ink">
                A reefer breakdown at 05:30 strands ~5 chilled stops with no
                vehicle to rescue them before 08:00
              </li>
              <li className="text-critical-ink">
                Chilled stock wasted, several supermarkets miss morning sales
              </li>
            </ul>
          </div>
          <div className="grid place-items-center">
            <Scale />
          </div>
          <div className="rounded-2xl border-2 border-brand bg-brand-soft/40 p-8">
            <div className="eyebrow !text-brand-ink">Option B · our choice</div>
            <h3 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
              <LifeBuoy className="size-6 text-info" /> Hold VEH008 + VEH031 in
              reserve
            </h3>
            <ul className="mt-4 space-y-2 text-[16px]">
              <li>
                11 more deferrals — each with its reason, top priority on the
                next run
              </li>
              <li>
                A breakdown is recovered in about 30 minutes with a reefer
              </li>
              <li>
                The cost is shown on the plan, so the dispatcher can release the
                reserve on a quiet day
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-10 max-w-5xl text-lg leading-relaxed">
          The planner could hide this choice inside an algorithm. We show it on
          the plan instead (“releasing them would serve 11 more orders, but
          leave no reefer for a rescue”), because the dispatcher is accountable
          for both outcomes and knows things the data doesn’t — a festival week,
          a van already making strange noises.
        </p>
      </Artboard>

      {/* 9 · Style guide */}
      <StyleGuide />

      {/* 10 · AI disclosure */}
      <Artboard label="AI tool disclosure" title="How we used AI tools">
        <Callout
          tone="attention"
          title="Draft — the team completes and signs off this page before submission"
          className="mb-8"
        >
          Replace the bracketed parts with what your team actually did.
        </Callout>
        <div className="grid grid-cols-2 gap-10 text-[16px] leading-relaxed">
          <div>
            <h3 className="mb-3 font-display text-2xl font-semibold">
              AI-assisted
            </h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Claude Code (Anthropic) was used to audit the prototype against
                the brief, implement screens and planning rules in code, and
                capture screenshots for this file.
              </li>
              <li>
                First drafts of Sinhala and Tamil interface text (marked for
                native-speaker review).
              </li>
              <li>
                First drafts of persona and rationale text, which the team
                edited.
              </li>
              <li>
                [Other tools the team used, e.g. image generation,
                spell-checking]
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-3 font-display text-2xl font-semibold">
              Done by the team
            </h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Problem framing: treating over-capacity as the normal day and
                choosing the degradation scenarios.
              </li>
              <li>
                Palette, colour meanings, night theme for drivers,
                three-language decision.
              </li>
              <li>
                Choosing the recovery-reserve trade-off and the scope cuts.
              </li>
              <li>
                Reviewing every screen and rationale; arranging and prototyping
                in Figma; the demo video.
              </li>
              <li>
                [Research the team did, e.g. conversations with drivers or store
                staff]
              </li>
            </ul>
          </div>
        </div>
      </Artboard>
    </div>
  );
}

function Scale() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
      <line
        x1="48"
        y1="14"
        x2="48"
        y2="82"
        stroke="var(--steel)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <line
        x1="14"
        y1="30"
        x2="82"
        y2="22"
        stroke="var(--steel)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M8 30 L20 30 L14 50 Z" fill="var(--line-strong)" />
      <path d="M76 22 L88 22 L82 42 Z" fill="var(--brand)" />
      <rect x="32" y="80" width="32" height="6" rx="3" fill="var(--steel)" />
    </svg>
  );
}

/** Swimlane diagram of the workflow — plain SVG so it imports into Figma as vectors. */
function WorkflowDiagram() {
  const lanes = [
    { name: "Store manager", y: 40 },
    { name: "Dispatcher", y: 170 },
    { name: "Loader", y: 300 },
    { name: "Driver", y: 430 },
  ];
  const steps = [
    { lane: 0, x: 250, t: "Place order", s: "before 16:00" },
    { lane: 1, x: 410, t: "Close orders", s: "one queue" },
    { lane: 1, x: 570, t: "Plan & defer", s: "rules + reasons" },
    { lane: 2, x: 730, t: "Load in order", s: "flag shortfalls" },
    { lane: 3, x: 890, t: "Deliver", s: "proof, offline" },
    { lane: 0, x: 1050, t: "Confirm receipt", s: "or report issue" },
    { lane: 1, x: 1210, t: "Plan ahead", s: "forecast" },
  ];
  const W = 1312;
  const box = (x: number, y: number) => ({
    x: x - 70,
    y: y + 14,
    w: 140,
    h: 72,
  });
  const link = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    `M${a.x + a.w} ${a.y + a.h / 2} C ${a.x + a.w + 14} ${a.y + a.h / 2}, ${b.x - 14} ${b.y + b.h / 2}, ${b.x} ${b.y + b.h / 2}`;
  return (
    <svg
      viewBox={`0 0 ${W} 540`}
      className="w-full"
      role="img"
      aria-label="Workflow across the four roles"
    >
      {lanes.map((l) => (
        <g key={l.name}>
          <rect
            x="0"
            y={l.y}
            width={W}
            height="100"
            rx="14"
            fill="var(--surface-2)"
          />
          <text
            x="20"
            y={l.y + 56}
            fontSize="16"
            fontWeight="600"
            fill="var(--muted)"
          >
            {l.name}
          </text>
        </g>
      ))}
      {steps.slice(0, -1).map((s, i) => (
        <path
          key={i}
          d={link(
            box(s.x, lanes[s.lane].y),
            box(steps[i + 1].x, lanes[steps[i + 1].lane].y),
          )}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2.5"
          markerEnd="url(#arrow)"
        />
      ))}
      {/* Feedback that flows back up the chain */}
      <path
        d="M730 314 C 730 280, 600 290, 590 258"
        fill="none"
        stroke="var(--attention)"
        strokeWidth="2"
        strokeDasharray="6 5"
        markerEnd="url(#arrowA)"
      />
      <text x="672" y="290" fontSize="12" fill="var(--attention-ink)">
        shortfall
      </text>
      <path
        d="M880 444 C 860 380, 640 350, 620 258"
        fill="none"
        stroke="var(--attention)"
        strokeWidth="2"
        strokeDasharray="6 5"
        markerEnd="url(#arrowA)"
      />
      <text x="770" y="392" fontSize="12" fill="var(--attention-ink)">
        route change ⇄ acknowledged
      </text>
      <path
        d="M560 184 C 540 150, 290 170, 260 128"
        fill="none"
        stroke="var(--info)"
        strokeWidth="2"
        strokeDasharray="6 5"
        markerEnd="url(#arrowI)"
      />
      <text x="360" y="160" fontSize="12" fill="var(--info-ink)">
        arrival time · deferral reason
      </text>
      <path
        d="M960 444 C 990 330, 1000 180, 1040 128"
        fill="none"
        stroke="var(--info)"
        strokeWidth="2"
        strokeDasharray="6 5"
        markerEnd="url(#arrowI)"
      />
      <text x="990" y="300" fontSize="12" fill="var(--info-ink)">
        proof of delivery
      </text>
      {steps.map((s) => {
        const b = box(s.x, lanes[s.lane].y);
        return (
          <g key={s.t}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx="12"
              fill="var(--surface)"
              stroke="var(--line-strong)"
            />
            <text
              x={s.x}
              y={b.y + 32}
              textAnchor="middle"
              fontSize="15"
              fontWeight="700"
              fill="var(--ink)"
            >
              {s.t}
            </text>
            <text
              x={s.x}
              y={b.y + 52}
              textAnchor="middle"
              fontSize="12"
              fill="var(--muted)"
            >
              {s.s}
            </text>
          </g>
        );
      })}
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--brand)" />
        </marker>
        <marker
          id="arrowA"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--attention)" />
        </marker>
        <marker
          id="arrowI"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--info)" />
        </marker>
      </defs>
    </svg>
  );
}

const SWATCHES: [string, string, string, string][] = [
  ["Stormy Teal", "#106C6C", "Primary actions, progress, done", "--brand"],
  [
    "Chocolate",
    "#D66D32",
    "Needs attention · deferred · at risk",
    "--attention",
  ],
  ["Ocean Blue", "#0284C7", "Info · in transit · chilled (with ❄)", "--info"],
  ["Brick", "#A63A2C", "Failed · late · over capacity", "--critical"],
  ["Cool Steel", "#85979A", "Borders, icons, secondary", "--steel"],
  ["Platinum", "#E5E7EB", "Surfaces", "--bg"],
];

function StyleGuide() {
  const statuses: OrderStatus[] = [
    "CONFIRMED",
    "PLANNED",
    "DEFERRED",
    "LOADED",
    "IN_TRANSIT",
    "ARRIVED",
    "DELIVERED",
    "PARTIAL",
    "FAILED",
    "RECEIVED",
  ];
  const ink = [
    ["Chocolate text", "#8F3D11", "on #F8E1D3 · 5.9:1"],
    ["Ocean text", "#025B8A", "on #D7ECF8 · 6.0:1"],
    ["Teal text", "#0A4F4F", "on #D4E8E8 · 7.4:1"],
    ["Chocolate fill", "#B4541F", "white text · 5.0:1"],
    ["Ocean fill", "#0369A1", "white text · 5.9:1"],
    ["Teal fill (night)", "#137A7A", "white text · 5.1:1"],
  ];
  return (
    <Artboard
      label="Style guide"
      title="One visual language across all four roles"
    >
      <h3 className="mb-4 font-display text-2xl font-semibold">
        Palette and meaning
      </h3>
      <div className="grid grid-cols-6 gap-4">
        {SWATCHES.map(([n, hex, m, v]) => (
          <div
            key={n}
            className="overflow-hidden rounded-2xl border border-line"
          >
            <div className="h-24" style={{ background: `var(${v})` }} />
            <div className="p-3">
              <div className="font-semibold">{n}</div>
              <div className="font-mono text-xs text-muted">{hex}</div>
              <div className="mt-1 text-xs">{m}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[15px] text-muted">
        Brands (Fresh, Style, Tech) are never shown by colour — always an icon
        and a name — so colour only ever means status.
      </p>

      <h3 className="mb-4 mt-10 font-display text-2xl font-semibold">
        Contrast (WCAG AA)
      </h3>
      <p className="mb-4 text-[15px] text-muted">
        Chocolate (3.5:1), Ocean (4.1:1) and Steel (3.0:1) fail AA for small
        text on white, so text uses darker shades of the same hue and any fill
        carrying white text uses a deeper fill.
      </p>
      <div className="grid grid-cols-6 gap-4">
        {ink.map(([n, hex, r]) => (
          <div key={n} className="rounded-xl border border-line p-3">
            <div className="mb-2 h-10 rounded-lg" style={{ background: hex }} />
            <div className="text-sm font-semibold">{n}</div>
            <div className="font-mono text-xs text-muted">{hex}</div>
            <div className="text-xs">{r}</div>
          </div>
        ))}
      </div>

      <div className="mt-10 grid grid-cols-2 gap-10">
        <div>
          <h3 className="mb-4 font-display text-2xl font-semibold">Type</h3>
          <div className="space-y-3">
            <div className="font-display text-4xl font-semibold">
              Space Grotesk · headings
            </div>
            <div className="text-lg">Inter · body text and interface</div>
            <div className="id text-lg">
              JetBrains Mono · IDs VEH014 · OUT032 · 05:52
            </div>
            <div className="text-lg" lang="si">
              Noto Sans Sinhala · ඔබේ මාර්ගය වෙනස් විය
            </div>
            <div className="text-lg" lang="ta">
              Noto Sans Tamil · உங்கள் பாதை மாறியது
            </div>
            <p className="text-sm text-muted">
              All fonts are available in Figma and bundled with the app, so they
              render offline.
            </p>
          </div>
        </div>
        <div>
          <h3 className="mb-4 font-display text-2xl font-semibold">
            Status — the same in every role
          </h3>
          <div className="flex flex-wrap gap-2">
            {statuses.map((s) => (
              <StatusBadge key={s} s={s} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <BrandTag brand="Fresh" />
            <BrandTag brand="Style" />
            <BrandTag brand="Tech" />
            <TempTag temp="CHILLED" />
            <ModelChip />
            <SeverityBadge s="INFO" />
            <SeverityBadge s="WARNING" />
            <SeverityBadge s="HIGH" />
            <SeverityBadge s="CRITICAL" />
          </div>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-3 gap-10">
        <div>
          <h3 className="mb-4 font-display text-2xl font-semibold">Buttons</h3>
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="attention">Defer</Button>
            <Button variant="danger">Report breakdown</Button>
          </div>
          <Button size="xl" block className="mt-3">
            Driver action · 56 px tall
          </Button>
        </div>
        <div>
          <h3 className="mb-4 font-display text-2xl font-semibold">
            Meters and checks
          </h3>
          <div className="space-y-3">
            <Meter
              label="Fresh budget"
              value={131}
              max={270}
              detail="131 / 270 min"
            />
            <Meter label="Volume" value={14.4} max={16} detail="14.4 / 16 m³" />
            <Meter
              label="Weight"
              value={3700}
              max={3500}
              detail="3,700 / 3,500 kg"
            />
          </div>
          <div className="mt-3">
            <CheckRow
              ok
              label="Temperature"
              detail="Chilled goods on a reefer"
            />
            <CheckRow ok={false} label="Outlet access" detail="Van only" />
            <CheckRow
              ok={false}
              warn
              label="Recovery reserve"
              detail="Held for recovery"
            />
          </div>
        </div>
        <div>
          <h3 className="mb-4 font-display text-2xl font-semibold">Messages</h3>
          <div className="space-y-3">
            <Callout
              tone="neutral"
              icon={<CloudOff className="size-5" />}
              title="You’re offline"
            >
              Work is saved on this phone.
            </Callout>
            <Callout
              tone="attention"
              icon={<TriangleAlert className="size-5" />}
              title="Plan changed after loading started"
            >
              Confirm before departure.
            </Callout>
            <Callout
              tone="info"
              icon={<Snowflake className="size-5" />}
              title="Chilled"
            >
              Keep in the reefer.
            </Callout>
          </div>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-[1fr_auto] items-center gap-10 rounded-2xl bg-surface-2 p-8">
        <div>
          <h3 className="font-display text-2xl font-semibold">
            Night theme for drivers
          </h3>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed">
            Fresh runs leave between 03:30 and 04:40, so the driver app opens in
            the night theme to keep glare down in the cab. Every other role
            starts light; anyone can switch. The same tokens drive both themes,
            with fills re-checked for contrast.
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Leaf className="size-4" /> Large touch targets (≥ 48 px) for gloves
            and a moving day; driver screens are for use when safely stopped.
          </p>
        </div>
        <div className="flex items-start gap-4">
          <Shot f={frameById("R2-route")} width={200} />
          <Shot f={frameById("R1-ready")} width={200} />
        </div>
      </div>
    </Artboard>
  );
}
