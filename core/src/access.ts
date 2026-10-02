import type { Notification, OpsData, User } from './types'
import { scheduleOfTrip } from './rules'

export function notificationDepot(d: OpsData, n: Notification) {
  if (n.depot) return n.depot
  if (n.outletId) return d.outlets.find((o) => o.id === n.outletId)?.depot
  if (n.vehicleId) return d.vehicles.find((v) => v.id === n.vehicleId)?.depot
  const tripId = n.link?.match(/^\/loader\/load\/([^/]+)$/)?.[1]
  const vehicleId = d.trips.find((t) => t.id === tripId)?.vehicleId
  return d.vehicles.find((v) => v.id === vehicleId)?.depot
}

export function notificationVisible(d: OpsData, n: Notification, u: User) {
  return notificationDepot(d, n) === u.depot && n.to.includes(u.role)
    && (!n.outletId || u.role !== 'STORE_MANAGER' || n.outletId === u.assignedOutlet)
    && (!n.vehicleId || u.role !== 'DRIVER' || n.vehicleId === u.assignedVehicle)
    && (u.role !== 'DRIVER' || n.vehicleId === u.assignedVehicle)
    && (u.role !== 'STORE_MANAGER' || n.outletId === u.assignedOutlet)
}

/** Only authorized records leave the API, including command/event responses and exports. */
export function projectState(d: OpsData, u: User & { id?: string }): OpsData {
  const vehicles = d.vehicles.filter((v) => v.depot === u.depot && (u.role !== 'DRIVER' || v.id === u.assignedVehicle))
  const vehicleIds = new Set(vehicles.map((v) => v.id))
  let trips = d.trips.filter((t) => vehicleIds.has(t.vehicleId))
  const historical = new Set(trips.flatMap((t) => (t.changes ?? []).flatMap((c) => c.removed.map((r) => r.orderId))))
  const outlets = d.outlets.filter((o) => o.depot === u.depot && (u.role !== 'STORE_MANAGER' || o.id === u.assignedOutlet))
  const outletIds = new Set(outlets.map((o) => o.id))
  let orders = d.orders.filter((o) => outletIds.has(o.outletId) && (u.role !== 'DRIVER' || trips.some((t) => t.id === o.tripId) || historical.has(o.id)))
  if (u.role === 'STORE_MANAGER') {
    orders = orders.map((order) => {
      const trip = d.trips.find((t) => t.id === order.tripId)
      const stop = trip ? scheduleOfTrip(d, trip).stops.find((s) => s.orderId === order.id) : undefined
      return { ...order, projectedEta: stop ? { minutes: stop.eta, window: stop.window } : undefined }
    })
    // ETA/route calculations need preceding stops, but other stores' orders must remain private.
    // Stores get their own stops; the server's persisted ETA/plan messages remain authoritative.
    const ids = new Set(orders.map((o) => o.id))
    trips = trips.filter((t) => t.stops.some((id) => ids.has(id))).map((t) => ({ ...t, stops: t.stops.filter((id) => ids.has(id)), changes: undefined, pendingChange: undefined }))
  }
  if (u.role === 'DRIVER') {
    const ids = new Set(orders.map((o) => o.outletId))
    outlets.splice(0, outlets.length, ...outlets.filter((o) => ids.has(o.id)))
  }
  const orderIds = new Set(orders.map((o) => o.id))
  const tripIds = new Set(trips.map((t) => t.id))
  const entities = new Set(u.role === 'STORE_MANAGER' ? [...orderIds, ...outlets.map((o) => o.id)] : [...orderIds, ...tripIds, ...vehicleIds, ...outlets.map((o) => o.id)])
  if (u.role === 'STORE_MANAGER') orders = orders.map((o) => ({ ...o, notes: undefined, priorityWhy: undefined, lock: undefined, deferral: o.deferral ? { ...o.deferral, internalNote: undefined } : undefined }))
  const notifications = d.notifications.filter((n) => notificationVisible(d, n, u)).map((n) => ({ ...n, readBy: n.readByUserIds ? (n.readByUserIds.includes(u.id ?? u.email) ? [u.role] : []) : n.readBy, readByUserIds: undefined }))
  return structuredClone({ ...d, vehicles: u.role === 'STORE_MANAGER' ? vehicles.filter((v) => trips.some((t) => t.vehicleId === v.id)).map((v) => ({ ...v, driver: '', fuelUsedL: 0, fuelQuotaL: 0 })) : vehicles,
    ordersClosed: d.ordersClosedByDepot?.[u.depot] ?? d.ordersClosed, plan: d.planByDepot?.[u.depot] ?? d.plan,
    ordersClosedByDepot: undefined, planByDepot: undefined, analysisByDepot: undefined,
    outlets, orders, trips, notifications,
    issues: d.issues.filter((i) => (i.orderIds?.length ? i.orderIds.every((id) => orderIds.has(id)) : u.role === 'STORE_MANAGER' ? false : i.vehicleId ? vehicleIds.has(i.vehicleId) : i.tripId ? tripIds.has(i.tripId) : false)),
    audit: d.audit.filter((a) => entities.has(a.entity) && (!a.depot || a.depot === u.depot) && (u.role !== 'STORE_MANAGER' || a.actor === 'STORE_MANAGER' || a.actor === 'DRIVER')),
    syncLog: d.syncLog.filter((s) => u.role === 'DISPATCHER' ? s.depot === u.depot || !!s.vehicleId && vehicleIds.has(s.vehicleId) : s.email === u.email),
    presence: Object.fromEntries(Object.entries(d.presence).filter(([key]) => key === u.email || key.startsWith('vehicle:') && vehicleIds.has(key.slice(8)))),
    predictions: u.role === 'STORE_MANAGER' ? { service: {}, demand: [] } : { ...d.predictions, service: Object.fromEntries(Object.entries(d.predictions.service).filter(([id]) => orderIds.has(id))), demand: u.role === 'DISPATCHER' ? d.predictions.demand.filter((r) => r.depot === u.depot) : [] },
    analysis: u.role === 'DISPATCHER' ? d.analysisByDepot?.[u.depot] : undefined,
  })
}

/** A depot's planner cannot mutate the other depot's operation. */
export function mergeDepot(full: OpsData, before: OpsData, next: OpsData, depot: User['depot']) {
  for (const key of ['outlets', 'vehicles', 'orders', 'trips', 'issues', 'notifications', 'audit', 'syncLog'] as const) {
    const owned = new Set(before[key].map((x) => x.id))
    ;(full[key] as { id: string }[]) = [...full[key].filter((x) => !owned.has(x.id)), ...next[key]]
  }
  full.plan = next.plan
  full.ordersClosed = next.ordersClosed
  full.ordersClosedByDepot ??= { Peliyagoda: before.ordersClosed, Kandy: before.ordersClosed }
  full.planByDepot ??= { Peliyagoda: before.plan, Kandy: before.plan }
  full.ordersClosedByDepot[depot] = next.ordersClosed
  full.planByDepot[depot] = next.plan
  full.analysisByDepot ??= {}
  full.analysisByDepot[depot] = next.analysis
  full.predictions.service = { ...full.predictions.service, ...next.predictions.service }
  full.predictions.demand = [...full.predictions.demand.filter((r) => r.depot !== depot), ...next.predictions.demand]
}
