import { useMemo } from 'react'
import { tripPredictions } from '@core/predict'
import { opMinutes } from '@core/ops'
import { districtOf } from '@core/rules'
import { driverTrip, isDone, orderOf, scheduleOf } from '../../lib/select'
import { useSession, useView } from '../../store'

/** Everything the driver screens need, derived from this device's view of the operation. */
export function useDriverRoute() {
  const d = useView()
  const user = useSession((s) => s.user)!
  return useMemo(() => {
    const trip = driverTrip(d, user.assignedVehicle)
    const vehicle = d.vehicles.find((v) => v.id === user.assignedVehicle)!
    if (!trip) return { d, vehicle, trip: undefined, sched: undefined, stops: [], nextIdx: -1, done: 0, preds: {} }
    const sched = scheduleOf(d, trip)
    const preds = tripPredictions(d, trip.id)
    // Live arrival for stops still to come: never earlier than now plus the drive, so a late run never shows times in the past.
    const hop = districtOf(d, trip.district).inter_stop_freeflow_min
    let clock = trip.status === 'IN_PROGRESS' ? opMinutes(d) : -Infinity
    const stops = trip.stops.map((id, i) => {
      const order = orderOf(d, id)!
      let plan = sched.stops[i]
      if (plan && !isDone(order) && clock > -Infinity) {
        // Include any delay the driver reported for this stop (or for the rest of the route).
        const late = trip.reportedDelay && (!trip.reportedDelay.orderId || trip.reportedDelay.orderId === id) ? trip.reportedDelay.minutes : 0
        const eta = Math.max(plan.eta + late, Math.round(clock + hop))
        plan = { ...plan, eta }
        clock = Math.max(eta, plan.window[0]) + plan.service
      }
      return { order, plan, outlet: d.outlets.find((o) => o.id === order.outletId)!, pred: preds[id] }
    })
    const nextIdx = stops.findIndex((s) => !isDone(s.order))
    return { d, vehicle, trip, sched, stops, nextIdx, done: stops.filter((s) => isDone(s.order)).length, preds }
  }, [d, user.assignedVehicle])
}
