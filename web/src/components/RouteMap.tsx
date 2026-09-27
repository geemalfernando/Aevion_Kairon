import { DEPOT_POS as DEPOTS } from '@core/reference'
import type { Depot, Outlet } from '@core/types'
import { cn } from './ui'

export interface MapRoute {
  id: string
  depot: Depot
  stops: { outlet: Outlet; state: 'done' | 'current' | 'todo' | 'problem' }[]
  color?: string
  highlight?: boolean
  vehicle?: { label: string; at: number } // index of stop the vehicle is heading to
}

/** Stylised network map: depot, outlets and routes — no external tiles, works offline. */
export function RouteMap({ routes, outlets = [], className, focus = 'routes', label = 'Route map' }: { routes: MapRoute[]; outlets?: Outlet[]; className?: string; focus?: 'routes' | 'network'; label?: string }) {
  const pts = routes.flatMap((r) => [DEPOTS[r.depot], ...r.stops.map((s) => s.outlet)])
  const all = focus === 'network' || pts.length === 0 ? [...outlets, ...Object.values(DEPOTS)] : pts
  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.y)
  const pad = 4
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const w = Math.max(12, Math.max(...xs) - minX + pad)
  const h = Math.max(10, Math.max(...ys) - minY + pad)
  const s = Math.max(w, h) / 100 // scale marks to the zoom level
  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-line bg-surface-2', className)}>
      <svg viewBox={`${minX} ${minY} ${w} ${h}`} className="size-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
        <defs>
          <pattern id="grid" width={5 * s} height={5 * s} patternUnits="userSpaceOnUse">
            <path d={`M ${5 * s} 0 L 0 0 0 ${5 * s}`} fill="none" stroke="var(--line)" strokeWidth={0.15 * s} />
          </pattern>
        </defs>
        <rect x={minX} y={minY} width={w} height={h} fill="url(#grid)" />
        {outlets.map((o) => (
          <circle key={o.id} cx={o.x} cy={o.y} r={0.55 * s} fill="var(--faint)" opacity={0.45} />
        ))}
        {routes.map((r) => {
          const depot = DEPOTS[r.depot]
          const path = [depot, ...r.stops.map((x) => x.outlet)]
          const color = r.color ?? 'var(--brand)'
          const doneUntil = r.stops.filter((x) => x.state === 'done').length
          return (
            <g key={r.id} opacity={r.highlight === false ? 0.35 : 1}>
              <polyline points={path.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={0.5 * s} strokeDasharray={`${1.4 * s} ${0.9 * s}`} strokeLinecap="round" opacity={0.5} />
              <polyline points={path.slice(0, doneUntil + 1).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={0.7 * s} strokeLinecap="round" />
              {r.stops.map((st, i) => (
                <g key={st.outlet.id}>
                  <circle
                    cx={st.outlet.x}
                    cy={st.outlet.y}
                    r={1.7 * s}
                    fill={st.state === 'done' ? color : st.state === 'problem' ? 'var(--attention)' : 'var(--surface)'}
                    stroke={st.state === 'current' ? 'var(--info)' : st.state === 'problem' ? 'var(--attention)' : color}
                    strokeWidth={(st.state === 'current' ? 0.7 : 0.45) * s}
                  />
                  <text x={st.outlet.x} y={st.outlet.y + 0.62 * s} textAnchor="middle" fontSize={1.7 * s} fontWeight={700} fill={st.state === 'done' || st.state === 'problem' ? 'white' : 'var(--ink)'} fontFamily="var(--font-mono)">
                    {i + 1}
                  </text>
                </g>
              ))}
              {r.vehicle && (() => {
                const from = path[Math.max(0, r.vehicle.at)]
                const to = path[Math.min(path.length - 1, r.vehicle.at + 1)]
                const vx = (from.x + to.x) / 2
                const vy = (from.y + to.y) / 2
                return (
                  <g>
                    <circle cx={vx} cy={vy} r={2.6 * s} fill="var(--info)" opacity={0.18}>
                      <animate attributeName="r" values={`${1.6 * s};${3.2 * s};${1.6 * s}`} dur="2s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={vx} cy={vy} r={1.2 * s} fill="var(--info)" stroke="white" strokeWidth={0.35 * s} />
                  </g>
                )
              })()}
            </g>
          )
        })}
        {[...new Set([...routes.map((r) => r.depot), ...(focus === 'network' ? (Object.keys(DEPOTS) as Depot[]) : [])])].map((k) => {
          const d = DEPOTS[k]
          return (
            <g key={k}>
              <rect x={d.x - 1.6 * s} y={d.y - 1.6 * s} width={3.2 * s} height={3.2 * s} rx={0.6 * s} fill="var(--muted)" />
              <text x={d.x + 2.4 * s} y={d.y + 0.6 * s} fontSize={1.8 * s} fontWeight={600} fill="var(--muted)">
                {k}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
