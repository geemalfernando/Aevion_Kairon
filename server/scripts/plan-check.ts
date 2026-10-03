/** Run the planner on a copy of the saved operation without writing changes. */
import { commands } from '@core/ops'
import { loadOps } from '../src/db'
import { byId, scheduleOfTrip, vehicleDay } from '@core/rules'

const d = await loadOps()
if (!d) throw new Error('Import operation data first')
const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})
console.log('delivery date', d.deliveryDate)
console.log('vehicles', count(d.vehicles, (v) => `${v.depot} ${v.type} ${v.status}${v.reserve ? ' reserve' : ''}`))
console.log('outlets', count(d.outlets, (o) => o.brand), 'districts', new Set(d.outlets.map((o) => o.district)).size)
console.log('malls', count(d.outlets.filter((o) => o.mall), (o) => o.brand), 'van_only', count(d.outlets.filter((o) => o.vanOnly), (o) => o.brand))
console.log('orders', d.orders.length, count(d.orders, (o) => `${o.brand} ${o.temp}`))
console.log('two orders same outlet', Object.values(count(d.orders, (o) => o.outletId)).filter((n) => n > 1).length)
const t0 = performance.now()
commands.closeOrders(d)
const r = commands.generatePlan(d)
console.log('plan', r, `${Math.round(performance.now() - t0)} ms`)
console.log('analysis', JSON.stringify(d.analysis, null, 1))
console.log('deferred', count(d.orders.filter((o) => o.status === 'DEFERRED'), (o) => `${o.brand} ${o.temp} ${byId(d.outlets, o.outletId)!.district}${byId(d.outlets, o.outletId)!.vanOnly ? ' van-only' : ''} · ${o.deferral!.reason}`))
console.log('trips/vehicle', count(Object.values(count(d.trips, (t) => t.vehicleId)), (n) => `${n}`))
console.log('two fresh trips', Object.values(count(d.trips.filter((t) => t.brand === 'Fresh'), (t) => t.vehicleId)).filter((n) => n > 1).length)
for (const t of d.trips.filter((t) => t.vehicleId === 'VEH002' || t.vehicleId === 'VEH001' || t.vehicleId === 'VEH003')) {
  const s = scheduleOfTrip(d, t)
  console.log(t.id, t.number, t.brand, t.district, 'dep', t.departure, 'min', s.minutes, 'finish', s.finish, 'stops', t.stops.map((id) => byId(d.orders, id)!.outletId).join(','), 'late', s.stops.filter((x) => x.late).length)
}
// Verify every planned trip against the rules independently.
let bad = 0
for (const v of d.vehicles) {
  const day = vehicleDay(v, d.trips, d)
  if (!day.trips.length) continue
  const problems: string[] = []
  if (day.trips.length > 2) problems.push('trips>2')
  if (day.freshMin > 270) problems.push(`fresh ${day.freshMin}`)
  if (day.styleTechMin > 480) problems.push(`st ${day.styleTechMin}`)
  for (const { trip, sched } of day.trips) {
    const os = trip.stops.map((id) => byId(d.orders, id)!)
    const outs = os.map((o) => byId(d.outlets, o.outletId)!)
    if (new Set(os.map((o) => o.brand)).size > 1 || new Set(outs.map((o) => o.district)).size > 1) problems.push('mixed')
    if (os.some((o) => o.temp === 'CHILLED') && v.temp !== 'reefer') problems.push('chilled on ambient')
    if (outs.some((o) => o.vanOnly) && v.kind !== 'van') problems.push('van-only on truck')
    if (outs.some((o) => o.depot !== v.depot)) problems.push('depot')
    if (sched.weightKg > v.capacityKg || sched.volumeM3 > v.capacityM3) problems.push('capacity')
    if (sched.stops.some((s) => s.late)) problems.push('late')
  }
  if (v.fuelUsedL + day.fuelL > v.fuelQuotaL) problems.push('fuel')
  if (v.status !== 'AVAILABLE' || v.reserve) problems.push('unavailable/reserve used')
  if (problems.length) (bad++, console.log('RULE BREAK', v.id, problems))
}
console.log('rule breaks', bad)
