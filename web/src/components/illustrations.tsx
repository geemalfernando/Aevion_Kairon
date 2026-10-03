import { Check, CloudOff } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from './ui'

/* Fixed brand palette for illustrations — they sit on their own backgrounds. */
const TEAL = '#106C6C'
const TEAL_L = '#5fd0cf'
const CHOC = '#D66D32'
const STEEL = '#85979A'
const PLAT = '#E5E7EB'
const OCEAN = '#0284C7'
const INK = '#0a1315'

/** Reveals children with a rise animation the first time they scroll into view. */
export function Reveal({ children, delay = 0, className, as: As = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'li' }) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <As ref={ref} className={cn(seen ? 'animate-rise' : 'opacity-0', className)} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </As>
  )
}

/** True once the element is on screen — used to start illustration loops lazily. */
export function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, inView] as const
}

// ---------------------------------------------------------------------------
// The Kairon reefer truck, reused across scenes
// ---------------------------------------------------------------------------

export function Truck({ x = 0, y = 0, scale = 1, moving = true }: { x?: number; y?: number; scale?: number; moving?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className={moving ? 'ill-bob' : undefined}>
        {/* box */}
        <rect x="0" y="0" width="150" height="70" rx="6" fill={PLAT} />
        <rect x="0" y="0" width="150" height="10" rx="5" fill="#d3d8db" />
        <rect x="10" y="18" width="34" height="34" rx="8" fill={TEAL} />
        <path d="M21 25v20M21 36l10-11M25 32l7 13" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" fill="none" />
        <circle cx="34" cy="26" r="3" fill={CHOC} />
        <text x="52" y="41" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="13" letterSpacing="2" fill={INK}>
          KAIRON
        </text>
        <g transform="translate(138 58)" stroke={OCEAN} strokeWidth="1.6" strokeLinecap="round">
          <path d="M0 -5v10M-4.5 -2.5l9 5M-4.5 2.5l9 -5" />
        </g>
        {/* cab */}
        <path d="M152 14h34l20 24v32h-54z" fill={TEAL} />
        <path d="M160 20h22l14 18h-36z" fill="#bfe6e6" opacity="0.9" />
        <rect x="196" y="52" width="10" height="6" rx="2" fill="#ffd9a8" />
        <rect x="-4" y="66" width="214" height="8" rx="3" fill="#33474b" />
      </g>
      {/* wheels */}
      {[34, 116, 176].map((cx) => (
        <g key={cx} transform={`translate(${cx} 76)`}>
          <circle r="13" fill={INK} />
          <circle r="5.5" fill={STEEL} />
          <g className={moving ? 'ill-spin' : undefined}>
            <path d="M0 -9V9M-9 0H9" stroke="#3b5155" strokeWidth="2" />
          </g>
        </g>
      ))}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Wide scene: Colombo skyline, a store, a signal tower going offline and back
// ---------------------------------------------------------------------------

export function DeliveryScene({ className }: { className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (!inView) return
    const t = setInterval(() => setOffline((o) => !o), 3200)
    return () => clearInterval(t)
  }, [inView])
  return (
    <div ref={ref} className={cn('relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#0e2a2c] via-[#0f3336] to-[#123a3c]', className)}>
      <svg viewBox="0 0 1200 420" className="block h-auto w-full" role="img" aria-label="A Kairon reefer truck delivering to a Fresh store while the mobile signal drops and returns">
        <defs>
          <linearGradient id="road" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1d2f33" />
            <stop offset="1" stopColor="#152427" />
          </linearGradient>
        </defs>
        {/* stars / dawn */}
        <circle cx="1040" cy="80" r="34" fill={CHOC} opacity="0.85" />
        <circle cx="1040" cy="80" r="60" fill={CHOC} opacity="0.12" />
        {[[120, 60], [300, 40], [520, 90], [760, 50], [900, 120], [640, 30]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="1.6" fill="#fff" opacity="0.5" />
        ))}
        {/* clouds */}
        <g className="ill-cloud" opacity="0.18">
          <ellipse cx="200" cy="110" rx="70" ry="16" fill="#fff" />
          <ellipse cx="240" cy="98" rx="40" ry="16" fill="#fff" />
        </g>
        <g className="ill-cloud-slow" opacity="0.12">
          <ellipse cx="820" cy="150" rx="90" ry="18" fill="#fff" />
        </g>
        {/* far skyline */}
        <g fill="#1a4447">
          {[0, 70, 120, 200, 260, 340, 400, 470, 560, 610, 700, 780, 850, 930, 1000, 1080, 1140].map((x, i) => (
            <rect key={x} x={x} y={200 - ((i * 37) % 90)} width={50 + ((i * 13) % 30)} height={200} />
          ))}
          {/* Lotus tower */}
          <rect x="468" y="80" width="10" height="170" />
          <ellipse cx="473" cy="90" rx="18" ry="10" />
        </g>
        {/* windows */}
        <g fill={TEAL_L} opacity="0.35">
          {Array.from({ length: 40 }, (_, i) => (
            <rect key={i} x={20 + ((i * 97) % 1150)} y={170 + ((i * 53) % 70)} width="6" height="8" className={i % 3 === 0 ? 'ill-twinkle' : undefined} style={{ animationDelay: `${(i % 7) * 0.4}s` }} />
          ))}
        </g>

        {/* signal tower */}
        <g transform="translate(860 150)">
          <path d="M0 150L20 0L40 150" stroke="#6e8a8d" strokeWidth="4" fill="none" />
          <path d="M8 90h24M5 120h30M13 50h14" stroke="#6e8a8d" strokeWidth="3" />
          <circle cx="20" cy="0" r="6" fill={offline ? STEEL : TEAL_L} />
          {[22, 38, 54].map((r, i) => (
            <path
              key={r}
              d={`M${20 - r} ${-r * 0.5} A ${r} ${r} 0 0 1 ${20 + r} ${-r * 0.5}`}
              stroke={TEAL_L}
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              className="transition-opacity duration-500"
              style={{ opacity: offline ? 0 : 1, transitionDelay: `${i * 120}ms` }}
            />
          ))}
          {offline && (
            <g transform="translate(34 -40)">
<g className="ill-pop">
              <circle r="15" fill={CHOC} />
              <path d="M-6 -6l12 12M6 -6l-12 12" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
            </g>
</g>
          )}
        </g>

        {/* store */}
        <g transform="translate(40 206)">
          <rect x="0" y="30" width="200" height="118" fill="#f4f5f7" />
          <path d="M-8 30h216l-12 -30h-192z" fill={TEAL} />
          {Array.from({ length: 8 }, (_, i) => (
            <path key={i} d={`M${-8 + i * 27} 30 q 13.5 18 27 0`} fill={i % 2 ? '#fff' : TEAL} />
          ))}
          <text x="100" y="20" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="15" letterSpacing="4" fill="#fff">
            FRESH
          </text>
          <rect x="18" y="62" width="70" height="56" rx="4" fill="#bfe6e6" />
          <rect x="110" y="62" width="70" height="86" rx="3" fill="#2b4246" />
          <circle cx="170" cy="108" r="3" fill={CHOC} />
          {/* crates by the door */}
          <rect x="18" y="126" width="30" height="22" fill={CHOC} />
          <rect x="52" y="126" width="30" height="22" fill="#b85a26" />
        </g>

        {/* road */}
        <rect x="0" y="352" width="1200" height="68" fill="url(#road)" />
        <path d="M0 386H1200" stroke="#e5e7eb" strokeWidth="4" strokeDasharray="36 28" className="ill-road" opacity="0.5" />

        {/* truck drives in, stops at the store, drives on */}
        <g className="ill-drive">
          <Truck y={272} moving />
        </g>

        {/* phone bubble riding above the truck */}
        <g className="ill-drive">
          <g transform="translate(90 170)">
            <rect x="0" y="0" width="150" height="58" rx="14" fill={offline ? INK : '#fff'} className="transition-colors duration-500" />
            <path d="M60 58l10 12l10 -12z" fill={offline ? INK : '#fff'} className="transition-colors duration-500" />
            <text x="16" y="25" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="13" fill={offline ? '#fff' : INK}>
              {offline ? 'Offline · saved' : 'OUT005 delivered'}
            </text>
            <text x="16" y="44" fontFamily="Inter, sans-serif" fontSize="11" fill={offline ? '#9aabae' : '#56676a'}>
              {offline ? '3 updates waiting' : '✓ Synced 06:12'}
            </text>
          </g>
        </g>
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Four story vignettes: Order → Plan → Load → Deliver
// ---------------------------------------------------------------------------

function Vignette({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 320 220" className="block h-auto w-full" role="img" aria-label={label}>
      <rect width="320" height="220" rx="20" fill="#0f2427" />
      {children}
    </svg>
  )
}

export function OrderVignette() {
  return (
    <Vignette label="A store manager places an order on a tablet">
      <rect x="40" y="150" width="240" height="14" rx="4" fill="#1d3a3d" />
      <g transform="translate(96 36)">
        <rect width="128" height="104" rx="12" fill={PLAT} />
        <rect x="8" y="8" width="112" height="88" rx="6" fill="#fff" />
        <text x="18" y="28" fontFamily="Space Grotesk" fontWeight="700" fontSize="11" fill={INK}>
          NEW ORDER
        </text>
        {['Milk', 'Frozen', 'Produce'].map((n, i) => (
          <g key={n} transform={`translate(18 ${40 + i * 16})`}>
            <text fontFamily="Inter" fontSize="9" fill="#56676a" y="8">
              {n}
            </text>
            <rect x="56" y="0" width="38" height="10" rx="3" fill="#eef0f2" />
            <rect x="56" y="0" width={[30, 14, 22][i]} height="10" rx="3" fill={TEAL} className="ill-grow" style={{ animationDelay: `${i * 0.3}s` }} />
          </g>
        ))}
        <rect x="18" y="82" width="92" height="10" rx="3" fill={CHOC} className="ill-pulse" />
      </g>
      {/* crates */}
      <g transform="translate(46 118)">
        <rect width="36" height="32" fill={CHOC} />
        <rect x="4" y="-26" width="28" height="26" fill="#b85a26" className="ill-drop" />
      </g>
      <g transform="translate(236 104)">
<g className="ill-float">
        <circle r="18" fill={TEAL} />
        <Check x={-9} y={-9} width={18} height={18} color="#fff" strokeWidth={3} />
      </g>
</g>
    </Vignette>
  )
}

export function PlanVignette() {
  return (
    <Vignette label="The dispatcher allocates orders to vehicles on a planning board">
      <g transform="translate(34 28)">
        <rect width="252" height="150" rx="10" fill="#e9eced" />
        <rect x="8" y="8" width="236" height="134" rx="6" fill="#fff" />
        {[0, 1, 2].map((c) => (
          <g key={c} transform={`translate(${16 + c * 78} 18)`}>
            <rect width="68" height="114" rx="6" fill="#eef0f2" />
            <rect x="6" y="6" width="30" height="5" rx="2" fill={STEEL} />
          </g>
        ))}
        {/* cards on the board */}
        <rect x="22" y="42" width="56" height="18" rx="4" fill="#fff" stroke="#d6dcdd" />
        <rect x="22" y="66" width="56" height="18" rx="4" fill="#fff" stroke="#d6dcdd" />
        <rect x="100" y="42" width="56" height="30" rx="4" fill={TEAL} opacity="0.15" stroke={TEAL} />
        <rect x="178" y="42" width="56" height="18" rx="4" fill="#fff" stroke={CHOC} />
        {/* the card being dragged onto the vehicle column */}
        <g className="ill-drag">
          <rect x="22" y="90" width="56" height="18" rx="4" fill="#fff" stroke={TEAL} strokeWidth="1.5" />
          <rect x="28" y="96" width="24" height="5" rx="2" fill={TEAL} />
        </g>
        <g className="ill-pop-late">
          <circle cx="156" cy="100" r="10" fill="#1f8a4c" />
          <path d="M151 100l4 4l7 -8" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
      </g>
      <rect x="140" y="178" width="40" height="18" fill="#1d3a3d" />
      <rect x="110" y="194" width="100" height="8" rx="4" fill="#1d3a3d" />
    </Vignette>
  )
}

export function LoadVignette() {
  return (
    <Vignette label="A loader stacks crates into the truck in reverse stop order">
      {/* bay */}
      <rect x="0" y="176" width="320" height="44" fill="#15302f" />
      <g transform="translate(40 58)">
        <rect width="150" height="118" rx="6" fill={PLAT} />
        <rect x="8" y="8" width="134" height="102" rx="4" fill="#23393c" />
        {/* stacked crates, last stop first */}
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} className="ill-stack" style={{ animationDelay: `${i * 0.45}s` }}>
            <rect x={14 + (i % 3) * 42} y={78 - Math.floor(i / 3) * 30} width="38" height="26" fill={i === 4 ? CHOC : TEAL} />
            <text x={33 + (i % 3) * 42} y={96 - Math.floor(i / 3) * 30} textAnchor="middle" fontFamily="JetBrains Mono" fontWeight="700" fontSize="12" fill="#fff">
              {5 - i}
            </text>
          </g>
        ))}
      </g>
      {/* tablet with sequence */}
      <g transform="translate(212 48)">
<g className="ill-float">
        <rect width="80" height="110" rx="10" fill={PLAT} />
        <rect x="6" y="6" width="68" height="98" rx="6" fill="#fff" />
        <text x="12" y="22" fontFamily="Space Grotesk" fontWeight="700" fontSize="8" fill={TEAL}>
          LOAD FIRST
        </text>
        {[5, 4, 3, 2, 1].map((n, i) => (
          <g key={n} transform={`translate(12 ${30 + i * 14})`}>
            <rect width="10" height="10" rx="3" fill={i < 2 ? '#1f8a4c' : '#eef0f2'} />
            <rect x="14" y="3" width="36" height="4" rx="2" fill="#cfd5d7" />
          </g>
        ))}
      </g>
</g>
    </Vignette>
  )
}

export function DeliverVignette() {
  return (
    <Vignette label="A driver captures proof of delivery on a phone, even offline">
      {/* route map behind */}
      <path d="M20 190 C 80 120, 140 200, 190 130 S 280 60, 300 40" stroke={TEAL_L} strokeOpacity="0.4" strokeWidth="3" fill="none" strokeDasharray="6 7" className="ill-road" />
      {[[60, 150], [190, 130], [300, 40]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="6" fill={i === 0 ? TEAL_L : '#1d3a3d'} stroke={TEAL_L} strokeWidth="2" />
      ))}
      {/* phone */}
      <g transform="translate(112 22)">
        <rect width="96" height="180" rx="16" fill={INK} stroke="#2d464c" strokeWidth="2" />
        <rect x="6" y="8" width="84" height="164" rx="11" fill="#fff" />
        <rect x="6" y="8" width="84" height="18" rx="11" fill={INK} />
        <text x="48" y="21" textAnchor="middle" fontFamily="Inter" fontWeight="700" fontSize="7" fill="#fff">
          OFFLINE · SAVED
        </text>
        <text x="14" y="44" fontFamily="JetBrains Mono" fontWeight="700" fontSize="12" fill={INK}>
          OUT005
        </text>
        <text x="14" y="56" fontFamily="Inter" fontSize="7" fill="#56676a">
          Delivered in full
        </text>
        {/* signature being drawn */}
        <rect x="12" y="66" width="72" height="44" rx="5" fill="#eef0f2" />
        <path d="M18 98 C 26 70, 34 110, 44 86 S 60 76, 66 94 S 76 90, 80 82" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" className="ill-sign" />
        <rect x="12" y="120" width="72" height="16" rx="5" fill={TEAL} />
        <text x="48" y="131" textAnchor="middle" fontFamily="Inter" fontWeight="700" fontSize="7" fill="#fff">
          Complete delivery
        </text>
        <g transform="translate(48 154)">
<g className="ill-pop-late">
          <circle r="10" fill="#1f8a4c" />
          <path d="M-4 0l3 3l6 -6" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </g>
</g>
      </g>
      <g transform="translate(248 150)">
<g className="ill-bounce">
        <path d="M0 0c-10 -14 -16 -20 -16 -28a16 16 0 0 1 32 0c0 8 -6 14 -16 28z" fill={CHOC} />
        <circle cy="-28" r="6" fill="#fff" />
      </g>
</g>
    </Vignette>
  )
}

// ---------------------------------------------------------------------------
// Device mockups with miniature, real-looking screens
// ---------------------------------------------------------------------------

export function LaptopMock({ className }: { className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <div className="rounded-t-2xl border-[10px] border-b-0 border-[#1b2a2d] bg-[#101c1f] p-0 shadow-2xl">
        <div className="flex h-[250px] overflow-hidden rounded-t-md bg-[#0a1315] text-[8px] text-white sm:h-[300px]">
          <div className="w-24 shrink-0 space-y-1.5 border-r border-white/10 p-2.5">
            <div className="mb-3 flex items-center gap-1 font-display text-[9px] font-bold tracking-widest">
              <span className="size-3 rounded bg-teal" /> KAIRON
            </div>
            {['Overview', 'Orders', 'Planning', 'Routes', 'Live', 'Issues'].map((n, i) => (
              <div key={n} className={cn('rounded px-1.5 py-1', i === 2 ? 'bg-teal/30 text-[#6fcaca]' : 'text-white/50')}>
                {n}
              </div>
            ))}
          </div>
          <div className="flex-1 p-3">
            <div className="mb-2 font-display text-[12px] font-semibold">Planning</div>
            <div className="mb-2 grid grid-cols-4 gap-1.5">
              {[['Served', '162'], ['Deferred', '22'], ['Vehicles', '53'], ['Util.', '92%']].map(([l, v], i) => (
                <div key={l} className="rounded bg-white/5 p-1.5">
                  <div className="text-white/40">{l}</div>
                  <div className={cn('font-display text-[11px] font-semibold', i === 1 && 'text-[#f2a275]')}>{v}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_2fr_1fr] gap-1.5">
              <div className="space-y-1 rounded bg-white/5 p-1.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded border border-white/10 bg-[#101c1f] p-1 font-mono">
                    OUT0{14 + i * 9}
                  </div>
                ))}
              </div>
              <div className="space-y-1 rounded bg-white/5 p-1.5">
                {['VEH002', 'VEH007'].map((v, i) => (
                  <div key={v} className="rounded border border-white/10 bg-[#101c1f] p-1.5">
                    <div className="font-mono font-semibold">{v}</div>
                    <div className="mt-1 h-1 rounded bg-white/10">
                      <div className="h-full rounded bg-teal ill-grow" style={{ width: i ? '55%' : '82%' }} />
                    </div>
                  </div>
                ))}
                <div className="ill-drag-mini rounded border border-[#5fd0cf] bg-[#101c1f] p-1 font-mono">OUT041 → VEH002</div>
              </div>
              <div className="space-y-1 rounded bg-[#e57f45]/10 p-1.5">
                <div className="rounded border border-[#e57f45]/40 p-1 font-mono text-[#f2a275]">OUT043</div>
                <div className="text-[7px] text-[#f2a275]">Reefer capacity</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto h-3 w-[112%] -translate-x-[5.4%] rounded-b-xl bg-gradient-to-b from-[#2b3c40] to-[#1b2a2d]" />
    </div>
  )
}

export function TabletMock({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-[22px] border-[9px] border-[#1b2a2d] bg-white shadow-2xl', className)}>
      <div className="h-[230px] w-[170px] overflow-hidden rounded-xl bg-white p-2.5 text-[8px] text-[#0f1b1d]">
        <div className="font-mono text-[11px] font-bold">VEH002 · Trip 1</div>
        <div className="mb-2 text-[#56676a]">Departure 03:45</div>
        <div className="mb-1 rounded bg-[#e2efef] px-1.5 py-0.5 text-[7px] font-bold tracking-widest text-teal">LOAD FIRST</div>
        {[5, 4, 3, 2, 1].map((n, i) => (
          <div key={n} className="flex items-center gap-1.5 border-b border-[#e5e7eb] py-1.5">
            <span className={cn('grid size-4 place-items-center rounded text-[7px] font-bold text-white', i < 2 ? 'bg-[#1f8a4c]' : i === 2 ? 'bg-teal' : 'bg-[#cfd5d7]')}>{i < 2 ? '✓' : n}</span>
            <span className="font-mono font-semibold">OUT0{[56, 47, 32, 18, 4][i]}</span>
            {i === 2 && <span className="ml-auto rounded bg-[#fbece3] px-1 text-[6px] font-bold text-[#a44b19]">1 missing</span>}
          </div>
        ))}
        <div className="mt-2 rounded bg-teal py-1 text-center text-[8px] font-semibold text-white">Complete loading (2/5)</div>
      </div>
    </div>
  )
}

export function PhoneMock({ className, offline = true }: { className?: string; offline?: boolean }) {
  return (
    <div className={cn('rounded-[30px] border-[7px] border-[#1b2a2d] bg-[#0a1315] shadow-2xl', className)}>
      <div className="relative h-[270px] w-[132px] overflow-hidden rounded-[22px] bg-[#0f1b1d] text-[8px] text-white">
        <div className="mx-auto mt-1.5 h-3 w-12 rounded-full bg-black" />
        <div className={cn('mx-2 mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-[7px] font-semibold', offline ? 'bg-white text-[#0a1315]' : 'bg-[#1f8a4c]')}>
          {offline ? <CloudOff className="size-2.5" /> : <Check className="size-2.5" />} {offline ? 'Offline · 3 waiting' : 'Synced'}
        </div>
        <div className="px-2.5 pt-2">
          <div className="font-display text-[14px] font-bold">3 / 5</div>
          <div className="mt-1 h-1 rounded bg-white/10">
            <div className="h-full w-3/5 rounded bg-[#2a9a9a]" />
          </div>
          <div className="mt-2 rounded-lg bg-white/5 p-2">
            <div className="text-[6px] font-bold tracking-widest text-[#6fcaca]">NEXT STOP</div>
            <div className="font-mono text-[12px] font-bold">OUT005</div>
            <div className="text-white/50">ETA 06:12 · 05:00–07:30</div>
            <div className="mt-1.5 rounded bg-[#2a9a9a] py-1 text-center font-semibold">I've arrived</div>
          </div>
          {['OUT004', 'OUT018', 'OUT005', 'OUT047'].map((o, i) => (
            <div key={o} className="flex items-center gap-1.5 border-b border-white/5 py-1">
              <span className={cn('grid size-3 place-items-center rounded-full text-[6px]', i < 2 ? 'bg-[#34c27a]' : i === 2 ? 'border border-[#2ea4e0]' : 'border border-white/20')}>{i < 2 ? '✓' : ''}</span>
              <span className="font-mono">{o}</span>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-around border-t border-white/10 bg-[#101c1f] py-1.5 text-[6px] text-white/50">
          {['Today', 'Route', 'Issues', 'Sync'].map((t, i) => (
            <span key={t} className={i === 1 ? 'text-[#6fcaca]' : ''}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
