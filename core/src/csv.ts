/**
 * Row types that mirror the competition CSVs column for column (Challenge Booklet pp. 26–31).
 * Everything the app reads from Waypoint's data goes through these shapes and the adapter,
 * so the real files load without touching any screen.
 */

export type BrandName = 'Fresh' | 'Style' | 'Tech'
export type DepotName = 'Peliyagoda' | 'Kandy'
export type DockType = 'rear_dock' | 'street' | 'mall_bay'
export type ParkingConstraint = 'normal' | 'van_only' | 'mall_dock'

/** outlets.csv */
export interface OutletRow {
  latitude?: number
  longitude?: number
  name?: string
  manager?: string
  outlet_id: string
  brand: BrandName
  district: string
  depot: DepotName
  dock_type: DockType
  parking_constraint: ParkingConstraint
  /** HH:MM-HH:MM, blank for outlets outside malls. */
  mall_window: string
  window_open_time: string
  window_close_time: string
}

/** vehicles.csv */
export interface VehicleRow {
  vehicle_id: string
  type: 'truck' | 'van'
  temp: 'reefer' | 'ambient'
  weight_cap_kg: number
  volume_cap_m3: number
  fuel_type: string
  km_per_l: number
  weekly_fuel_quota_l: number
  depot: DepotName
}

/** calendar.csv */
export interface CalendarRow {
  date: string
  dow: number
  dow_name: string
  is_weekend: 0 | 1
  iso_year: number
  iso_week: number
  is_payday: 0 | 1
  festival: string
  festival_ramp: number
  is_holiday: 0 | 1
  monsoon: 0 | 1
  is_operating: 0 | 1
}

/** district_travel.csv */
export interface DistrictTravelRow {
  district: string
  depot: DepotName
  road_class: 'urban' | 'suburban' | 'highway' | 'hill'
  free_flow_kmh: number
  depot_to_district_km: number
  depot_to_district_freeflow_min: number
  inter_stop_km: number
  inter_stop_freeflow_min: number
}

/** service_allowance.csv */
export interface ServiceAllowanceRow {
  brand: BrandName
  dock_type: DockType
  service_allowance_min: number
}

/** task2b_peak_day_fleet.csv — the shape our fleet status uses too. */
export interface FleetStatusRow {
  vehicle_id: string
  status: 'available' | 'in_workshop'
}

/** deliveries_train.csv / task1_test_inputs.csv — the order record. */
export interface OrderRecordRow {
  delivery_id: string
  order_date: string
  dispatch_date: string
  dispatch_status: 'attempted' | 'deferred' | 'not_run'
  outlet_id: string
  brand: BrandName
  district: string
  depot: DepotName
  temp_requirement: 'chilled' | 'ambient'
  order_units: number
  order_weight_kg: number
  order_volume_m3: number
  route_id: string
  seq_in_route: number
  vehicle_id: string
  vehicle_type: 'truck' | 'van'
  vehicle_temp: 'reefer' | 'ambient'
  planned_arrival_time: string
  window_open_time: string
  window_close_time: string
}

/** submission_task1.csv — Datathon Task 1 outputs the app can display. */
export interface ServicePredictionRow {
  delivery_id: string
  pred_service_min: number
  pred_late_prob: number
}

/** submission_task2a.csv joined with task2a_test_inputs.csv — Datathon Task 2A outputs. */
export interface DemandForecastRow {
  depot: DepotName
  brand: BrandName
  iso_year: number
  iso_week: number
  pred_total_volume_m3: number
  /** Always 0 for Style and Tech. */
  pred_chilled_volume_m3: number
}

export type CsvName = 'outlets' | 'vehicles' | 'calendar' | 'district_travel' | 'service_allowance' | 'fleet_status'

const NUMERIC = /^-?\d+(\.\d+)?$/

/** Minimal RFC 4180 parser: quoted fields, embedded commas and doubled quotes. Numbers are converted. */
export function parseCsv<T = Record<string, string | number>>(text: string): T[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''))
  if (!header) return []
  const keys = header.map((h) => h.trim().replace(/^﻿/, ''))
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, NUMERIC.test((r[i] ?? '').trim()) ? Number(r[i]) : (r[i] ?? '').trim()])) as T)
}
