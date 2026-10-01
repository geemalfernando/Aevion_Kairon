import { byId, isDoneStatus } from '@core/rules'
import type { OpsData } from '@core/types'

/** What changed on a driver's route while their phone was offline, worked out on reconnect. */
export interface RouteConflict {
  tripId: string
  vehicleId: string
  /** Operation time the device came back online. */
  at: number
  offlineFrom: number
  /** Stops taken off this route, and where they went. */
  removed: { orderId: string; outletId: string; to?: string; reason: string }[]
  /** Stops added to this route. */
  added: string[]
  /** Deliveries recorded offline that collided with a dispatcher change — the driver's record was kept. */
  collided: string[]
  /** Deliveries recorded offline and synced without trouble. */
  kept: string[]
  /** Route-change ids to acknowledge. */
  changeIds: string[]
  ackAt?: number
}

export function detectConflict(snapshot: OpsData, latest: OpsData, vehicleId: string | undefined, offlineFrom: number, deliveredOffline: string[], collided: string[], at: number): RouteConflict | null {
  const before = snapshot.trips.find((t) => t.vehicleId === vehicleId && ['LOADED', 'IN_PROGRESS', 'PAUSED'].includes(t.status))
  const now = before && byId(latest.trips, before.id)
  if (!before || !now) return null
  const pending = (now.changes ?? []).filter((c) => c.phase === 'route' && !c.ackAt)
  const removed = before.stops
    .filter((id) => !now.stops.includes(id) && !deliveredOffline.includes(id))
    .map((orderId) => {
      const o = byId(latest.orders, orderId)
      const why = pending.flatMap((c) => c.removed).find((r) => r.orderId === orderId)
      const to = why?.to ?? byId(latest.trips, o?.tripId)?.vehicleId
      return { orderId, outletId: o?.outletId ?? orderId, to: to !== vehicleId ? to : undefined, reason: why?.reason ?? (o?.status === 'DEFERRED' ? 'Moved to the next run' : 'Changed by the dispatcher') }
    })
  const added = now.stops.filter((id) => !before.stops.includes(id) && !isDoneStatus(byId(latest.orders, id)?.status))
  if (!removed.length && !added.length && !collided.length && !pending.length) return null
  return { tripId: now.id, vehicleId: now.vehicleId, at, offlineFrom, removed, added, collided, kept: deliveredOffline.filter((id) => !collided.includes(id)), changeIds: pending.map((c) => c.id) }
}
