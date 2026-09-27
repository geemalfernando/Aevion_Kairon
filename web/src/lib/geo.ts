import { districtPosition } from '@core/reference'
import type { Depot, Outlet } from '@core/types'

export type LatLng = [number, number]

/** Real depot locations. */
export const DEPOT_GEO: Record<Depot, LatLng> = {
  Peliyagoda: [6.9606, 79.893],
  Kandy: [7.3187, 80.6291],
}

/** District centres, nudged inland on the coast so outlets never land in the sea. */
const CENTRE: Record<string, LatLng> = {
  Colombo: [6.895, 79.885],
  Gampaha: [7.06, 79.97],
  Kalutara: [6.63, 79.98],
  Galle: [6.07, 80.24],
  Matara: [5.96, 80.56],
  Puttalam: [8.03, 79.85],
  Kegalle: [7.25, 80.35],
  Ratnapura: [6.68, 80.4],
  Kandy: [7.2906, 80.6337],
  Matale: [7.47, 80.62],
  Kurunegala: [7.4818, 80.3609],
  'Nuwara Eliya': [6.97, 80.78],
}
const COASTAL = ['Colombo', 'Gampaha', 'Kalutara', 'Galle', 'Matara', 'Puttalam']

/** Known neighbourhoods for the demo story outlets. */
const PINNED: Record<string, LatLng> = {
  OUT032: [6.9147, 79.8784], // Borella
  OUT047: [6.9003, 79.8767], // Narahenpita
  OUT018: [6.8894, 79.8567], // Bambalapitiya
  OUT004: [6.9106, 79.8513], // Kollupitiya
  OUT056: [6.8779, 79.8783], // Kirulapone
  OUT043: [6.8511, 79.8659], // Dehiwala
}

/** Degrees per unit of the stylised network plane (outlets sit on a spiral a few units round each district centre). */
const SCALE = 0.012

/** Stylised plane → degrees, the inverse of the projection in core/reference (for districts without a centre). */
const unproject = (x: number, y: number): LatLng => [8.15 - (y * 2.3) / 100, 79.6 + (x * 1.3) / 100]

export function outletGeo(o: Outlet): LatLng {
  if (PINNED[o.id]) return PINNED[o.id]
  const d = districtPosition(o.district, o.depot)
  const [lat, lng] = CENTRE[o.district] ?? unproject(d.x, d.y)
  const dx = o.x - d.x
  const dy = o.y - d.y
  // On the west coast only spread eastwards (inland).
  const east = COASTAL.includes(o.district) ? Math.abs(dx) : dx
  return [lat - dy * SCALE, lng + east * SCALE]
}
