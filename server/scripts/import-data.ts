/**
 * Explicit import of genuine reference data; preserves orders and other operational history.
 *
 *   Files from DATA_DIR, or from MEDIA_BUCKET under DATA_S3_PREFIX=migration/… (AWS one-off task; read-only filesystem).
 *   IMPORT_KEEP_CATALOG=true keeps the operation's current product catalogue instead of reading catalog.json.
 *   --dry-run validates and reports without saving; DRY_RUN_STATE=state.json reads the operation from a file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { buildReference } from '@core/reference'
import { districtsFrom, outletsFrom, vehiclesFrom } from '@core/adapter'
import { measure, type Catalog } from '@core/catalog'
import { seedOps } from '@core/ops'
import type { CsvName } from '@core/csv'
import type { OpsData } from '@core/types'
import { config } from '../src/config'

const dryRun = process.argv.includes('--dry-run')
const prefix = process.env.DATA_S3_PREFIX
if (prefix && !prefix.startsWith('migration/')) throw new Error('DATA_S3_PREFIX must be under migration/')
const read = async (file: string) => prefix
  ? (await (await new S3Client({}).send(new GetObjectCommand({ Bucket: config.mediaBucket, Key: `${prefix.replace(/\/?$/, '/')}${file}` }))).Body!.transformToString())
  : fs.readFileSync(path.join(config.dataDir, file), 'utf8')

const names: CsvName[] = ['outlets', 'vehicles', 'calendar', 'district_travel', 'service_allowance', 'fleet_status']
const csv = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await read(`${name}.csv`)] as const)))
const ref = buildReference(csv)
const db = dryRun && process.env.DRY_RUN_STATE ? undefined : await import('../src/db')
const before = (db ? await db.loadOps() : JSON.parse(fs.readFileSync(process.env.DRY_RUN_STATE!, 'utf8'))) as OpsData | null
const keepCatalog = process.env.IMPORT_KEEP_CATALOG === 'true'
if (keepCatalog && !before?.catalog) throw new Error('IMPORT_KEEP_CATALOG needs an existing operation with a catalogue')
const catalog = (keepCatalog ? before!.catalog : JSON.parse(await read('catalog.json'))) as Catalog
for (const [brand, groups] of Object.entries(catalog)) {
  if (!['Fresh', 'Style', 'Tech'].includes(brand) || !groups || !Array.isArray(groups.ambient) || !Array.isArray(groups.chilled)) throw new Error('Invalid catalogue brand or groups')
  const names = new Set<string>()
  for (const p of [...groups.ambient, ...groups.chilled]) {
    if (p.length !== 4 || !p[0] || !p[1] || !Number.isFinite(p[2]) || p[2] <= 0 || !Number.isFinite(p[3]) || p[3] <= 0 || names.has(p[0])) throw new Error(`Invalid or duplicate product in ${brand}`)
    names.add(p[0])
    measure(brand as keyof Catalog, [{ name: p[0], unit: p[1], qty: 1 }], catalog)
  }
}
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
// demoSource is what /api/health reports and what a staging demo reset rebuilds from, so it must name the imported data.
const demoSource = { outlets: ref.outlets, vehicles: ref.vehicles, districts: ref.districts, fleet: ref.fleet, sources: ref.sources }
Object.assign(next, { districts, outlets, vehicles, calendar: ref.calendar, allowances: ref.allowances, catalog, demoSource })
const lastDate = ref.calendar.at(-1)?.date
console.log(`Importing ${outlets.length} outlets, ${vehicles.length} vehicles (${vehicles.filter((v) => v.status === 'IN_WORKSHOP').length} in workshop), ${districts.length} districts, ${ref.calendar.length} calendar days to ${lastDate}${keepCatalog ? ', current catalogue kept' : ''}; preserving ${next.orders.length} orders.`)
if (dryRun) { console.log('Dry run: nothing saved.'); process.exit(0) }
await db!.persistState(before, next, db!.transaction())
console.log(`Saved operation version ${next.version}.`)
process.exit(0)
