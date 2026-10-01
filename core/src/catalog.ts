import type { CalendarRow } from './csv'
import { addDays, colomboDate, colomboMinutes, colomboTs, dowOf, hm } from './time'
import type { Brand, OrderItem, Temp } from './types'

/** Orders for the next run close at 16:00. */
export const ORDER_CUTOFF = hm(16)

// ---------------------------------------------------------------------------
// Catalogue: name, unit, m³ per unit, kg per unit
// ---------------------------------------------------------------------------

export type Product = [name: string, unit: string, m3: number, kg: number]

const CATALOG: Record<Brand, { chilled: Product[]; ambient: Product[] }> = {
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
  // Heavy, fragile, valuable — often a single large item.
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

export const catalogFor = (brand: Brand) => CATALOG[brand]

const productOf = (brand: Brand, name: string) => [...CATALOG[brand].chilled, ...CATALOG[brand].ambient].find((p) => p[0] === name)

export const isChilledItem = (brand: Brand, name: string) => CATALOG[brand].chilled.some((p) => p[0] === name)

export function measure(brand: Brand, items: OrderItem[]) {
  let v = 0
  let w = 0
  let units = 0
  for (const it of items) {
    const p = productOf(brand, it.name)
    if (!p || it.qty <= 0) continue
    v += p[2] * it.qty
    w += p[3] * it.qty
    units += it.qty
  }
  return { volumeM3: Math.round(v * 100) / 100, weightKg: Math.round(w), units }
}

/**
 * Fresh chilled and dry goods travel as separate orders (separate vehicles: chilled needs a reefer),
 * so a basket is split by temperature. Style and Tech are always ambient.
 */
export function splitByTemp(brand: Brand, items: OrderItem[]): { temp: Temp; items: OrderItem[] }[] {
  const clean = items.filter((i) => i.qty > 0)
  const chilled = clean.filter((i) => isChilledItem(brand, i.name))
  const ambient = clean.filter((i) => !isChilledItem(brand, i.name))
  return [
    ...(chilled.length ? [{ temp: 'CHILLED' as Temp, items: chilled }] : []),
    ...(ambient.length ? [{ temp: 'AMBIENT' as Temp, items: ambient }] : []),
  ]
}

// ---------------------------------------------------------------------------
// Calendar rules: Monday–Saturday operation (per calendar.csv) and the 16:00 cutoff
// ---------------------------------------------------------------------------

export const calRow = (cal: CalendarRow[], date: string) => cal.find((c) => c.date === date)

/** Uses calendar.csv when the date is in it; otherwise Monday–Saturday. */
export function isOperating(cal: CalendarRow[], date: string) {
  const row = calRow(cal, date)
  return row ? row.is_operating === 1 : dowOf(date) <= 5
}

export function nextOperatingDay(cal: CalendarRow[], date: string): string {
  let d = addDays(date, 1)
  for (let i = 0; i < 14 && !isOperating(cal, d); i++) d = addDays(d, 1)
  return d
}

export function prevOperatingDay(cal: CalendarRow[], date: string): string {
  let d = addDays(date, -1)
  for (let i = 0; i < 14 && !isOperating(cal, d); i++) d = addDays(d, -1)
  return d
}

/** Which run an order placed at `now` joins: the next operating day, or the one after if it's past 16:00. */
export function runForOrderPlacedAt(cal: CalendarRow[], now: number): { date: string; afterCutoff: boolean; cutoffTs: number } {
  const today = colomboDate(now)
  const afterCutoff = colomboMinutes(now) >= ORDER_CUTOFF
  const first = nextOperatingDay(cal, today)
  return { date: afterCutoff ? nextOperatingDay(cal, first) : first, afterCutoff, cutoffTs: colomboTs(today, ORDER_CUTOFF) }
}
