import type { Depot, Outlet } from '@core/types'

export type LatLng = [number, number]

/** Real depot locations. */
export const DEPOT_GEO: Record<Depot, LatLng> = {
  Peliyagoda: [6.9606, 79.893],
  Kandy: [7.3187, 80.6291],
}

export const hasCoordinates = (o: Outlet) => Number.isFinite(o.latitude) && Number.isFinite(o.longitude) && Math.abs(o.latitude!) <= 90 && Math.abs(o.longitude!) <= 180
export function outletGeo(o: Outlet): LatLng {
  if (!hasCoordinates(o)) throw new Error('Outlet coordinates have not been imported')
  return [o.latitude!, o.longitude!]
}
