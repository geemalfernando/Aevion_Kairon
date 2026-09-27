import L from 'leaflet'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { DEPOT_GEO, outletGeo, type LatLng } from '../lib/geo'
import type { Brand, Depot, Outlet } from '@core/types'
import { cn } from './ui'

/** Leaflet can't read CSS variables in SVG attributes, so resolve theme tokens to hex. */
function resolve(color: string) {
  const m = color.match(/^var\((--[\w-]+)\)$/)
  if (!m || typeof document === 'undefined') return color
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#106c6c'
}

function useThemeKey() {
  const [key, setKey] = useState(() => document.documentElement.dataset.theme)
  useEffect(() => {
    const mo = new MutationObserver(() => setKey(document.documentElement.dataset.theme))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return key
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

type StopState = 'done' | 'current' | 'todo' | 'problem'

const stopIcon = (n: number, state: StopState, color: string) =>
  L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div class="km-stop km-${state}" style="--route:${color}">${state === 'done' ? '✓' : state === 'problem' ? '!' : n}</div>`,
  })

const depotIcon = (name: string) =>
  L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="km-depot" title="${esc(name)} depot"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-6h6v6"/></svg></div>`,
  })

const vehicleIcon = (label: string) =>
  L.divIcon({
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `<div class="km-vehicle"><span class="km-vehicle-ping"></span><span class="km-vehicle-dot"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6H3v12h2"/><path d="M14 9h4l3 4v5h-2"/><circle cx="7.5" cy="18" r="2"/><circle cx="16.5" cy="18" r="2"/></svg></span><span class="km-vehicle-label">${esc(label)}</span></div>`,
  })

/** Brand is encoded twice — colour and shape — so it never depends on colour alone. */
export const BRAND_SHAPE: Record<Brand, string> = { Fresh: 'circle', Style: 'square', Tech: 'diamond' }

const outletIcon = (o: Outlet, state: 'normal' | 'selected' | 'flagged' | 'muted', size: number) =>
  L.divIcon({
    className: '',
    iconSize: [size + 10, size + 10],
    iconAnchor: [(size + 10) / 2, (size + 10) / 2],
    html: `<div class="km-outlet km-${o.brand.toLowerCase()} km-shape-${BRAND_SHAPE[o.brand]} km-o-${state}" style="--s:${size}px"></div>`,
  })

const pinIcon = (label: string) =>
  L.divIcon({
    className: '',
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    html: `<div class="km-pin"><svg viewBox="0 0 36 46" width="36" height="46"><path d="M18 45C18 45 3 28 3 17a15 15 0 0 1 30 0c0 11-15 28-15 28z" fill="var(--brand)" stroke="white" stroke-width="2.5"/><circle cx="18" cy="17" r="6" fill="white"/></svg><span class="km-pin-label">${esc(label)}</span></div>`,
  })

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function FitBounds({ points, maxZoom = 14 }: { points: LatLng[]; maxZoom?: number }) {
  const map = useMap()
  const key = points.map((p) => p.join()).join('|')
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) map.setView(points[0], maxZoom)
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

function FlyTo({ to }: { to?: LatLng }) {
  const map = useMap()
  const lat = to?.[0]
  const lng = to?.[1]
  useEffect(() => {
    if (lat !== undefined && lng !== undefined) map.flyTo([lat, lng], Math.max(map.getZoom(), 12), { duration: 0.8 })
  }, [map, lat, lng])
  return null
}

/** A truck that eases back and forth along a leg, so "in transit" reads at a glance. */
function MovingVehicle({ from, to, label }: { from: LatLng; to: LatLng; label: string }) {
  const ref = useRef<L.Marker>(null)
  const icon = useMemo(() => vehicleIcon(label), [label])
  const [a0, a1] = from
  const [b0, b1] = to
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = ((now - start) / 6000) % 1
      const k = 0.15 + 0.7 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2))
      ref.current?.setLatLng([a0 + (b0 - a0) * k, a1 + (b1 - a1) * k])
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [a0, a1, b0, b1])
  return <Marker ref={ref} position={[(a0 + b0) / 2, (a1 + b1) / 2]} icon={icon} zIndexOffset={1000} />
}

function DepotMarkers({ depots }: { depots: Depot[] }) {
  return (
    <>
      {depots.map((d) => (
        <Marker key={d} position={DEPOT_GEO[d]} icon={depotIcon(d)} zIndexOffset={500}>
          <Tooltip direction="right" offset={[16, 0]} permanent className="km-depot-label">
            {d} depot
          </Tooltip>
        </Marker>
      ))}
    </>
  )
}

/** OpenStreetMap basemap recoloured to the Kairon palette, plus the offline notice. */
function BaseMap({ className, children, fit, maxZoom, interactive = true, extraClass, overlay, label = 'Map' }: { className?: string; children: ReactNode; fit: LatLng[]; maxZoom?: number; interactive?: boolean; extraClass?: string; overlay?: ReactNode; label?: string }) {
  const theme = useThemeKey()
  const [tilesDown, setTilesDown] = useState(false)
  return (
    <div role="region" aria-label={label} className={cn('kairon-map relative isolate overflow-hidden rounded-xl border border-line bg-surface-2', extraClass, className)}>
      <MapContainer
        center={DEPOT_GEO.Peliyagoda}
        zoom={10}
        scrollWheelZoom={false}
        dragging={interactive}
        zoomControl={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        attributionControl
        className="absolute inset-0 size-full"
        key={theme}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          eventHandlers={{ tileerror: () => setTilesDown(true), tileload: () => setTilesDown(false) }}
        />
        <FitBounds points={fit} maxZoom={maxZoom} />
        {children}
      </MapContainer>
      {overlay}
      {tilesDown && (
        <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-full bg-ink px-3 py-1 text-[11px] font-semibold text-bg shadow">Map tiles unavailable offline · locations still shown</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Route map — trips with numbered stops
// ---------------------------------------------------------------------------

export interface MapRoute {
  id: string
  depot: Depot
  stops: { outlet: Outlet; state: StopState }[]
  color?: string
  highlight?: boolean
  vehicle?: { label: string; at: number } // index of the stop the vehicle is heading to
}

export function RouteMap({ routes, outlets = [], className, focus = 'routes', label = 'Route map' }: { routes: MapRoute[]; outlets?: Outlet[]; className?: string; focus?: 'routes' | 'network'; label?: string }) {
  const depots = [...new Set([...routes.map((r) => r.depot), ...(focus === 'network' ? (Object.keys(DEPOT_GEO) as Depot[]) : [])])]
  const routePts = routes.flatMap((r) => [DEPOT_GEO[r.depot], ...r.stops.map((s) => outletGeo(s.outlet))])
  const fit = focus === 'network' || routePts.length === 0 ? [...outlets.map(outletGeo), ...depots.map((d) => DEPOT_GEO[d])] : routePts
  return (
    <BaseMap className={className} fit={fit} label={label} extraClass={routes.filter((r) => r.vehicle).length > 3 ? 'km-many' : undefined}>
      {outlets.map((o) => (
        <CircleMarker key={o.id} center={outletGeo(o)} radius={3.5} pathOptions={{ color: resolve('var(--faint)'), weight: 1, fillColor: resolve('var(--faint)'), fillOpacity: 0.55 }}>
          <Tooltip direction="top">
            <b>{o.id}</b> · {o.name}
          </Tooltip>
        </CircleMarker>
      ))}
      {routes.map((r) => {
        const color = resolve(r.color ?? 'var(--brand)')
        const path: LatLng[] = [DEPOT_GEO[r.depot], ...r.stops.map((s) => outletGeo(s.outlet))]
        const doneUntil = r.stops.filter((s) => s.state === 'done' || s.state === 'problem').length
        const dim = r.highlight === false
        return (
          <Fragment key={r.id}>
            <Polyline positions={path} pathOptions={{ color, weight: 4, opacity: dim ? 0.25 : 0.55, dashArray: '8 8', lineCap: 'round' }} />
            {doneUntil > 0 && <Polyline positions={path.slice(0, doneUntil + 1)} pathOptions={{ color, weight: 5, opacity: dim ? 0.3 : 0.95, lineCap: 'round' }} />}
            {r.stops.map((s, i) => (
              <Marker key={s.outlet.id} position={outletGeo(s.outlet)} icon={stopIcon(i + 1, s.state, color)} opacity={dim ? 0.45 : 1}>
                <Tooltip direction="top" offset={[0, -14]}>
                  <b>
                    {i + 1}. {s.outlet.id}
                  </b>{' '}
                  · {s.outlet.name}
                </Tooltip>
              </Marker>
            ))}
            {r.vehicle && r.vehicle.at >= 0 && r.vehicle.at < path.length - 1 && <MovingVehicle from={path[r.vehicle.at]} to={path[r.vehicle.at + 1]} label={r.vehicle.label} />}
          </Fragment>
        )
      })}
      <DepotMarkers depots={depots} />
    </BaseMap>
  )
}

// ---------------------------------------------------------------------------
// 2. Outlet map — the served network, coloured and shaped by brand
// ---------------------------------------------------------------------------

export function BrandLegend({ flagged, className }: { flagged?: string; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-ink', className)}>
      {(['Fresh', 'Style', 'Tech'] as Brand[]).map((b) => (
        <span key={b} className="inline-flex items-center gap-1.5">
          <span className={`km-outlet km-${b.toLowerCase()} km-shape-${BRAND_SHAPE[b]} km-o-normal`} style={{ ['--s' as string]: '10px' }} />
          {b}
        </span>
      ))}
      {flagged && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full ring-2 ring-attention" /> {flagged}
        </span>
      )}
    </div>
  )
}

export function OutletMap({
  outlets,
  selected,
  onSelect,
  flagged,
  flaggedLabel = 'Needs attention',
  muted,
  className,
  legend = true,
  interactive = true,
  describe,
}: {
  outlets: Outlet[]
  selected?: string
  onSelect?: (id: string) => void
  flagged?: Set<string>
  flaggedLabel?: string
  muted?: Set<string>
  className?: string
  legend?: boolean
  interactive?: boolean
  describe?: (o: Outlet) => string
}) {
  const depots = [...new Set(outlets.map((o) => o.depot))]
  const sel = outlets.find((o) => o.id === selected)
  const fit = [...outlets.map(outletGeo), ...depots.map((d) => DEPOT_GEO[d])]
  return (
    <BaseMap
      className={className}
      fit={fit}
      maxZoom={13}
      interactive={interactive}
      overlay={legend && <BrandLegend flagged={flagged && flagged.size > 0 ? flaggedLabel : undefined} className="pointer-events-none absolute bottom-7 left-3 z-[500] rounded-lg bg-surface/95 px-3 py-2 shadow" />}
    >
      {outlets.map((o) => {
        const state = o.id === selected ? 'selected' : flagged?.has(o.id) ? 'flagged' : muted?.has(o.id) ? 'muted' : 'normal'
        return (
          <Marker
            key={`${o.id}-${state}`}
            position={outletGeo(o)}
            icon={outletIcon(o, state, state === 'selected' ? 20 : 13)}
            zIndexOffset={state === 'selected' ? 900 : state === 'flagged' ? 400 : 0}
            eventHandlers={onSelect ? { click: () => onSelect(o.id) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent={state === 'selected'}>
              <b>{o.id}</b> · {o.name}
              {describe && <span className="block opacity-80">{describe(o)}</span>}
            </Tooltip>
          </Marker>
        )
      })}
      <DepotMarkers depots={depots} />
      <FlyTo to={sel ? outletGeo(sel) : undefined} />
    </BaseMap>
  )
}

// ---------------------------------------------------------------------------
// 3. Location map — one store, its depot, and a vehicle on the way
// ---------------------------------------------------------------------------

export function LocationMap({ outlet, depot, vehicle, className, interactive = false }: { outlet: Outlet; depot?: Depot; vehicle?: string; className?: string; interactive?: boolean }) {
  const here = outletGeo(outlet)
  const from = depot ? DEPOT_GEO[depot] : undefined
  return (
    <BaseMap className={className} fit={from ? [here, from] : [here]} maxZoom={14} interactive={interactive}>
      {from && <Polyline positions={[from, here]} pathOptions={{ color: resolve('var(--brand)'), weight: 4, opacity: 0.6, dashArray: '8 8', lineCap: 'round' }} />}
      {from && vehicle && <MovingVehicle from={from} to={here} label={vehicle} />}
      <Marker position={here} icon={pinIcon(outlet.id)} zIndexOffset={800}>
        <Tooltip direction="top" offset={[0, -40]}>
          <b>{outlet.id}</b> · {outlet.name}
        </Tooltip>
      </Marker>
      {depot && <DepotMarkers depots={[depot]} />}
    </BaseMap>
  )
}

/** Deep link to turn-by-turn directions for a store on OpenStreetMap. */
export function directionsUrl(o: Outlet) {
  const [lat, lng] = outletGeo(o)
  return `https://www.openstreetmap.org/directions?route=%3B${lat}%2C${lng}#map=15/${lat}/${lng}`
}
