/**
 * The public, read-only view of the operation shown on the landing page (no sign-in).
 * Aggregates only: no customer details, managers, order contents or delivery windows.
 * Per-outlet map points are included only while the network is the built-in placeholder one,
 * because the competition datasets must not be published (team policy, see README).
 */
import { seedDemoOps } from './demo'
import { byId, DEFERRAL_LABEL, scheduleOfTrip } from './rules'
import { fmtMin } from './time'
import type { Brand, Depot, District, OpsData, OrderStatus, TripStatus, VehicleType } from './types'

export interface PublicOutletPoint {
  id: string
  name: string
  brand: Brand
  district: District
  depot: Depot
  x: number
  y: number
  latitude?: number
  longitude?: number
  vanOnly: boolean
  mall: boolean
}

export interface PublicSummary {
  deliveryDate: string
  counts: { outlets: number; districts: number; depots: number; vehicles: number; vehiclesAvailable: number; orders: number; planned: number; deferred: number; atRisk: number; delivered: number; trips: number }
  brands: Record<Brand, number>
  districts: { district: District; depot: Depot; total: number; Fresh: number; Style: number; Tech: number }[]
  /** One real trip from today's plan, preferring one on the road. */
  featuredTrip?: { vehicleId: string; vehicleType: VehicleType; depot: Depot; district: District; brand: Brand; departure: string; status: TripStatus; stops: { outletId: string; eta: string; state: 'delivered' | 'arriving' | 'planned' }[] }
  /** The highest-priority order moved to a later run. */
  topDeferral?: { outletId: string; reason: string; priority: number }
  /** Map points; omitted when the network comes from the competition datasets. */
  outlets?: PublicOutletPoint[]
}

const DONE: OrderStatus[] = ['DELIVERED', 'PARTIAL', 'RECEIVED']
const ON_ROAD: TripStatus[] = ['IN_PROGRESS', 'PAUSED']

let placeholderNames: Map<string, string> | undefined

/** True when every outlet is one of the built-in placeholder demo outlets (same id and name). */
export function isPlaceholderNetwork(d: Pick<OpsData, 'outlets'>): boolean {
  if (!d.outlets.length) return true
  placeholderNames ??= new Map(seedDemoOps({ today: '2026-01-01' }).outlets.map((o) => [o.id, o.name]))
  return d.outlets.every((o) => placeholderNames!.get(o.id) === o.name)
}

export function publicSummary(d: OpsData): PublicSummary {
  const today = d.orders.filter((o) => o.deliveryDate === d.deliveryDate)
  const trips = d.trips.filter((t) => t.stops.length && t.status !== 'ABORTED')

  const districts = new Map<District, PublicSummary['districts'][number]>()
  const brands: Record<Brand, number> = { Fresh: 0, Style: 0, Tech: 0 }
  for (const o of d.outlets) {
    const r = districts.get(o.district) ?? { district: o.district, depot: o.depot, total: 0, Fresh: 0, Style: 0, Tech: 0 }
    r.total++
    r[o.brand]++
    brands[o.brand]++
    districts.set(o.district, r)
  }

  let atRisk = 0
  for (const t of trips) atRisk += scheduleOfTrip(d, t).stops.filter((s) => s.late).length

  const featured = trips.find((t) => ON_ROAD.includes(t.status)) ?? [...trips].sort((a, b) => b.stops.length - a.stops.length)[0]
  let featuredTrip: PublicSummary['featuredTrip']
  if (featured) {
    const v = byId(d.vehicles, featured.vehicleId)!
    const schedule = scheduleOfTrip(d, featured)
    let arrivingShown = false
    featuredTrip = {
      vehicleId: v.id,
      vehicleType: v.type,
      depot: v.depot,
      district: featured.district,
      brand: featured.brand,
      departure: fmtMin(featured.departure),
      status: featured.status,
      stops: schedule.stops.map((s) => {
        const done = DONE.includes(byId(d.orders, s.orderId)?.status as OrderStatus)
        const arriving = !done && !arrivingShown && ON_ROAD.includes(featured.status)
        if (arriving) arrivingShown = true
        return { outletId: s.outletId, eta: fmtMin(s.eta), state: done ? 'delivered' : arriving ? 'arriving' : 'planned' }
      }),
    }
  }

  const deferred = today.filter((o) => o.status === 'DEFERRED')
  const top = [...deferred].sort((a, b) => b.priority - a.priority)[0]

  return {
    deliveryDate: d.deliveryDate,
    counts: {
      outlets: d.outlets.length,
      districts: districts.size,
      depots: new Set(d.outlets.map((o) => o.depot)).size,
      vehicles: d.vehicles.length,
      vehiclesAvailable: d.vehicles.filter((v) => v.status === 'AVAILABLE').length,
      orders: today.length,
      planned: today.filter((o) => o.tripId).length,
      deferred: deferred.length,
      atRisk,
      delivered: today.filter((o) => DONE.includes(o.status)).length,
      trips: trips.length,
    },
    brands,
    districts: [...districts.values()].sort((a, b) => b.total - a.total),
    featuredTrip,
    topDeferral: top && { outletId: top.outletId, reason: top.deferral ? DEFERRAL_LABEL[top.deferral.code] : 'Moved to a later run', priority: Math.round(top.priority) },
    outlets: isPlaceholderNetwork(d)
      ? d.outlets.map((o) => ({ id: o.id, name: o.name, brand: o.brand, district: o.district, depot: o.depot, x: o.x, y: o.y, latitude: o.latitude, longitude: o.longitude, vanOnly: o.vanOnly, mall: o.mall }))
      : undefined,
  }
}
