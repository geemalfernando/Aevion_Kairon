/**
 * Adapter from CSV rows (csv.ts) to the app model (types.ts). This is the only place that knows both shapes.
 */
import type { OutletRow, VehicleRow } from './csv'
import { districtPosition, type Reference } from './reference'
import { parseHM, parseWindow, type Minutes } from './time'
import type { DistrictInfo, Outlet, Vehicle, VehicleType } from './types'

export function vehicleType(v: Pick<VehicleRow, 'type' | 'temp'>): VehicleType {
  return v.temp === 'reefer' ? (v.type === 'van' ? 'REEFER_VAN' : 'REEFER_TRUCK') : v.type === 'van' ? 'VAN' : 'TRUCK'
}

/** The window a delivery has to hit: the requested window narrowed by the mall's access window. */
export function effectiveWindow(requested: [Minutes, Minutes], mall?: [Minutes, Minutes]): [Minutes, Minutes] {
  if (!mall) return requested
  const open = Math.max(requested[0], mall[0])
  const close = Math.min(requested[1], mall[1])
  // Data where the two never overlap: the mall window wins, because security will not admit the vehicle otherwise.
  return open < close ? [open, close] : mall
}

export function districtsFrom(ref: Reference): DistrictInfo[] {
  return ref.districts.map((d) => ({ ...d, ...districtPosition(d.district, d.depot) }))
}

export function outletFromRow(row: OutletRow, _i: number, pos: { x: number; y: number }, extra: Partial<Outlet> = {}): Outlet {
  const requested: [Minutes, Minutes] = [parseHM(row.window_open_time), parseHM(row.window_close_time)]
  const mallWindow = row.parking_constraint === 'mall_dock' ? parseWindow(row.mall_window) : undefined
  return {
    id: row.outlet_id,
    name: row.name || row.outlet_id,
    latitude: row.latitude == null ? undefined : Number(row.latitude),
    longitude: row.longitude == null ? undefined : Number(row.longitude),
    brand: row.brand,
    district: row.district,
    depot: row.depot,
    dock: row.dock_type,
    parking: row.parking_constraint,
    mallWindow,
    requestedWindow: requested,
    window: effectiveWindow(requested, mallWindow),
    vanOnly: row.parking_constraint === 'van_only',
    mall: row.parking_constraint === 'mall_dock',
    x: pos.x,
    y: pos.y,
    lastServedDaysAgo: 0,
    deferralsThisWeek: 0,
    deferredYesterday: false,
    manager: row.manager || '',
    ...extra,
  }
}

export function outletsFrom(ref: Reference, districts: DistrictInfo[]): Outlet[] {
  const perDistrict: Record<string, number> = {}
  const outlets = ref.outlets.map((row) => {
    const d = districts.find((x) => x.district === row.district)
    const centre = d ?? { ...districtPosition(row.district, row.depot) }
    const k = (perDistrict[row.district] = (perDistrict[row.district] ?? -1) + 1)
    // Spread outlets on a small spiral around the district centre so they don't overlap on the map.
    const angle = k * 2.399
    const radius = 1.2 + Math.sqrt(k) * (row.district === 'Colombo' ? 1.15 : 1.35)
    const pos = { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius }
    return outletFromRow(row, k, pos)
  })
  return outlets
}

export function vehiclesFrom(ref: Reference): Vehicle[] {
  const status = new Map(ref.fleet.map((f) => [f.vehicle_id, f.status]))
  return ref.vehicles.map((row) => {
    return {
      id: row.vehicle_id,
      kind: row.type,
      temp: row.temp,
      type: vehicleType(row),
      depot: row.depot,
      capacityKg: Number(row.weight_cap_kg),
      capacityM3: Number(row.volume_cap_m3),
      fuelType: row.fuel_type,
      kmPerL: Number(row.km_per_l),
      fuelQuotaL: Number(row.weekly_fuel_quota_l),
      fuelUsedL: 0,
      status: status.get(row.vehicle_id) === 'in_workshop' ? 'IN_WORKSHOP' : 'AVAILABLE',
      driver: '',
    }
  })
}
