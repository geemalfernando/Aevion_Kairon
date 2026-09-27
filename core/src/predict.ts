/**
 * Slots for the Datathon models.
 *
 * Task 1 — per delivery: pred_service_min (handling time at the outlet) and pred_late_prob
 * (probability of arriving after the window closes).
 * Task 2A — per depot × brand × ISO week: pred_total_volume_m3 and pred_chilled_volume_m3 (0 for Style/Tech).
 *
 * Until the team's models are loaded (POST /api/predictions), these functions return transparent
 * placeholder estimates. Every value carries its source so screens can label it "Model estimate".
 */
import type { CalendarRow, DemandForecastRow } from './csv'
import { byId, districtOf, scheduleOfTrip, type StopPlan, type World } from './rules'
import { addDays, isoWeekOf } from './time'
import type { Brand, Depot, OpsData, Order } from './types'

export type PredictionSource = 'model' | 'placeholder'

export interface StopPrediction {
  serviceMin: number
  lateProb: number
  source: PredictionSource
}

const ROAD_RISK = { urban: 1.1, suburban: 1, highway: 0.85, hill: 1.3 } as const

/** Placeholder pred_service_min: the dispatcher's allowance, scaled by order size and access. */
export function placeholderService(order: Order, allowance: number, dock: string) {
  const size = 1 + Math.max(-0.2, Math.min(0.6, (order.units - 30) * 0.006))
  const heavy = order.weightKg > 600 ? 3 : 0
  const bay = dock === 'mall_bay' ? 2.5 : dock === 'street' ? 1 : 0
  return Math.round((allowance * size + heavy + bay) * 10) / 10
}

/** Placeholder pred_late_prob: logistic in the planned slack, shifted by road class and calendar pressure. */
export function placeholderLate(stop: StopPlan, roadClass: keyof typeof ROAD_RISK, cal?: CalendarRow) {
  const pressure = (cal?.monsoon ? 0.35 : 0) + (cal?.festival_ramp ?? 0) * 0.5 + (cal?.is_payday ? 0.2 : 0)
  const z = (8 - stop.slack) / (9 * ROAD_RISK[roadClass]) + pressure - 1.2
  return Math.round(Math.min(0.97, Math.max(0.02, 1 / (1 + Math.exp(-z)))) * 100) / 100
}

/** Predictions for every stop of a trip, preferring loaded model outputs. */
export function tripPredictions(d: OpsData, tripId: string): Record<string, StopPrediction> {
  const trip = byId(d.trips, tripId)
  if (!trip) return {}
  const sched = scheduleOfTrip(d as World, trip)
  const dist = districtOf(d, trip.district)
  const cal = d.calendar.find((c) => c.date === d.deliveryDate)
  const out: Record<string, StopPrediction> = {}
  for (const s of sched.stops) {
    const model = d.predictions.service[s.orderId]
    if (model) {
      out[s.orderId] = { serviceMin: model.pred_service_min, lateProb: model.pred_late_prob, source: 'model' }
      continue
    }
    const o = byId(d.orders, s.orderId)!
    const outlet = byId(d.outlets, o.outletId)!
    // A delay the driver reported eats into the slack of the stops it affects.
    const delay = trip.reportedDelay && (!trip.reportedDelay.orderId || trip.reportedDelay.orderId === s.orderId) ? trip.reportedDelay.minutes : 0
    out[s.orderId] = { serviceMin: placeholderService(o, s.service, outlet.dock), lateProb: placeholderLate({ ...s, slack: s.slack - delay }, dist.road_class, cal), source: 'placeholder' }
  }
  return out
}

export const riskBand = (p: number): 'low' | 'medium' | 'high' => (p >= 0.45 ? 'high' : p >= 0.2 ? 'medium' : 'low')

// ---------------------------------------------------------------------------
// Task 2A: weekly demand per depot × brand
// ---------------------------------------------------------------------------

export interface WeekDemand extends DemandForecastRow {
  source: PredictionSource
  note?: string
}

/** Typical weekly order volume per outlet (m³), used by the placeholder forecast. */
const WEEKLY_PER_OUTLET: Record<Brand, { total: number; chilledShare: number }> = {
  Fresh: { total: 6 * 2.9 + 4.2 * 1.6, chilledShare: (4.2 * 1.6) / (6 * 2.9 + 4.2 * 1.6) },
  Style: { total: 1.1 * 6.5, chilledShare: 0 },
  Tech: { total: 1.4 * 2.2, chilledShare: 0 },
}

/**
 * Forecast for the next `weeks` ISO weeks starting after `fromDate`. Loaded model rows win;
 * otherwise a placeholder built from outlet counts and calendar pressure (festival ramp, paydays, monsoon).
 */
export function demandForecast(d: OpsData, fromDate: string, weeks = 10): WeekDemand[] {
  const start = addDays(fromDate, 7 - ((new Date(`${fromDate}T00:00:00Z`).getUTCDay() + 6) % 7))
  const out: WeekDemand[] = []
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, w * 7)
    const { iso_year, iso_week } = isoWeekOf(monday)
    const days = d.calendar.filter((c) => c.iso_year === iso_year && c.iso_week === iso_week)
    const ramp = Math.max(0, ...days.map((c) => c.festival_ramp))
    const payday = days.some((c) => c.is_payday)
    const monsoon = days.some((c) => c.monsoon)
    const operating = days.length ? days.filter((c) => c.is_operating).length : 6
    const festival = days.find((c) => c.festival)?.festival
    for (const depot of ['Peliyagoda', 'Kandy'] as Depot[]) {
      for (const brand of ['Fresh', 'Style', 'Tech'] as Brand[]) {
        const model = d.predictions.demand.find((r) => r.depot === depot && r.brand === brand && r.iso_year === iso_year && r.iso_week === iso_week)
        if (model) {
          out.push({ ...model, pred_chilled_volume_m3: brand === 'Fresh' ? model.pred_chilled_volume_m3 : 0, source: 'model' })
          continue
        }
        const outlets = d.outlets.filter((o) => o.depot === depot && o.brand === brand).length
        const base = WEEKLY_PER_OUTLET[brand]
        const lift = 1 + ramp * (brand === 'Fresh' ? 0.22 : brand === 'Style' ? 0.35 : 0.18) + (payday ? 0.05 : 0) + (monsoon && brand === 'Fresh' ? 0.02 : 0)
        const total = Math.round(outlets * base.total * lift * (operating / 6) * 10) / 10
        out.push({
          depot,
          brand,
          iso_year,
          iso_week,
          pred_total_volume_m3: total,
          pred_chilled_volume_m3: brand === 'Fresh' ? Math.round(total * base.chilledShare * (1 + ramp * 0.08) * 10) / 10 : 0,
          source: 'placeholder',
          note: festival ? `${festival} week` : ramp > 0 ? 'Festival build-up' : payday ? 'Payday week' : undefined,
        })
      }
    }
  }
  return out
}

/** Weekly refrigerated capacity a depot can offer: usable reefers × up to 2 Fresh trips × 6 days at 85% fill. */
export function weeklyReeferCapacity(d: OpsData, depot: Depot) {
  const reefers = d.vehicles.filter((v) => v.depot === depot && v.temp === 'reefer' && v.status !== 'IN_WORKSHOP' && !v.reserve)
  return Math.round(reefers.reduce((s, v) => s + v.capacityM3 * 1.5 * 6 * 0.85, 0))
}
