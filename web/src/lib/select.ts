import { byId, DONE, scheduleOfTrip } from '@core/rules'
import type { OpsData, Order, Trip } from '@core/types'

export const outletOf = (d: OpsData, id?: string) => byId(d.outlets, id)
export const orderOf = (d: OpsData, id?: string) => byId(d.orders, id)
export const tripOf = (d: OpsData, id?: string) => byId(d.trips, id)
export const vehicleOf = (d: OpsData, id?: string) => byId(d.vehicles, id)

export { DONE }
export const isDone = (o?: Order) => !!o && DONE.includes(o.status)

export const scheduleOf = (d: OpsData, t: Trip) => scheduleOfTrip(d, t)

const ACTIVE_ORDER: Trip['status'][] = ['IN_PROGRESS', 'PAUSED', 'LOADED', 'LOADING', 'PLANNED']

/** The trip a driver should be looking at right now. */
export function driverTrip(d: OpsData, vehicleId?: string) {
  const mine = d.trips.filter((t) => t.vehicleId === vehicleId && t.stops.length)
  for (const s of ACTIVE_ORDER) {
    const t = mine.filter((x) => x.status === s).sort((a, b) => a.number - b.number)[0]
    if (t) return t
  }
  return mine.filter((t) => t.status === 'COMPLETED').sort((a, b) => b.number - a.number)[0]
}

export function tripProgress(d: OpsData, t: Trip) {
  const done = t.stops.filter((id) => isDone(orderOf(d, id))).length
  return { done, total: t.stops.length }
}

export function storeOrders(d: OpsData, outletId?: string) {
  return d.orders.filter((o) => o.outletId === outletId).sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate) || b.createdAt - a.createdAt)
}

export function auditFor(d: OpsData, entity: string) {
  return d.audit.filter((a) => a.entity === entity).sort((a, b) => a.at - b.at)
}

export const unitsOf = (o: Order) => o.items.reduce((s, i) => s + i.qty, 0)
