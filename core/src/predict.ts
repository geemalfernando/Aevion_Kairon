/** Predictions are available only after genuine model outputs are imported. */
import type { DemandForecastRow } from './csv'
import { addDays, isoWeekOf } from './time'
import type { OpsData, Depot } from './types'
export type PredictionSource = 'model' | 'placeholder'
export interface StopPrediction { serviceMin: number; lateProb: number; source: PredictionSource }
export function tripPredictions(d: OpsData, tripId: string): Record<string, StopPrediction> {
  const trip = d.trips.find((t) => t.id === tripId)
  return Object.fromEntries((trip?.stops ?? []).flatMap((id) => {
    const p = d.predictions.service[id]
    return p ? [[id, { serviceMin: p.pred_service_min, lateProb: p.pred_late_prob, source: 'model' as const }]] : []
  }))
}
export const riskBand = (p: number): 'low' | 'medium' | 'high' => (p >= 0.45 ? 'high' : p >= 0.2 ? 'medium' : 'low')

// ---------------------------------------------------------------------------
// Task 2A: weekly demand per depot × brand
// ---------------------------------------------------------------------------

export interface WeekDemand extends DemandForecastRow {
  source: PredictionSource
  note?: string
}

export function demandForecast(d: OpsData, fromDate: string, weeks = 10): WeekDemand[] {
  const start = addDays(fromDate, 7 - ((new Date(`${fromDate}T00:00:00Z`).getUTCDay() + 6) % 7))
  const wanted = new Set(Array.from({ length: weeks }, (_, i) => { const w = isoWeekOf(addDays(start, i * 7)); return `${w.iso_year}-${w.iso_week}` }))
  return d.predictions.demand.filter((r) => wanted.has(`${r.iso_year}-${r.iso_week}`)).map((r) => ({ ...r, source: 'model' }))
}

/** Weekly refrigerated capacity a depot can offer: usable reefers × up to 2 Fresh trips × 6 days at 85% fill. */
export function weeklyReeferCapacity(d: OpsData, depot: Depot) {
  const reefers = d.vehicles.filter((v) => v.depot === depot && v.temp === 'reefer' && v.status !== 'IN_WORKSHOP' && !v.reserve)
  return Math.round(reefers.reduce((s, v) => s + v.capacityM3 * 1.5 * 6 * 0.85, 0))
}
