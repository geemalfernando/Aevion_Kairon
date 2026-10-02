import { Copyright } from '../../components/Copyright'
import {
  ArrowRight,
  Check,
  CircleDot,
  Cloud,
  CloudOff,
  Download,
  FileSpreadsheet,
  Laptop,
  MonitorSmartphone,
  PhoneOff,
  RefreshCw,
  Smartphone,
  Snowflake,
  Tablet,
  TimerOff,
  type LucideIcon,
} from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HOME } from '../../components/shell/nav'
import { DeliverVignette, DeliveryScene, LaptopMock, LoadVignette, OrderVignette, PhoneMock, PlanVignette, Reveal, TabletMock } from '../../components/illustrations'
import { BRAND_SHAPE, OutletMap } from '../../components/RouteMap'
import { Button, cn } from '../../components/ui'
import { DEPOT_POS as DEPOTS } from '@core/reference'
import { useOps, useSession } from '../../store'

export function Landing() {
  const user = useSession((s) => s.user)
  return (
    <div className="bg-bg">
      <Nav signedIn={!!user} home={user ? HOME[user.role] : '/login'} />
      <Hero />
      <RouteScene />
      <Problems />
      <Workflow />
      <Intelligence />
      <Devices />
      <Roles />
      <Coverage />
      <OfflineDemo />
      <FinalCta />
      <AppDownload />
      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 text-sm text-muted sm:px-6">
          <LandingBrand />
          <span>One shared operation · Dispatcher · Loader · Driver · Store</span>
        </div>
        <div className="mx-auto mt-5 max-w-7xl px-4 text-xs text-muted sm:px-6">
          <Copyright />
        </div>
      </footer>
    </div>
  )
}

/** Landing-only brand: the route mark on its own, large. The app keeps mark + wordmark. */
function LandingBrand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="inline-flex h-12 w-[4.25rem] shrink-0 sm:h-14 sm:w-20" role="img" aria-label="Kairon">
      <img src="/brand/route-logo-dark.svg" alt="" width="680" height="486" className={cn('h-full w-full object-contain', !inverse && 'hidden dark:block')} />
      {!inverse && <img src="/brand/route-logo-light.svg" alt="" width="680" height="486" className="h-full w-full object-contain dark:hidden" />}
    </span>
  )
}

function Nav({ signedIn, home }: { signedIn: boolean; home: string }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 20)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <header className={cn('fixed inset-x-0 top-0 z-40 transition', scrolled ? 'border-b border-white/10 bg-[#0a1315]/85 backdrop-blur' : 'bg-transparent')}>
      <div className="mx-auto flex h-20 max-w-7xl items-center gap-4 lg:gap-8 px-4 sm:px-6">
        <Link to="/">
          <LandingBrand inverse />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-white/70 lg:flex">
          {[
            ['Platform', '#platform'],
            ['How it works', '#workflow'],
            ['Operations', '#roles'],
            ['Coverage', '#coverage'],
            ['Offline', '#offline'],
            ['Insights', '#intelligence'],
          ].map(([l, h]) => (
            <a key={h} href={h} className="transition hover:text-white">
              {l}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 xl:inline-flex">
            <span className="size-2 animate-pulse-dot rounded-full bg-[#34c27a] text-[#34c27a]" /> All systems operational
          </span>
          <Link to={home}>
            <Button variant="inverse" size="sm">
              {signedIn ? 'Open workspace' : 'Sign in'}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}

const VERBS = ['Predict', 'Plan', 'Validate', 'Deliver', 'Recover']

function Hero() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % VERBS.length), 1800)
    return () => clearInterval(t)
  }, [])
  const navigate = useNavigate()
  return (
    <section id="platform" className="relative overflow-hidden bg-[#0a1315] pb-20 pt-28 text-white sm:pt-32 lg:pb-28">
      <NetworkBackdrop />
      <div className="pointer-events-none absolute -left-40 top-20 size-[520px] rounded-full bg-teal/30 blur-[120px]" />
      <div className="pointer-events-none absolute -right-20 bottom-0 size-[380px] rounded-full bg-chocolate/15 blur-[120px]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
        <div className="animate-rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">
            <CircleDot className="size-3.5 text-chocolate" /> Live logistics operations platform
          </span>
          <h1 className="mt-6">
            <span className="landing-wordmark block bg-gradient-to-br from-white via-white to-[#5fd0cf] bg-clip-text pb-2 text-[clamp(5rem,20vw,9.5rem)] leading-[0.9] tracking-[-0.015em] text-transparent lg:text-[clamp(6rem,11vw,9.5rem)]">KAIRON</span>
            <span className="mt-5 block text-[32px] font-semibold leading-[1.1] tracking-tight sm:text-[42px] lg:text-[46px]">
              Plan smarter.
              <br />
              <span className="text-[#5fd0cf]">Deliver with confidence.</span>
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/70">One intelligent operations platform connecting orders, dispatchers, loaders, drivers and stores — even when the network drops.</p>
          <div className="mt-7 flex flex-wrap gap-2" aria-label="Predict, plan, validate, deliver, recover">
            {VERBS.map((v, k) => (
              <span key={v} className={cn('rounded-md px-3 py-1.5 font-display text-sm font-semibold transition-all duration-500', k === i ? 'bg-chocolate text-white' : k < i ? 'bg-white/10 text-white' : 'bg-white/5 text-white/40')}>
                {v}
              </span>
            ))}
          </div>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button size="lg" variant="inverse" onClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' })}>
              Explore platform <ArrowRight className="size-4" />
            </Button>
            <Button size="lg" className="!bg-white/10 hover:!bg-white/15" onClick={() => navigate('/login')}>
              Sign in
            </Button>
          </div>
        </div>
        <CommandPreview />
      </div>
    </section>
  )
}

function NetworkBackdrop() {
  const outlets = useOps((s) => s.data.outlets)
  return (
    <svg className="pointer-events-none absolute inset-y-0 right-0 h-full w-full opacity-[0.16] lg:w-2/3" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {outlets.slice(0, 80).map((o) => {
        const d = DEPOTS[o.depot]
        return <line key={o.id} x1={d.x} y1={d.y} x2={o.x} y2={o.y} stroke="#5fd0cf" strokeWidth="0.08" />
      })}
      {outlets.map((o) => (
        <circle key={o.id} cx={o.x} cy={o.y} r="0.45" fill="#e5e7eb" />
      ))}
      {Object.entries(DEPOTS).map(([k, d]) => (
        <circle key={k} cx={d.x} cy={d.y} r="1.2" fill="#D66D32" />
      ))}
    </svg>
  )
}

/** Animated preview of the command centre, driven by the seeded network. */
function CommandPreview() {
  const d = useOps((s) => s.data)
  const stops = ['OUT004', 'OUT018', 'OUT023', 'OUT031', 'OUT047']
  const etas = ['05:12', '05:41', '06:08', '06:42', '07:13']
  const [step, setStep] = useState(1)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s >= stops.length ? 0 : s + 1)), 1600)
    return () => clearInterval(t)
  }, [stops.length])
  const counts = useMemo(() => {
    const planned = d.orders.filter((o) => o.tripId || o.status === 'CONFIRMED').length
    return { outlets: d.outlets.length, vehicles: d.vehicles.length, orders: d.orders.length, planned: Math.min(planned, d.orders.length - 14), deferred: 14, risk: 8 }
  }, [d])
  return (
    <div className="relative animate-rise [animation-delay:150ms]">
      <div className="rounded-2xl border border-white/10 bg-[#0f1b1e]/90 p-5 shadow-2xl backdrop-blur-md sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Today's network</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#5fd0cf]">
            <span className="size-1.5 animate-pulse rounded-full bg-[#5fd0cf]" /> Live
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            [counts.outlets, 'Outlets'],
            [counts.vehicles, 'Vehicles'],
            [counts.orders, 'Orders'],
          ].map(([v, l]) => (
            <div key={l as string} className="rounded-xl bg-white/5 p-3">
              <div className="font-display text-2xl font-semibold tabular-nums sm:text-3xl">{v}</div>
              <div className="text-xs text-white/50">{l}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 divide-x divide-white/10 rounded-xl border border-white/10">
          {[
            [counts.planned, 'Planned', 'text-[#5fd0cf]'],
            [counts.deferred, 'Deferred', 'text-chocolate'],
            [counts.risk, 'At risk', 'text-[#f2a275]'],
          ].map(([v, l, c]) => (
            <div key={l as string} className="px-3 py-2.5">
              <div className={cn('font-display text-xl font-semibold tabular-nums', c as string)}>{v}</div>
              <div className="text-[11px] text-white/50">{l}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-xl bg-[#0a1315]/60 p-4">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="font-mono text-sm font-semibold">VEH002</div>
              <div className="text-xs text-white/50">Peliyagoda → Colombo · Reefer</div>
            </div>
            <span className="rounded-full bg-[#5fd0cf]/15 px-2 py-0.5 text-[11px] font-semibold text-[#5fd0cf]">{step === 0 ? 'Loading' : 'Departed'}</span>
          </div>
          <ol className="mt-3 space-y-2">
            {stops.map((s, k) => {
              const done = k < step - 1
              const current = k === step - 1
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span className={cn('grid size-4 place-items-center rounded-full border transition-all duration-500', done ? 'border-[#5fd0cf] bg-[#5fd0cf]' : current ? 'border-chocolate' : 'border-white/25')}>
                    {done && <Check className="size-2.5 text-[#0a1315]" strokeWidth={4} />}
                    {current && <span className="size-1.5 rounded-full bg-chocolate" />}
                  </span>
                  <span className="font-mono text-[13px]">{s}</span>
                  <span className={cn('ml-auto text-xs transition-colors', done ? 'text-[#5fd0cf]' : current ? 'text-chocolate' : 'text-white/40')}>{done ? 'Delivered' : current ? 'Arriving' : `ETA ${etas[k]}`}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-4 hidden items-center gap-3 rounded-xl border border-white/10 bg-[#101c1f] px-4 py-3 shadow-xl sm:flex">
        <span className="grid size-8 place-items-center rounded-lg bg-chocolate/20 text-chocolate">
          <Snowflake className="size-4" />
        </span>
        <div>
          <div className="text-xs font-semibold">OUT043 deferred</div>
          <div className="text-[11px] text-white/50">Reefer capacity exhausted · priority 74</div>
        </div>
      </div>
    </div>
  )
}

function SectionHead({ eyebrow, title, sub, inverse }: { eyebrow: string; title: React.ReactNode; sub?: string; inverse?: boolean }) {
  return (
    <Reveal className="mx-auto mb-12 max-w-2xl text-center">
      <div className={cn('mb-3 inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]', inverse ? 'bg-chocolate text-white' : 'bg-teal text-white')}>{eyebrow}</div>
      <h2 className={cn('text-3xl font-bold sm:text-[40px] sm:leading-[1.1]', inverse ? 'text-white' : 'text-ink')}>{title}</h2>
      {sub && <p className={cn('mt-4', inverse ? 'text-white/80' : 'text-muted')}>{sub}</p>}
    </Reveal>
  )
}

const PROBLEMS: { icon: LucideIcon; title: string; lines: string[] }[] = [
  { icon: FileSpreadsheet, title: 'Fragmented planning', lines: ['Orders arrive through different channels.', 'Plans live in spreadsheets.', 'Knowledge lives with one dispatcher.'] },
  { icon: PhoneOff, title: 'No live visibility', lines: ['Vehicles leave the depot.', 'The dispatcher loses visibility.', 'Problems arrive through phone calls.'] },
  { icon: TimerOff, title: 'Unexplained deferrals', lines: ['Orders get postponed.', "Stores don't know why.", 'The same outlet may be skipped repeatedly.'] },
  { icon: CloudOff, title: 'Unreliable connectivity', lines: ['Drivers move through low-coverage areas.', 'The operation still needs to continue.'] },
]

function Problems() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHead eyebrow="The problem" title={<>Logistics shouldn't depend on spreadsheets and phone calls.</>} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map((p, k) => (
            <Reveal key={p.title} delay={k * 90}>
            <div className="group h-full rounded-2xl border border-line border-t-4 border-t-chocolate bg-surface p-6 shadow-card transition hover:-translate-y-1 hover:shadow-pop">
              <span className="grid size-11 place-items-center rounded-xl bg-chocolate text-white transition group-hover:scale-110">
                <p.icon className="size-5" />
              </span>
              <h3 className="mt-5 text-sm font-bold uppercase tracking-[0.12em]">{p.title}</h3>
              <div className="mt-3 space-y-1 text-sm text-ink/80">
                {p.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

const FLOW: { key: string; role?: string; bullets?: string[] }[] = [
  { key: 'Store', role: 'Store manager', bullets: ['Knows what the outlet needs', 'Orders before the 4 PM cutoff'] },
  { key: 'Order', role: 'Store manager', bullets: ['Create order', 'Confirm submission', 'View scheduling'] },
  { key: 'Dispatch', role: 'Dispatcher', bullets: ['Close orders at cutoff', 'Review the planning queue'] },
  { key: 'Allocate', role: 'Dispatcher', bullets: ['Review closed orders', 'Allocate vehicles', 'Handle deferrals'] },
  { key: 'Load', role: 'Loader', bullets: ['View stop sequence', 'Confirm items', 'Report shortages'] },
  { key: 'Deliver', role: 'Driver', bullets: ['Follow route', 'Record outcome', 'Capture proof', 'Work offline'] },
  { key: 'Receive', role: 'Store manager', bullets: ['Confirm receipt', 'Report damaged or missing goods'] },
]

const VIGNETTE: Record<string, React.ReactNode> = {
  Store: <OrderVignette />,
  Order: <OrderVignette />,
  Dispatch: <PlanVignette />,
  Allocate: <PlanVignette />,
  Load: <LoadVignette />,
  Deliver: <DeliverVignette />,
  Receive: <DeliverVignette />,
}

function RouteScene() {
  return (
    <section className="relative -mt-10 px-4 sm:px-6">
      <Reveal className="mx-auto max-w-7xl">
        <DeliveryScene className="shadow-pop ring-1 ring-white/5" />
        <div className="mt-4 grid gap-3 text-sm text-muted sm:grid-cols-3">
          {[
            ['04:36', 'Reefer VEH002 leaves Peliyagoda with the stops loaded last-first.'],
            ['05:10', 'Signal drops on the way — the route, proof capture and issues keep working.'],
            ['06:12', 'OUT005 delivered, signed and photographed. It syncs the moment coverage returns.'],
          ].map(([t, d]) => (
            <p key={t} className="flex gap-3">
              <span className="font-mono font-semibold text-brand-ink">{t}</span>
              {d}
            </p>
          ))}
        </div>
      </Reveal>
    </section>
  )
}

function Devices() {
  return (
    <section className="overflow-hidden border-t border-line bg-[#0a1315] py-24 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal className="mx-auto mb-14 max-w-2xl text-center">
          <div className="mb-3 inline-block rounded-full bg-chocolate px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">Every screen, every device</div>
          <h2 className="text-3xl font-bold sm:text-[40px] sm:leading-[1.1]">A command center, a loading bay and a route companion.</h2>
          <p className="mt-4 text-white/60">Large screens for planning. A shared tablet at the bay. A phone in the cab that doesn’t need signal. Installable as an app on all of them.</p>
        </Reveal>
        <div className="relative mx-auto flex max-w-5xl items-end justify-center">
          <div className="pointer-events-none absolute inset-x-10 bottom-0 h-40 rounded-full bg-teal/30 blur-[90px]" />
          <Reveal className="relative w-full max-w-[640px]">
            <LaptopMock />
          </Reveal>
          <Reveal delay={200} className="absolute -left-2 bottom-2 hidden md:block">
            <div className="ill-orbit">
              <TabletMock />
            </div>
          </Reveal>
          <Reveal delay={350} className="absolute -right-2 -bottom-4 sm:right-6">
            <div className="ill-orbit [animation-delay:1.2s]">
              <PhoneMock className="scale-90 sm:scale-100" />
            </div>
          </Reveal>
        </div>
        <div className="mt-14 grid gap-4 text-center sm:grid-cols-3">
          {[
            ['Dispatcher', 'Drag-and-drop planning with live constraint checks'],
            ['Loader', 'Reverse stop sequence and one-tap shortfall reports'],
            ['Driver', 'Offline-first route, proof capture and sync'],
          ].map(([r, d], i) => (
            <Reveal key={r} delay={i * 120}>
              <div className="font-display text-lg font-semibold">{r}</div>
              <p className="text-sm text-white/55">{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function Workflow() {
  const [active, setActive] = useState(1)
  const [auto, setAuto] = useState(true)
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => setActive((a) => (a + 1) % FLOW.length), 2200)
    return () => clearInterval(t)
  }, [auto])
  const a = FLOW[active]
  return (
    <section id="workflow" className="relative overflow-hidden bg-teal py-24 text-white">
      <div className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-chocolate/25 blur-[100px]" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHead inverse eyebrow="Connected workflow" title="One decision, visible to every role." sub="A dispatcher's decision reaches the loader. A driver's delivery record reaches the store. Nothing lives in a notebook." />
        <div className="relative" onMouseLeave={() => setAuto(true)}>
          <svg className="absolute left-0 right-0 top-7 hidden h-1 w-full md:block" preserveAspectRatio="none" viewBox="0 0 100 1" aria-hidden>
            <line x1="4" y1="0.5" x2="96" y2="0.5" stroke="rgb(255 255 255 / 0.3)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <line x1="4" y1="0.5" x2={4 + (92 * active) / (FLOW.length - 1)} y2="0.5" stroke="#D66D32" strokeWidth="3" vectorEffect="non-scaling-stroke" className="transition-all duration-700" />
          </svg>
          <ol className="relative grid grid-cols-4 gap-y-6 md:grid-cols-7">
            {FLOW.map((f, k) => (
              <li key={f.key} className="flex flex-col items-center">
                <button
                  onMouseEnter={() => (setAuto(false), setActive(k))}
                  onFocus={() => (setAuto(false), setActive(k))}
                  onClick={() => (setAuto(false), setActive(k))}
                  className={cn(
                    'grid size-14 place-items-center rounded-2xl border-2 font-display text-sm font-bold transition-all duration-300',
                    k === active ? 'scale-110 border-chocolate bg-chocolate text-white shadow-lg shadow-black/30' : k < active ? 'border-white bg-white text-teal' : 'border-white/40 bg-teal text-white/75',
                  )}
                  aria-pressed={k === active}
                >
                  {String(k + 1).padStart(2, '0')}
                </button>
                <span className={cn('mt-3 text-xs font-bold uppercase tracking-[0.14em]', k === active ? 'text-white' : 'text-white/70')}>{f.key}</span>
              </li>
            ))}
          </ol>
          <div key={active} className="mx-auto mt-10 grid max-w-3xl animate-rise items-center gap-6 rounded-2xl bg-surface p-4 text-ink shadow-pop sm:grid-cols-[1.1fr_1fr] sm:p-6">
            <div className="overflow-hidden rounded-xl">{VIGNETTE[a.key]}</div>
            <div className="text-center sm:text-left">
              <div className="eyebrow !text-attention-ink">{String(active + 1).padStart(2, '0')} · {a.key}</div>
              <div className="mt-1 font-display text-2xl font-semibold">{a.role}</div>
              <ul className="mt-4 inline-flex flex-col gap-1.5 text-left text-sm">
                {a.bullets?.map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <Check className="size-4 text-brand" /> {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Intelligence() {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setOffline((o) => !o), 2600)
    return () => clearInterval(t)
  }, [])
  return (
    <section id="intelligence" className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHead eyebrow="Operational intelligence" title="Every plan is checked. Every decision is explained." />
        <div className="grid gap-5 lg:grid-cols-3">
          <Reveal className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="h-2 bg-teal" />
            <div className="p-7">
            <h3 className="text-lg font-semibold">Constraint-aware planning</h3>
            <p className="mt-1 text-sm text-muted">No allocation is saved unless it is physically possible.</p>
            <ul className="mt-5 grid grid-cols-2 gap-2.5 text-sm">
              {['Weight', 'Volume', 'Refrigeration', 'Vehicle access', 'Delivery windows', 'Fuel quota', 'Trip limits', 'Depot'].map((c, k) => (
                <li key={c} className="flex animate-rise items-center gap-2" style={{ animationDelay: `${k * 60}ms` }}>
                  <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success-ink">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  {c}
                </li>
              ))}
            </ul>
            </div>
          </Reveal>
          <Reveal delay={120} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="h-2 bg-ocean" />
            <div className="p-7">
            <h3 className="text-lg font-semibold">Offline-first delivery</h3>
            <p className="mt-1 text-sm text-muted">Network lost? No problem.</p>
            <div className={cn('mt-5 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-500', offline ? 'bg-ink text-bg' : 'bg-success-soft text-success-ink')}>
              {offline ? <CloudOff className="size-4" /> : <Cloud className="size-4" />}
              {offline ? 'Offline · 3 updates stored' : 'Online · synced'}
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {['Routes', 'Stops', 'Orders', 'Proof of delivery', 'Issues'].map((c) => (
                <li key={c} className="flex items-center justify-between border-b border-line pb-2 last:border-0">
                  {c}
                  <span className="text-xs font-medium text-success-ink">Available</span>
                </li>
              ))}
            </ul>
            </div>
          </Reveal>
          <Reveal delay={240} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="h-2 bg-chocolate" />
            <div className="p-7">
            <h3 className="text-lg font-semibold">Explainable decisions</h3>
            <p className="mt-1 text-sm text-muted">Stores see why, not just “delayed”.</p>
            <div className="mt-5 rounded-xl border border-attention/40 bg-attention-soft p-4">
              <div className="text-xs text-attention-ink">Why was OUT043 deferred?</div>
              <div className="mt-1 font-display text-lg font-bold text-attention-ink">REEFER CAPACITY EXHAUSTED</div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Priority</dt>
                <dd className="font-display text-xl font-semibold">74</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Last served</dt>
                <dd className="font-medium">2 days ago</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Next</dt>
                <dd className="font-medium">Tomorrow · Trip 1</dd>
              </div>
            </dl>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

const ROLES: { role: 'DISPATCHER' | 'LOADER' | 'DRIVER' | 'STORE_MANAGER'; name: string; title: string; body: string; device: string; icon: LucideIcon }[] = [
  { role: 'DISPATCHER', name: 'Dispatcher', title: 'Command center', body: 'Plan and control the delivery network.', device: 'Large screen', icon: Laptop },
  { role: 'LOADER', name: 'Loader', title: 'Loading workspace', body: 'Prepare vehicles in the correct stop order.', device: 'Shared terminal / tablet', icon: Tablet },
  { role: 'DRIVER', name: 'Driver', title: 'Route companion', body: 'Deliver reliably, even without connectivity.', device: 'Phone · works offline', icon: Smartphone },
  { role: 'STORE_MANAGER', name: 'Store manager', title: 'Store portal', body: 'Order, track and confirm deliveries.', device: 'Desktop or phone', icon: MonitorSmartphone },
]

function Coverage() {
  const outlets = useOps((s) => s.data.outlets)
  const [selected, setSelected] = useState<string>()
  const byDistrict = useMemo(() => {
    const m = new Map<string, { total: number; Fresh: number; Style: number; Tech: number; depot: string }>()
    for (const o of outlets) {
      const r = m.get(o.district) ?? { total: 0, Fresh: 0, Style: 0, Tech: 0, depot: o.depot }
      r.total++
      r[o.brand]++
      m.set(o.district, r)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [outlets])
  const max = Math.max(...byDistrict.map(([, r]) => r.total))
  const sel = outlets.find((o) => o.id === selected)
  return (
    <section id="coverage" className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHead eyebrow="Where we deliver" title="120 outlets across Sri Lanka, served from two depots." sub="Every Fresh, Style and Tech outlet on one live map — tap any store to see it." />
        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Reveal>
            <OutletMap outlets={outlets} selected={selected} onSelect={setSelected} className="h-[440px] shadow-pop sm:h-[560px]" describe={(o) => `${o.district} · ${o.brand}`} />
          </Reveal>
          <Reveal delay={150} className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                [outlets.length, 'Outlets'],
                [byDistrict.length, 'Districts'],
                [2, 'Depots'],
              ].map(([v, l]) => (
                <div key={l as string} className="rounded-2xl bg-teal p-4 text-white">
                  <div className="font-display text-3xl font-bold">{v}</div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-white/75">{l}</div>
                </div>
              ))}
            </div>
            <div className="flex-1 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="font-semibold">Outlets by district</h3>
                <span className="text-xs text-muted">served from</span>
              </div>
              <ul className="space-y-3">
                {byDistrict.map(([d, r]) => (
                  <li key={d}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-semibold">
                        {d} <span className="font-display tabular-nums text-muted">· {r.total}</span>
                      </span>
                      <span className="text-xs text-muted">{r.depot}</span>
                    </div>
                    <div className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-2" style={{ width: `${(r.total / max) * 100}%` }}>
                      {(['Fresh', 'Style', 'Tech'] as const).map((b) => (r[b] ? <span key={b} title={`${b}: ${r[b]}`} className={`km-${b.toLowerCase()} h-full`} style={{ flex: r[b], background: 'var(--c)' }} /> : null))}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3 text-xs font-semibold">
                {(['Fresh', 'Style', 'Tech'] as const).map((b) => (
                  <span key={b} className="inline-flex items-center gap-1.5">
                    <span className={`km-outlet km-${b.toLowerCase()} km-shape-${BRAND_SHAPE[b]}`} style={{ ['--s' as string]: '10px', margin: 0 }} />
                    {b} · {outlets.filter((o) => o.brand === b).length}
                  </span>
                ))}
              </div>
            </div>
            {sel && (
              <div key={sel.id} className="animate-rise rounded-2xl bg-ink p-4 text-bg">
                <div className="font-mono text-sm font-bold">{sel.id}</div>
                <div className="font-display text-lg font-semibold">{sel.name}</div>
                <div className="text-sm opacity-75">
                  {sel.district} · {sel.depot} depot · {sel.vanOnly ? 'Van-only access' : sel.mall ? 'Mall delivery bay' : 'Any vehicle'}
                </div>
              </div>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  )
}

const ROLE_TILE: Record<string, string> = { DISPATCHER: 'bg-teal', LOADER: 'bg-chocolate', DRIVER: 'bg-ocean', STORE_MANAGER: 'bg-[#0a1315] dark:bg-steel' }

function Roles() {
  return (
    <section id="roles" className="bg-surface py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHead eyebrow="Four roles, one operation" title="Designed for where each person actually works." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <Link key={r.role} to={`/login?role=${r.role}`} className="group relative overflow-hidden rounded-2xl border border-line-strong/60 bg-bg p-6 transition hover:-translate-y-1 hover:border-ink hover:shadow-pop">
              <span className={cn('grid size-12 place-items-center rounded-xl text-white shadow-md transition group-hover:scale-110', ROLE_TILE[r.role])}>
                <r.icon className="size-5" />
              </span>
              <div className="eyebrow mt-6">{r.name}</div>
              <h3 className="mt-1 text-xl font-semibold">{r.title}</h3>
              <p className="mt-2 text-sm text-muted">{r.body}</p>
              <div className="mt-6 flex items-center justify-between text-xs">
                <span className="rounded-full bg-ink px-2.5 py-1 font-semibold text-bg">{r.device}</span>
                <span className="inline-flex items-center gap-1 font-semibold text-brand-ink opacity-0 transition group-hover:opacity-100">
                  Try demo <ArrowRight className="size-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

const OFFLINE_STEPS = [
  { label: 'Connected', tone: 'success' },
  { label: 'Signal lost', tone: 'neutral' },
  { label: 'Offline mode', tone: 'neutral' },
  { label: 'Continue delivery', tone: 'brand' },
  { label: '3 events stored locally', tone: 'brand' },
  { label: 'Connection restored', tone: 'info' },
  { label: 'Syncing', tone: 'info' },
  { label: 'Everything synchronized', tone: 'success' },
] as const

function OfflineDemo() {
  const [k, setK] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setK((x) => (x + 1) % (OFFLINE_STEPS.length + 1)), 1300)
    return () => clearInterval(t)
  }, [])
  const offline = k >= 1 && k <= 4
  return (
    <section id="offline" className="py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 inline-block rounded-full bg-ocean px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">Offline-first</div>
          <h2 className="text-3xl font-bold sm:text-[40px] sm:leading-[1.1]">The route keeps going when the signal doesn't.</h2>
          <p className="mt-4 max-w-lg text-muted">
            Drivers and loaders keep every screen they need. Arrivals, deliveries, photos and signatures are saved on the device and synchronized the moment connection returns — with conflicts explained, never silently overwritten.
          </p>
          <Link to="/login?role=DRIVER" className="mt-8 inline-block">
            <Button size="lg">
              See offline workflow <ArrowRight className="size-4" />
            </Button>
          </Link>
        </div>
        <div className="relative mx-auto w-full max-w-sm">
          <div className="absolute -right-32 top-24 z-10 hidden rotate-6 xl:block">
            <div className="ill-orbit">
              <PhoneMock offline={offline} className="scale-75" />
            </div>
          </div>
          <div className="rounded-[2.2rem] border-8 border-ink/90 bg-surface p-4 shadow-pop">
            <div className={cn('mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors duration-500', offline ? 'bg-ink text-bg' : k >= 5 && k < 8 ? 'bg-info-fill text-white' : 'bg-success-soft text-success-ink')}>
              {offline ? <CloudOff className="size-4" /> : k >= 5 && k < 8 ? <RefreshCw className="size-4 animate-spin" /> : <Cloud className="size-4" />}
              {offline ? `Offline · ${Math.max(0, k - 2)} updates waiting` : k >= 5 && k < 8 ? 'Synchronizing…' : 'Online'}
            </div>
            <ol className="space-y-1">
              {OFFLINE_STEPS.map((s, i) => (
                <li key={s.label} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-500', i === k ? 'bg-brand-soft font-semibold text-brand-ink' : i < k ? 'text-ink' : 'text-faint')}>
                  <span className={cn('grid size-5 place-items-center rounded-full border-2 transition', i < k ? 'border-brand bg-brand-fill text-white' : i === k ? 'border-brand' : 'border-line-strong')}>{i < k && <Check className="size-3" strokeWidth={3} />}</span>
                  {s.label}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-teal px-6 py-14 text-center text-white sm:px-12">
        <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-chocolate/30 blur-3xl" />
        <h2 className="relative text-3xl font-bold sm:text-4xl">One shared operation, viewed four ways.</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-white/80">Dispatcher sees control. Loader sees what to prepare. Driver sees what to do next. Store manager sees what is happening to their order.</p>
        <Link to="/login" className="relative mt-8 inline-block">
          <Button variant="attention" size="lg" className="shadow-lg shadow-black/25">
            Open the demo <ArrowRight className="size-4" />
          </Button>
        </Link>
      </div>
    </section>
  )
}

/** Android download for field crews; hidden inside the installed app itself. */
function AppDownload() {
  if (Capacitor.isNativePlatform()) return null
  return (
    <section id="download" className="px-4 pb-16 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-5 rounded-3xl border border-line bg-surface p-6 sm:flex-row sm:items-center sm:p-8">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand-ink">
          <Smartphone className="size-6" />
        </span>
        <div className="flex-1">
          <h2 className="text-xl font-bold">Get the Android app</h2>
          <p className="mt-1 text-sm text-muted">Drivers and loaders keep working without signal; everything syncs to the shared operation when the connection returns. Android 7.0 or newer.</p>
        </div>
        <a href="/downloads/Kairon.apk" download="Kairon.apk" className="shrink-0">
          <Button size="lg" icon={<Download className="size-4" />}>
            Download APK
          </Button>
        </a>
      </div>
    </section>
  )
}
