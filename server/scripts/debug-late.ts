import { commands, seedOps } from '@core/ops'
import { byId, vehicleDay } from '@core/rules'

const d = seedOps()
commands.closeOrders(d)
commands.generatePlan(d)
for (const id of process.argv.slice(2)) {
  const v = byId(d.vehicles, id)!
  const day = vehicleDay(v, d.trips, d)
  for (const { trip, sched, number } of day.trips)
    console.log(id, trip.id, 'num', number, trip.number, trip.brand, trip.district, 'dep', trip.departure, sched.departure, sched.stops.map((s) => `${s.outletId} eta ${s.eta} win ${s.window} ${s.late ? 'LATE' : ''}`).join(' | '))
}
