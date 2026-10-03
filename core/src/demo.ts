/**
 * The demo delivery day: everything a judge needs to walk through Kairon on a fresh install, kept apart from the
 * production code path. Used only when the server runs with SEED_DEMO_DAY=true, by the web app's demo states
 * (VITE_DEMO_MODE=true) and by the tests. The production path (Supabase, real CSV import) never imports it.
 *
 * - Reference data: the real competition CSVs when they are present in DATA_DIR, otherwise placeholder generators
 *   with the brief's proportions (120 outlets, 60 vehicles, 12 districts). Figures the booklet quotes are exact;
 *   everything else is a placeholder.
 * - Demo enrichment the CSVs don't carry: outlet names, managers, service history, driver names, fuel already used,
 *   and the recovery reserve (team policy: two reefers, see STORY).
 * - One realistic delivery day of orders, with the hero story's five Colombo stops locked to the story reefer as a
 *   whole trip.
 *
 * The story uses vehicles and outlets that have the same roles in the competition CSVs, so the walkthrough reads the
 * same on placeholder data and on the real data.
 */
import { calRow, catalogFor, measure, splitByTemp, type Catalog } from './catalog'
import { parseCsv, type BrandName, type CalendarRow, type CsvName, type DepotName, type DistrictTravelRow, type DockType, type FleetStatusRow, type OutletRow, type ParkingConstraint, type ServiceAllowanceRow, type VehicleRow } from './csv'
import { seedOps } from './ops'
import { type Reference } from './reference'
import { priorityOf } from './rules'
import { addDays, colomboDate, colomboTs, dowOf, fmtDate, hm, isoWeekOf } from './time'
import type { OpsData, Order, OrderItem, Role, User } from './types'

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
// Peliyagoda's reefers are VEH001–VEH007 (trucks) and VEH035–VEH036 (vans), as in vehicles.csv.
// ---------------------------------------------------------------------------

const REEFER_TRUCKS = [1, 2, 3, 4, 5, 6, 7, 49, 50, 51, 52, 53]
const REEFER_VANS = [35, 36, 57, 58]
const VANS = [37, 38, 59, 60]
export const IN_WORKSHOP = ['VEH005', 'VEH020', 'VEH022', 'VEH038', 'VEH043']

/**
 * The demo story's cast. Each id has the same role in the competition CSVs: VEH002 and VEH007 are Peliyagoda reefer
 * trucks, VEH036 a Peliyagoda reefer van, VEH024 a dry truck; the five story stops are Fresh outlets in Colombo with
 * normal parking; OUT043 is a Fresh outlet in Kalutara.
 */
export const STORY = {
  /** Nimal's reefer truck: the hero trip. */
  vehicle: 'VEH002',
  trip: 'TRP-002-1',
  /** Dilini's outlet (Fresh Borella): the shortfall, the flooded road and the moved stop. */
  store: 'OUT005',
  /** The stop the dispatcher drops when the story trip changes during loading. */
  dropped: 'OUT012',
  /** Skipped on the previous run, so it goes first today. */
  skipped: 'OUT043',
  /** The reserve van a stop moves to mid-route. */
  reserveVan: 'VEH036',
  /** Close to its weekly fuel quota. */
  fuelCase: 'VEH024',
} as const
/** Team policy: two reefers stay in reserve for breakdown recovery. */
export const RECOVERY_RESERVE: string[] = ['VEH007', STORY.reserveVan]

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

/** The demo story: a Fresh cluster in Colombo on the story reefer's route, plus an outlet skipped yesterday. */
export const STORY_OUTLETS: Record<string, { town: string; window: [string, string] }> = {
  OUT005: { town: 'Borella', window: ['04:00', '07:45'] },
  OUT008: { town: 'Narahenpita', window: ['05:00', '07:30'] },
  OUT010: { town: 'Kollupitiya', window: ['05:00', '07:30'] },
  OUT012: { town: 'Kirulapone', window: ['05:30', '08:00'] },
  OUT013: { town: 'Bambalapitiya', window: ['05:00', '07:30'] },
  OUT043: { town: 'Kalutara', window: ['05:00', '07:30'] },
}
export const STORY_VEHICLE: string = STORY.vehicle

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
  // Pin the story outlets to Fresh · Colombo and the skipped outlet to Fresh · Kalutara, as in outlets.csv.
  for (const id of Object.keys(STORY_OUTLETS)) {
    const idx = Number(id.slice(3)) - 1
    const district = id === STORY.skipped ? 'Kalutara' : 'Colombo'
    if (slots[idx][0] === 'Fresh' && slots[idx][1] === district) continue
    const swap = slots.findIndex((s, k) => s[0] === 'Fresh' && s[1] === district && !Object.keys(STORY_OUTLETS).includes(`OUT${pad(k + 1)}`))
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

// ---------------------------------------------------------------------------
// Reference data: real CSVs when present, placeholders otherwise
// ---------------------------------------------------------------------------

/** Build the reference set from whichever CSV texts are available; missing files fall back to placeholders. */
export function buildDemoReference(csv: Partial<Record<CsvName, string>> = {}): Reference {
  const pick = <T>(name: CsvName, fallback: () => T[]): [T[], 'csv' | 'placeholder'] => {
    const text = csv[name]
    if (text?.trim()) {
      const rows = parseCsv<T>(text)
      if (rows.length) return [rows, 'csv']
    }
    return [fallback(), 'placeholder']
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
  const fleetSource = sf === 'placeholder' && sv === 'csv' ? 'missing' : sf
  for (const o of outlets) o.mall_window = String(o.mall_window ?? '')
  return { outlets, vehicles, calendar, districts, allowances, fleet, sources: { outlets: so, vehicles: sv, calendar: sc, district_travel: sd, service_allowance: sa, fleet_status: fleetSource } }
}

// ---------------------------------------------------------------------------
// Demo catalogue (used when DATA_DIR has no catalog.json)
// ---------------------------------------------------------------------------

export const DEMO_CATALOG: Catalog = {
  Fresh: {
    chilled: [
      ['Dairy', 'crates', 0.045, 14],
      ['Yoghurt', 'crates', 0.04, 11],
      ['Meat & fish', 'crates', 0.05, 16],
      ['Frozen goods', 'cartons', 0.06, 12],
    ],
    ambient: [
      ['Dry groceries', 'cartons', 0.06, 11],
      ['Produce', 'crates', 0.07, 12],
      ['Bakery', 'trays', 0.04, 4],
      ['Beverages', 'cases', 0.035, 13],
    ],
  },
  // Garments fill a vehicle's volume long before its weight limit.
  Style: {
    chilled: [],
    ambient: [
      ['Hanging garments', 'rails', 0.9, 38],
      ['Apparel cartons', 'cartons', 0.12, 7],
      ['Footwear cartons', 'cartons', 0.09, 8],
    ],
  },
  // Heavy, fragile, valuable: often a single large item.
  Tech: {
    chilled: [],
    ambient: [
      ['Refrigerators', 'units', 0.9, 75],
      ['Washing machines', 'units', 0.45, 65],
      ['Televisions', 'units', 0.25, 18],
      ['Small appliances', 'cartons', 0.05, 5],
    ],
  },
}

// ---------------------------------------------------------------------------
// Demo accounts
// ---------------------------------------------------------------------------

/** One seeded account per role. Local login (no Supabase) accepts these with DEMO_PASSWORD. */
export const DEMO_USERS: Record<Role, User> = {
  DISPATCHER: { name: 'Geemal', email: 'dispatcher@kairon.demo', role: 'DISPATCHER', depot: 'Peliyagoda' },
  LOADER: { name: 'Kamal', email: 'loader@kairon.demo', role: 'LOADER', depot: 'Peliyagoda' },
  DRIVER: { name: 'Nimal', email: 'driver@kairon.demo', role: 'DRIVER', depot: 'Peliyagoda', assignedVehicle: STORY.vehicle },
  STORE_MANAGER: { name: 'Dilini', email: 'store@kairon.demo', role: 'STORE_MANAGER', depot: 'Peliyagoda', assignedOutlet: STORY.store },
}
export const DEMO_PASSWORD = 'kairon2026'

// ---------------------------------------------------------------------------
// Demo enrichment and the delivery day
// ---------------------------------------------------------------------------

/** Approximate district centres (latitude, longitude) for placing demo outlets on the map. */
const DISTRICT_CENTRES: Record<string, [number, number]> = {
  Colombo: [6.93, 79.86], Gampaha: [7.09, 79.99], Kalutara: [6.58, 79.96], Galle: [6.05, 80.22], Matara: [5.95, 80.54], Puttalam: [8.03, 79.83],
  Kegalle: [7.25, 80.35], Ratnapura: [6.68, 80.4], Kandy: [7.29, 80.63], Matale: [7.47, 80.62], Kurunegala: [7.49, 80.36], 'Nuwara Eliya': [6.97, 80.78],
}

/** Names, managers, service history, coordinates, drivers, fuel already used and the recovery reserve: what no CSV carries. */
export function enrichForDemo(d: OpsData) {
  const r = rng(23)
  const perDistrict: Record<string, number> = {}
  for (const o of d.outlets) {
    const k = (perDistrict[o.district] = (perDistrict[o.district] ?? -1) + 1)
    const towns = TOWNS[o.district] ?? [o.district]
    const town = STORY_OUTLETS[o.id]?.town ?? towns[k % towns.length]
    if (!o.name || o.name === o.id) o.name = `${o.brand} ${town}${o.mall ? ' Mall' : ''}`
    if (!o.manager) o.manager = MANAGERS[k % MANAGERS.length]
    // Service history: most Fresh outlets were served yesterday.
    o.lastServedDaysAgo = o.brand === 'Fresh' ? (r() < 0.8 ? 1 : 2) : 2 + Math.floor(r() * 5)
  }
  // A handful of outlets were skipped on the previous run; STORY.skipped is part of the demo story.
  const skipped = new Set([STORY.skipped, ...d.outlets.filter((o) => o.brand === 'Fresh' && !STORY_OUTLETS[o.id] && r() < 0.07).map((o) => o.id)])
  for (const o of d.outlets) if (skipped.has(o.id)) Object.assign(o, { deferredYesterday: true, deferralsThisWeek: 1, lastServedDaysAgo: 2 })
  const store = d.outlets.find((o) => o.id === STORY.store)
  if (store) store.manager = 'Dilini'
  // Maps need coordinates and no CSV carries them: place each outlet near its district centre (approximate, demo only).
  const g = rng(31)
  for (const o of d.outlets) {
    if (Number.isFinite(o.latitude) && Number.isFinite(o.longitude)) continue
    const [lat, lon] = DISTRICT_CENTRES[o.district] ?? (o.depot === 'Kandy' ? DISTRICT_CENTRES.Kandy : DISTRICT_CENTRES.Colombo)
    o.latitude = Math.round((lat + (g() - 0.5) * 0.08) * 1e5) / 1e5
    o.longitude = Math.round((lon + (g() - 0.5) * 0.08) * 1e5) / 1e5
  }

  // Fuel already used this week is seeded deterministically, so a fresh install behaves the same every time.
  const f = rng(29)
  d.vehicles.forEach((v, i) => {
    const used = Math.round(v.fuelQuotaL * (0.25 + f() * 0.35))
    v.fuelUsedL = v.id === STORY.fuelCase ? Math.round(v.fuelQuotaL * 0.93) : v.id === STORY_VEHICLE ? 40 : used
    // DRIVERS[0] (Nimal) drives the story reefer; everyone else gets one of the others.
    if (!v.driver) v.driver = v.id === STORY_VEHICLE ? DRIVERS[0] : DRIVERS[1 + ((i + 5) % (DRIVERS.length - 1))]
    // Team policy: two reefers stay in reserve for breakdown recovery.
    if (RECOVERY_RESERVE.includes(v.id) && v.status === 'AVAILABLE') v.reserve = true
  })
}

export interface DemoSeedOptions {
  /** Colombo date on which orders are placed. Deliveries run on the next operating day. */
  today?: string
  /** CSV texts from DATA_DIR; anything missing falls back to placeholders. */
  csv?: Partial<Record<CsvName, string>>
  /** Reference rows to use instead of `csv`, e.g. those a previous demo day stored (`storedReference`). */
  reference?: Reference
  catalog?: Catalog
}

/** The reference a demo day was built from, or null for an operation that wasn't seeded as a demo day. */
export function storedReference(d: OpsData): Reference | null {
  return d.demoSource ? { ...d.demoSource, calendar: d.calendar, allowances: d.allowances } : null
}

/** The demo operation: reference data, enrichment, one delivery day of orders, clock at 15:20 on the ordering day. */
export function seedDemoOps(opts: DemoSeedOptions = {}): OpsData {
  const today = opts.today ?? colomboDate(Date.now())
  const reference = opts.reference ?? buildDemoReference(opts.csv)
  const d = seedOps({ today, reference })
  d.catalog = opts.catalog && Object.keys(opts.catalog).length ? opts.catalog : DEMO_CATALOG
  d.demoSource = { outlets: reference.outlets, vehicles: reference.vehicles, districts: reference.districts, fleet: reference.fleet, sources: reference.sources }
  enrichForDemo(d)
  // The demo opens 40 minutes before the 16:00 order cutoff on the ordering day.
  d.clock = { sim: colomboTs(today, hm(15, 20)), real: Date.now() }
  d.orders = buildDemoOrders(d.outlets, d.calendar, d.deliveryDate, today, d.catalog)
  d.audit = d.orders.flatMap((o) => [
    { id: `a-${o.id}-1`, entity: o.id, at: o.createdAt, actor: 'STORE_MANAGER' as const, text: `Order placed · ${o.temp === 'CHILLED' ? 'chilled' : 'ambient'} · ${o.units} units` },
    { id: `a-${o.id}-2`, entity: o.id, at: o.createdAt + 20_000, actor: 'SYSTEM' as const, text: `Order confirmed for ${fmtDate(o.deliveryDate, { weekday: 'long', day: 'numeric', month: 'long' })}` },
  ])
  return d
}

function buildDemoOrders(outlets: OpsData['outlets'], cal: OpsData['calendar'], deliveryDate: string, orderDay: string, catalog: Catalog): Order[] {
  const r = rng(47)
  const row = calRow(cal, deliveryDate)
  const lift = 1 + (row?.festival_ramp ?? 0) * 0.25 + (row?.is_payday ? 0.08 : 0)
  const qty = (lo: number, hi: number) => Math.max(1, Math.round((lo + Math.floor(r() * (hi - lo + 1))) * lift))
  const pick = (p: number) => r() < p
  const dow = new Date(`${deliveryDate}T00:00:00Z`).getUTCDay()
  const orders: Order[] = []
  let n = 1400
  // Only products the catalogue knows: a real catalog.json may not carry every demo product.
  const known = (brand: BrandName, items: OrderItem[]) => items.filter((i) => [...catalogFor(brand, catalog).chilled, ...catalogFor(brand, catalog).ambient].some((p) => p[0] === i.name))

  const push = (outlet: OpsData['outlets'][number], all: OrderItem[]) => {
    for (const part of splitByTemp(outlet.brand, known(outlet.brand, all), catalog)) {
      const m = measure(outlet.brand, part.items, catalog)
      const runsDeferred = outlet.deferredYesterday && (part.temp === 'CHILLED' || outlet.brand !== 'Fresh') ? 1 : 0
      const pr = priorityOf({ brand: outlet.brand, temp: part.temp, runsDeferred }, outlet)
      orders.push({
        id: `ORD${++n}`,
        outletId: outlet.id,
        brand: outlet.brand,
        temp: part.temp,
        items: part.items,
        ...m,
        deliveryDate,
        status: 'CONFIRMED',
        priority: pr.score,
        priorityWhy: pr.why,
        runsDeferred: runsDeferred || undefined,
        createdAt: colomboTs(orderDay, hm(8) + Math.floor(r() * 470)),
        // The hero story's five Colombo stops start locked to the story reefer as one whole trip, as a dispatcher would lock
        // them, so the hero trip stays exactly the five designed stops.
        lock: STORY_OUTLETS[outlet.id] && outlet.id !== STORY.skipped && part.temp === 'CHILLED' ? { vehicleId: STORY_VEHICLE, by: 'SYSTEM', at: colomboTs(orderDay, hm(16)), wholeTrip: true } : undefined,
      })
    }
  }

  outlets.forEach((o, idx) => {
    const cat = catalogFor(o.brand, catalog)
    const story = !!STORY_OUTLETS[o.id]
    if (o.brand === 'Fresh') {
      if (o.id === STORY.store) {
        push(o, [
          { name: 'Dairy', unit: 'crates', qty: 12 },
          { name: 'Frozen goods', unit: 'cartons', qty: 4 },
          { name: 'Dry groceries', unit: 'cartons', qty: 20 },
          { name: 'Produce', unit: 'crates', qty: 8 },
        ])
        return
      }
      // Dry goods: every operating day.
      const dry: OrderItem[] = [
        { name: 'Dry groceries', unit: 'cartons', qty: qty(14, 30) },
        { name: 'Produce', unit: 'crates', qty: qty(6, 16) },
        ...(pick(0.6) ? [{ name: 'Bakery', unit: 'trays', qty: qty(4, 10) }] : []),
        ...(pick(0.6) ? [{ name: 'Beverages', unit: 'cases', qty: qty(6, 14) }] : []),
      ]
      // Chilled: several days a week, so not every outlet orders it today.
      const chilled: OrderItem[] =
        story || o.deferredYesterday || pick(0.68)
          ? [
              { name: 'Dairy', unit: 'crates', qty: qty(6, 16) },
              ...(pick(0.7) ? [{ name: 'Yoghurt', unit: 'crates', qty: qty(3, 8) }] : []),
              ...(pick(0.7) ? [{ name: 'Meat & fish', unit: 'crates', qty: qty(3, 10) }] : []),
              ...(pick(0.6) ? [{ name: 'Frozen goods', unit: 'cartons', qty: qty(2, 8) }] : []),
            ]
          : []
      push(o, [...dry, ...chilled])
    } else if (o.brand === 'Style') {
      // Weekly, on a fixed day per outlet; festival build-up brings extra orders.
      if (idx % 6 !== dow % 6 && !((row?.festival_ramp ?? 0) > 0 && idx % 3 === 0) && idx % 4 !== 1) return
      push(o, [
        { name: 'Hanging garments', unit: 'rails', qty: qty(2, 6) },
        { name: 'Apparel cartons', unit: 'cartons', qty: qty(10, 26) },
        ...(pick(0.7) ? [{ name: 'Footwear cartons', unit: 'cartons', qty: qty(4, 12) }] : []),
      ])
    } else {
      // As needed, often a single large item.
      if (!pick(0.45) || !cat.ambient.length) return
      const big = cat.ambient[Math.floor(r() * Math.min(3, cat.ambient.length))]
      push(o, [{ name: big[0], unit: big[1], qty: big[0] === 'Televisions' ? qty(2, 5) : qty(1, 2) }, ...(pick(0.5) ? [{ name: 'Small appliances', unit: 'cartons', qty: qty(3, 10) }] : [])])
    }
  })
  return orders
}
