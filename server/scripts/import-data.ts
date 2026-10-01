/** Explicit import of genuine reference data; preserves orders and other operational history. */
import fs from 'node:fs'
import path from 'node:path'
import { buildReference } from '@core/reference'
import { districtsFrom, outletsFrom, vehiclesFrom } from '@core/adapter'
import { measure, type Catalog } from '@core/catalog'
import { seedOps } from '@core/ops'
import type { CsvName } from '@core/csv'
import { loadOps, persistState, transaction } from '../src/db'
import { config } from '../src/config'

const names: CsvName[] = ['outlets', 'vehicles', 'calendar', 'district_travel', 'service_allowance', 'fleet_status']
const csv = Object.fromEntries(names.map((name) => [name, fs.readFileSync(path.join(config.dataDir, `${name}.csv`), 'utf8')]))
const ref = buildReference(csv)
const catalog = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'catalog.json'), 'utf8')) as Catalog
for (const [brand, groups] of Object.entries(catalog)) {
  if (!['Fresh', 'Style', 'Tech'].includes(brand) || !groups || !Array.isArray(groups.ambient) || !Array.isArray(groups.chilled)) throw new Error('Invalid catalogue brand or groups')
  const names = new Set<string>()
  for (const p of [...groups.ambient, ...groups.chilled]) {
    if (p.length !== 4 || !p[0] || !p[1] || !Number.isFinite(p[2]) || p[2] <= 0 || !Number.isFinite(p[3]) || p[3] <= 0 || names.has(p[0])) throw new Error(`Invalid or duplicate product in ${brand}`)
    names.add(p[0])
    measure(brand as keyof Catalog, [{ name: p[0], unit: p[1], qty: 1 }], catalog)
  }
}
const before = await loadOps()
const next = structuredClone(before ?? seedOps())
const districts = districtsFrom(ref)
const outlets = outletsFrom(ref, districts)
const vehicles = vehiclesFrom(ref)
for (const o of next.orders) if (!outlets.some((outlet) => outlet.id === o.outletId)) throw new Error(`Import removes outlet used by order ${o.id}`)
for (const t of next.trips) if (!vehicles.some((v) => v.id === t.vehicleId)) throw new Error(`Import removes vehicle used by trip ${t.id}`)
for (const o of outlets) {
  if (!districts.some((d) => d.district === o.district && d.depot === o.depot)) throw new Error(`Missing district travel for ${o.id}`)
  if (!ref.allowances.some((a) => a.brand === o.brand && a.dock_type === o.dock)) throw new Error(`Missing service allowance for ${o.id}`)
  const existing = next.outlets.find((x) => x.id === o.id)
  if (existing) Object.assign(o, { lastServedDaysAgo: existing.lastServedDaysAgo, deferralsThisWeek: existing.deferralsThisWeek, deferredYesterday: existing.deferredYesterday, manager: existing.manager })
}
for (const v of vehicles) {
  const existing = next.vehicles.find((x) => x.id === v.id)
  if (existing) Object.assign(v, { fuelUsedL: existing.fuelUsedL, driver: existing.driver })
}
Object.assign(next, { districts, outlets, vehicles, calendar: ref.calendar, allowances: ref.allowances, catalog })
await persistState(before, next, transaction())
console.log(`Imported ${outlets.length} outlets and ${vehicles.length} vehicles; preserved ${next.orders.length} orders.`)
