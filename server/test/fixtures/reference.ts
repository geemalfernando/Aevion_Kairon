/**
 * Waypoint's reference data (outlets, vehicles, calendar, district travel, service allowances, fleet status).
 *
 * When the competition CSVs are present they are used as-is. Until then, `placeholder*` generators
 * produce data with the same columns and the proportions stated in the brief:
 *   - 120 outlets: 80 Fresh, 25 Style (about half in malls), 15 Tech, across 12 districts
 *   - 60 vehicles: 12 reefer trucks, 40 dry-box trucks, 8 vans (4 of them refrigerated)
 * Travel and service figures that the booklet quotes (Colombo 24/8 min, Gampaha 37/9 min,
 * Fresh + rear_dock 15 min, Fresh + street 16 min) are used exactly; the rest are marked placeholders.
 */
import { parseCsv, type BrandName, type CalendarRow, type CsvName, type DepotName, type DistrictTravelRow, type DockType, type FleetStatusRow, type OutletRow, type ParkingConstraint, type ServiceAllowanceRow, type VehicleRow } from '@core/csv'
import { addDays, dowOf, isoWeekOf } from '@core/time'

export interface Reference {
  outlets: OutletRow[]
  vehicles: VehicleRow[]
  calendar: CalendarRow[]
  districts: DistrictTravelRow[]
  allowances: ServiceAllowanceRow[]
  fleet: FleetStatusRow[]
  /** Which files came from real CSVs. */
  sources: Record<CsvName, 'csv' | 'placeholder' | 'missing'>
}

/** Deterministic RNG so every demo run starts from the same network. */
export function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (n: number, w = 3) => String(n).padStart(w, '0')

// ---------------------------------------------------------------------------
// District travel (placeholder where the booklet gives no figure)
// ---------------------------------------------------------------------------

export const PLACEHOLDER_DISTRICTS: DistrictTravelRow[] = [
  // Booklet p.21: Colombo 24 min + 8 min between stops; Gampaha 37 + 9.
  { district: 'Colombo', depot: 'Peliyagoda', road_class: 'urban', free_flow_kmh: 25, depot_to_district_km: 10, depot_to_district_freeflow_min: 24, inter_stop_km: 3.3, inter_stop_freeflow_min: 8 },
  { district: 'Gampaha', depot: 'Peliyagoda', road_class: 'suburban', free_flow_kmh: 40, depot_to_district_km: 25, depot_to_district_freeflow_min: 37, inter_stop_km: 6, inter_stop_freeflow_min: 9 },
  { district: 'Kalutara', depot: 'Peliyagoda', road_class: 'suburban', free_flow_kmh: 48, depot_to_district_km: 44, depot_to_district_freeflow_min: 55, inter_stop_km: 7, inter_stop_freeflow_min: 10 },
  { district: 'Galle', depot: 'Peliyagoda', road_class: 'highway', free_flow_kmh: 75, depot_to_district_km: 118, depot_to_district_freeflow_min: 95, inter_stop_km: 7, inter_stop_freeflow_min: 12 },
  { district: 'Matara', depot: 'Peliyagoda', road_class: 'highway', free_flow_kmh: 75, depot_to_district_km: 158, depot_to_district_freeflow_min: 125, inter_stop_km: 7, inter_stop_freeflow_min: 12 },
  { district: 'Puttalam', depot: 'Peliyagoda', road_class: 'highway', free_flow_kmh: 60, depot_to_district_km: 120, depot_to_district_freeflow_min: 120, inter_stop_km: 10, inter_stop_freeflow_min: 14 },
  { district: 'Kegalle', depot: 'Peliyagoda', road_class: 'suburban', free_flow_kmh: 50, depot_to_district_km: 75, depot_to_district_freeflow_min: 90, inter_stop_km: 8, inter_stop_freeflow_min: 12 },
  { district: 'Ratnapura', depot: 'Peliyagoda', road_class: 'hill', free_flow_kmh: 50, depot_to_district_km: 96, depot_to_district_freeflow_min: 115, inter_stop_km: 9, inter_stop_freeflow_min: 14 },
  { district: 'Kandy', depot: 'Kandy', road_class: 'urban', free_flow_kmh: 24, depot_to_district_km: 6, depot_to_district_freeflow_min: 15, inter_stop_km: 3.5, inter_stop_freeflow_min: 9 },
  { district: 'Matale', depot: 'Kandy', road_class: 'suburban', free_flow_kmh: 39, depot_to_district_km: 26, depot_to_district_freeflow_min: 40, inter_stop_km: 6, inter_stop_freeflow_min: 11 },
  { district: 'Kurunegala', depot: 'Kandy', road_class: 'highway', free_flow_kmh: 45, depot_to_district_km: 45, depot_to_district_freeflow_min: 60, inter_stop_km: 8, inter_stop_freeflow_min: 12 },
  { district: 'Nuwara Eliya', depot: 'Kandy', road_class: 'hill', free_flow_kmh: 43, depot_to_district_km: 75, depot_to_district_freeflow_min: 105, inter_stop_km: 6, inter_stop_freeflow_min: 15 },
]

/** Approximate latitude/longitude, projected onto the stylised 0–100 map. */
const GEO: Record<string, [number, number]> = {
  Colombo: [6.93, 79.86],
  Gampaha: [7.09, 79.99],
  Kalutara: [6.58, 79.96],
  Galle: [6.05, 80.22],
  Matara: [5.95, 80.54],
  Puttalam: [8.03, 79.83],
  Kegalle: [7.25, 80.35],
  Ratnapura: [6.68, 80.4],
  Kandy: [7.29, 80.63],
  Matale: [7.47, 80.62],
  Kurunegala: [7.49, 80.36],
  'Nuwara Eliya': [6.97, 80.78],
}
const project = ([lat, lon]: [number, number]) => ({ x: ((lon - 79.6) / 1.3) * 100, y: ((8.15 - lat) / 2.3) * 100 })

export const DEPOT_POS: Record<DepotName, { x: number; y: number }> = {
  Peliyagoda: project([6.96, 79.9]),
  Kandy: { x: 75.5, y: 34 },
}

/** Map centre for any district; unknown districts (from real CSVs) are placed near their depot. */
export function districtPosition(name: string, depot: DepotName): { x: number; y: number } {
  if (GEO[name]) return project(GEO[name])
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0
  const a = ((h >>> 0) % 360) * (Math.PI / 180)
  const base = DEPOT_POS[depot]
  return { x: base.x + Math.cos(a) * 14, y: base.y + Math.sin(a) * 14 }
}

// ---------------------------------------------------------------------------
// Service allowances (booklet gives Fresh rear_dock 15 and street 16)
// ---------------------------------------------------------------------------

export const PLACEHOLDER_ALLOWANCES: ServiceAllowanceRow[] = [
  { brand: 'Fresh', dock_type: 'rear_dock', service_allowance_min: 15 },
  { brand: 'Fresh', dock_type: 'street', service_allowance_min: 16 },
  { brand: 'Fresh', dock_type: 'mall_bay', service_allowance_min: 18 },
  { brand: 'Style', dock_type: 'rear_dock', service_allowance_min: 18 },
  { brand: 'Style', dock_type: 'street', service_allowance_min: 22 },
  { brand: 'Style', dock_type: 'mall_bay', service_allowance_min: 25 },
  { brand: 'Tech', dock_type: 'rear_dock', service_allowance_min: 20 },
  { brand: 'Tech', dock_type: 'street', service_allowance_min: 24 },
  { brand: 'Tech', dock_type: 'mall_bay', service_allowance_min: 26 },
]

// ---------------------------------------------------------------------------
// Vehicles: 12 reefer trucks, 40 dry-box trucks, 8 vans (4 reefer). Kandy hub runs VEH049–VEH060.
// ---------------------------------------------------------------------------

const REEFER_TRUCKS = [1, 3, 5, 8, 11, 14, 17, 20, 23, 49, 50, 51]
const REEFER_VANS = [31, 34, 37, 52]
const VANS = [40, 43, 46, 53]
export const IN_WORKSHOP = ['VEH005', 'VEH020', 'VEH022', 'VEH038', 'VEH043']
/** Team policy: two reefers stay in reserve for breakdown recovery. */
export const RECOVERY_RESERVE = ['VEH008', 'VEH031']

export function placeholderVehicles(): VehicleRow[] {
  return Array.from({ length: 60 }, (_, i) => {
    const n = i + 1
    const depot: DepotName = n >= 49 ? 'Kandy' : 'Peliyagoda'
    const id = `VEH${pad(n)}`
    if (REEFER_TRUCKS.includes(n)) return { vehicle_id: id, type: 'truck', temp: 'reefer', weight_cap_kg: 3500, volume_cap_m3: 16, fuel_type: 'diesel', km_per_l: 5, weekly_fuel_quota_l: 220, depot }
    if (REEFER_VANS.includes(n)) return { vehicle_id: id, type: 'van', temp: 'reefer', weight_cap_kg: 1000, volume_cap_m3: 6, fuel_type: 'diesel', km_per_l: 9, weekly_fuel_quota_l: 110, depot }
    if (VANS.includes(n)) return { vehicle_id: id, type: 'van', temp: 'ambient', weight_cap_kg: 1200, volume_cap_m3: 7, fuel_type: 'diesel', km_per_l: 11, weekly_fuel_quota_l: 100, depot }
    return { vehicle_id: id, type: 'truck', temp: 'ambient', weight_cap_kg: 5000, volume_cap_m3: 24, fuel_type: 'diesel', km_per_l: 6, weekly_fuel_quota_l: 200, depot }
  })
}

export const placeholderFleet = (): FleetStatusRow[] => placeholderVehicles().map((v) => ({ vehicle_id: v.vehicle_id, status: IN_WORKSHOP.includes(v.vehicle_id) ? 'in_workshop' : 'available' }))

// ---------------------------------------------------------------------------
// Outlets
// ---------------------------------------------------------------------------

const OUTLET_PLAN: [BrandName, string, number][] = [
  ['Fresh', 'Colombo', 22], ['Fresh', 'Gampaha', 14], ['Fresh', 'Kalutara', 8], ['Fresh', 'Galle', 5], ['Fresh', 'Matara', 3], ['Fresh', 'Puttalam', 3],
  ['Fresh', 'Kegalle', 3], ['Fresh', 'Ratnapura', 3], ['Fresh', 'Kandy', 8], ['Fresh', 'Kurunegala', 5], ['Fresh', 'Matale', 3], ['Fresh', 'Nuwara Eliya', 3],
  ['Style', 'Colombo', 9], ['Style', 'Gampaha', 5], ['Style', 'Kalutara', 2], ['Style', 'Galle', 2], ['Style', 'Matara', 1], ['Style', 'Ratnapura', 1], ['Style', 'Kandy', 3], ['Style', 'Kurunegala', 2],
  ['Tech', 'Colombo', 5], ['Tech', 'Gampaha', 3], ['Tech', 'Kalutara', 1], ['Tech', 'Galle', 1], ['Tech', 'Kegalle', 1], ['Tech', 'Puttalam', 1], ['Tech', 'Kandy', 2], ['Tech', 'Kurunegala', 1],
]

/** The demo story: a Fresh cluster in Colombo on VEH014's route, plus an outlet skipped yesterday. */
export const STORY_OUTLETS: Record<string, { town: string; window: [string, string] }> = {
  OUT004: { town: 'Kollupitiya', window: ['05:00', '07:30'] },
  OUT018: { town: 'Bambalapitiya', window: ['05:00', '07:30'] },
  OUT032: { town: 'Borella', window: ['05:00', '07:30'] },
  OUT047: { town: 'Narahenpita', window: ['05:00', '07:00'] },
  OUT056: { town: 'Kirulapone', window: ['05:00', '08:00'] },
  OUT043: { town: 'Dehiwala', window: ['05:00', '07:30'] },
}
export const STORY_VEHICLE = 'VEH014'

const FRESH_WINDOWS: [string, string][] = [
  ['04:30', '07:30'],
  ['05:00', '07:30'],
  ['05:00', '08:00'],
  ['04:30', '07:00'],
]
const STYLE_WINDOWS: [string, string][] = [
  ['08:00', '12:00'],
  ['08:30', '11:30'],
  ['09:00', '12:00'],
]
const TECH_WINDOWS: [string, string][] = [
  ['10:00', '16:00'],
  ['09:00', '15:00'],
  ['11:00', '17:00'],
]
const MALL_WINDOW: Record<BrandName, string> = { Fresh: '05:00-07:30', Style: '07:00-09:30', Tech: '07:00-10:30' }

export function placeholderOutlets(): OutletRow[] {
  const r = rng(11)
  const slots: [BrandName, string][] = OUTLET_PLAN.flatMap(([b, d, n]) => Array.from({ length: n }, () => [b, d] as [BrandName, string]))
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }
  // Pin the story outlets to Fresh · Colombo.
  for (const id of Object.keys(STORY_OUTLETS)) {
    const idx = Number(id.slice(3)) - 1
    if (slots[idx][0] === 'Fresh' && slots[idx][1] === 'Colombo') continue
    const swap = slots.findIndex((s, k) => s[0] === 'Fresh' && s[1] === 'Colombo' && !Object.keys(STORY_OUTLETS).includes(`OUT${pad(k + 1)}`))
    ;[slots[idx], slots[swap]] = [slots[swap], slots[idx]]
  }

  const depotOf = (district: string) => PLACEHOLDER_DISTRICTS.find((d) => d.district === district)!.depot
  const rows: OutletRow[] = slots.map(([brand, district], i) => {
    const id = `OUT${pad(i + 1)}`
    const windows = brand === 'Fresh' ? FRESH_WINDOWS : brand === 'Style' ? STYLE_WINDOWS : TECH_WINDOWS
    const w = STORY_OUTLETS[id]?.window ?? windows[Math.floor(r() * windows.length)]
    const dock: DockType = brand === 'Fresh' ? (r() < 0.7 ? 'rear_dock' : 'street') : brand === 'Style' ? (r() < 0.6 ? 'street' : 'rear_dock') : r() < 0.6 ? 'rear_dock' : 'street'
    return { outlet_id: id, brand, district, depot: depotOf(district), dock_type: dock, parking_constraint: 'normal', mall_window: '', window_open_time: w[0], window_close_time: w[1] }
  })

  const story = new Set(Object.keys(STORY_OUTLETS))
  const setMall = (o: OutletRow) => Object.assign(o, { parking_constraint: 'mall_dock' as ParkingConstraint, dock_type: 'mall_bay' as DockType, mall_window: MALL_WINDOW[o.brand] })
  // About half of Style is in malls (12 of 25); two Tech and two Fresh outlets are too.
  rows.filter((o) => o.brand === 'Style').filter((_, k) => k % 2 === 0).slice(0, 12).forEach(setMall)
  rows.filter((o) => o.brand === 'Tech' && o.district === 'Colombo').slice(0, 2).forEach(setMall)
  rows.filter((o) => o.brand === 'Fresh' && o.district === 'Colombo' && !story.has(o.outlet_id)).slice(0, 2).forEach(setMall)
  for (const o of rows) {
    // Style and Tech mall windows must overlap their requested window.
    if (o.parking_constraint === 'mall_dock' && o.brand !== 'Fresh') Object.assign(o, o.brand === 'Style' ? { window_open_time: '08:00', window_close_time: '12:00' } : { window_open_time: '09:00', window_close_time: '15:00' })
  }

  // Narrow streets: van-only outlets (trucks cannot reach them).
  const vanOnly = (pred: (o: OutletRow) => boolean, n: number) =>
    rows
      .filter((o) => o.parking_constraint === 'normal' && !story.has(o.outlet_id) && pred(o))
      .slice(0, n)
      .forEach((o) => Object.assign(o, { parking_constraint: 'van_only', dock_type: 'street' }))
  vanOnly((o) => o.brand === 'Fresh' && o.district === 'Colombo', 3)
  vanOnly((o) => o.brand === 'Fresh' && o.district === 'Kandy', 2)
  vanOnly((o) => o.brand === 'Fresh' && (o.district === 'Nuwara Eliya' || o.district === 'Galle'), 2)
  vanOnly((o) => o.brand === 'Style' && o.district === 'Colombo', 2)
  vanOnly((o) => o.brand === 'Tech' && o.district === 'Gampaha', 1)
  const o91 = rows.find((o) => o.outlet_id === 'OUT091')!
  if (o91.parking_constraint === 'normal') Object.assign(o91, { parking_constraint: 'van_only', dock_type: 'street' })
  for (const id of story) Object.assign(rows.find((o) => o.outlet_id === id)!, { dock_type: 'rear_dock' })
  return rows
}

// ---------------------------------------------------------------------------
// Calendar (placeholder festivals and paydays until calendar.csv arrives)
// ---------------------------------------------------------------------------

const FESTIVALS: [string, string][] = [
  ['2026-01-14', 'Thai Pongal'],
  ['2026-02-04', 'Independence Day'],
  ['2026-04-14', 'Sinhala & Tamil New Year'],
  ['2026-05-01', 'Vesak'],
  ['2026-06-29', 'Poson'],
  ['2026-11-08', 'Deepavali'],
  ['2026-12-25', 'Christmas'],
  ['2027-01-15', 'Thai Pongal'],
  ['2027-02-04', 'Independence Day'],
  ['2027-04-14', 'Sinhala & Tamil New Year'],
]
const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function placeholderCalendar(from = '2026-01-01', to = '2027-06-30'): CalendarRow[] {
  const fest = new Map(FESTIVALS)
  const rows: CalendarRow[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dow = dowOf(date)
    const festival = fest.get(date) ?? ''
    let ramp = 0
    for (const [f] of FESTIVALS) {
      const days = (Date.parse(f) - Date.parse(date)) / 86_400_000
      if (days >= 0 && days <= 9) ramp = Math.max(ramp, Math.round((1 - days / 9) * 100) / 100)
    }
    const month = Number(date.slice(5, 7))
    const isHoliday = festival ? 1 : 0
    rows.push({
      date,
      dow,
      dow_name: DOW[dow],
      is_weekend: dow >= 5 ? 1 : 0,
      ...isoWeekOf(date),
      is_payday: 0,
      festival,
      festival_ramp: ramp,
      is_holiday: isHoliday,
      monsoon: month >= 5 && month <= 11 ? 1 : 0,
      is_operating: dow <= 5 && !isHoliday ? 1 : 0,
    })
  }
  // Payday: the 25th, or the last operating day before it.
  const byMonth = new Map<string, CalendarRow[]>()
  for (const c of rows) byMonth.set(c.date.slice(0, 7), [...(byMonth.get(c.date.slice(0, 7)) ?? []), c])
  for (const days of byMonth.values()) {
    const pay = days.filter((c) => Number(c.date.slice(8)) <= 25 && c.is_operating).pop()
    if (pay) pay.is_payday = 1
  }
  return rows
}

// ---------------------------------------------------------------------------
// Loading real CSVs
// ---------------------------------------------------------------------------

/** Build the reference set from whichever CSV texts are available; missing files fall back to placeholders. */
export function buildReference(csv: Partial<Record<CsvName, string>> = {}, fixtures = true): Reference {
  const pick = <T>(name: CsvName, fallback: () => T[]): [T[], 'csv' | 'placeholder' | 'missing'] => {
    const text = csv[name]
    if (text?.trim()) {
      const rows = parseCsv<T>(text)
      if (rows.length) return [rows, 'csv']
    }
    return fixtures ? [fallback(), 'placeholder'] : [[], 'missing']
  }
  const [outlets, so] = pick<OutletRow>('outlets', placeholderOutlets)
  const [vehicles, sv] = pick<VehicleRow>('vehicles', placeholderVehicles)
  const [calendar, sc] = pick<CalendarRow>('calendar', () => placeholderCalendar())
  const [districts, sd] = pick<DistrictTravelRow>('district_travel', () => PLACEHOLDER_DISTRICTS)
  const [allowances, sa] = pick<ServiceAllowanceRow>('service_allowance', () => PLACEHOLDER_ALLOWANCES)
  const [fleet, sf] = pick<FleetStatusRow>('fleet_status', () =>
    // With real vehicles but no fleet file, everything is available.
    sv === 'csv' ? vehicles.map((v) => ({ vehicle_id: v.vehicle_id, status: 'available' as const })) : placeholderFleet(),
  )
  for (const o of outlets) o.mall_window = String(o.mall_window ?? '')
  return { outlets, vehicles, calendar, districts, allowances, fleet, sources: { outlets: so, vehicles: sv, calendar: sc, district_travel: sd, service_allowance: sa, fleet_status: sf } }
}

// ---------------------------------------------------------------------------
// Demo-only details that no CSV carries: names, drivers, service history.
// ---------------------------------------------------------------------------

export const TOWNS: Record<string, string[]> = {
  Colombo: ['Borella', 'Wellawatte', 'Kollupitiya', 'Dehiwala', 'Nugegoda', 'Maharagama', 'Kotte', 'Rajagiriya', 'Battaramulla', 'Kotahena', 'Bambalapitiya', 'Havelock Town', 'Kirulapone', 'Narahenpita', 'Moratuwa', 'Kohuwala', 'Mount Lavinia', 'Pettah', 'Thimbirigasyaya', 'Mattakkuliya'],
  Gampaha: ['Negombo', 'Ja-Ela', 'Wattala', 'Kadawatha', 'Gampaha', 'Kiribathgoda', 'Ragama', 'Minuwangoda', 'Kelaniya', 'Ekala', 'Kandana', 'Seeduwa', 'Veyangoda'],
  Kalutara: ['Panadura', 'Kalutara', 'Horana', 'Wadduwa', 'Beruwala', 'Bandaragama', 'Aluthgama'],
  Galle: ['Galle Fort', 'Hikkaduwa', 'Ambalangoda', 'Karapitiya', 'Baddegama'],
  Matara: ['Matara', 'Weligama', 'Dikwella', 'Akuressa'],
  Puttalam: ['Puttalam', 'Chilaw', 'Wennappuwa', 'Marawila'],
  Kegalle: ['Kegalle', 'Mawanella', 'Warakapola', 'Rambukkana'],
  Ratnapura: ['Ratnapura', 'Balangoda', 'Embilipitiya', 'Pelmadulla'],
  Kandy: ['Kandy City', 'Peradeniya', 'Katugastota', 'Kundasale', 'Gampola', 'Digana', 'Pilimathalawa', 'Tennekumbura'],
  Matale: ['Matale', 'Dambulla', 'Galewela', 'Ukuwela'],
  Kurunegala: ['Kurunegala', 'Kuliyapitiya', 'Pannala', 'Wariyapola', 'Polgahawela'],
  'Nuwara Eliya': ['Nuwara Eliya', 'Hatton', 'Talawakele', 'Nanu Oya'],
}

export const MANAGERS = ['Dilini', 'Ishara', 'Roshan', 'Anjali', 'Farzan', 'Tharaka', 'Madhavi', 'Senuri', 'Kavinda', 'Nadeesha', 'Hasitha', 'Priyanka', 'Shalini', 'Arjun', 'Fathima', 'Chamari']
export const DRIVERS = ['Nimal', 'Kasun', 'Ruwan', 'Saman', 'Chaminda', 'Pradeep', 'Tharindu', 'Dilan', 'Asanka', 'Lahiru', 'Mahesh', 'Sunil', 'Janaka', 'Upul', 'Rohan', 'Isuru', 'Buddhika', 'Nuwan', 'Gayan', 'Sampath', 'Ravi', 'Murugan', 'Irfan', 'Suresh', 'Anura', 'Bandara', 'Chathura', 'Dinesh', 'Eranga', 'Fazal', 'Gihan', 'Hemantha', 'Indika', 'Jagath', 'Kumara', 'Lasantha', 'Madushan', 'Nalin', 'Oshan', 'Priyantha', 'Rizwan', 'Sajith', 'Thilina', 'Udaya', 'Vimal', 'Wasantha', 'Yasith', 'Kannan', 'Selvam', 'Rajan', 'Nimesh', 'Harsha', 'Dhanushka', 'Aravinda', 'Shiran', 'Thushara', 'Kavinda', 'Mohamed', 'Ajith', 'Lakmal', 'Roshan', 'Sanjeewa']
