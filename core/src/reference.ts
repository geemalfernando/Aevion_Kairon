import { parseCsv, type CalendarRow, type CsvName, type DepotName, type DistrictTravelRow, type FleetStatusRow, type OutletRow, type ServiceAllowanceRow, type VehicleRow } from './csv'

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

/** Missing reference files remain empty; only an explicit import supplies business data. */
export function buildReference(csv: Partial<Record<CsvName, string>> = {}): Reference {
  const pick = <T>(name: CsvName): T[] => csv[name]?.trim() ? parseCsv<T>(csv[name]!) : []
  const names: CsvName[] = ['outlets', 'vehicles', 'calendar', 'district_travel', 'service_allowance', 'fleet_status']
  return {
    outlets: pick<OutletRow>('outlets'), vehicles: pick<VehicleRow>('vehicles'), calendar: pick<CalendarRow>('calendar'),
    districts: pick<DistrictTravelRow>('district_travel'), allowances: pick<ServiceAllowanceRow>('service_allowance'), fleet: pick<FleetStatusRow>('fleet_status'),
    sources: Object.fromEntries(names.map((name) => [name, csv[name]?.trim() ? 'csv' : 'missing'])) as Reference['sources'],
  }
}
