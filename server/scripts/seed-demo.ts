/**
 * Seed the demo delivery day into the configured store (Supabase when SUPABASE_URL is set, otherwise DATABASE_URL),
 * built from the competition CSVs in DATA_DIR. The CSVs stay on this machine; only the resulting operation is saved.
 *
 *   npm --prefix server run seed:demo              refuses to replace an operation that already has orders
 *   npm --prefix server run seed:demo -- --replace replaces it
 *
 * Afterwards a demo reset (DEMO_MODE=true) rebuilds the day from the stored rows, so the server needs no CSVs.
 */
import { seedDemoOps } from '@core/demo'
import { config } from '../src/config'
import { loadOps, persistState, transaction } from '../src/db'
import { readCatalog, readCsvs } from '../src/demo-data'

const required = ['outlets', 'vehicles', 'calendar', 'district_travel', 'service_allowance'] as const
const csv = readCsvs(config.dataDir)
const missing = required.filter((n) => !csv[n])
if (missing.length && !process.argv.includes('--placeholders')) {
  console.error(`Missing ${missing.map((n) => `${n}.csv`).join(', ')} in ${config.dataDir}. Add them, or pass --placeholders to seed placeholder data.`)
  process.exit(1)
}
const before = await loadOps()
if (before?.orders.length && !process.argv.includes('--replace')) {
  console.error(`The ${config.backend} operation already has ${before.orders.length} orders (version ${before.version}). Pass --replace to overwrite it.`)
  process.exit(1)
}
const next = seedDemoOps({ csv, catalog: readCatalog(config.dataDir) })
await persistState(before, next, transaction())
console.log(`Seeded the demo day into ${config.backend}: delivery ${next.deliveryDate}, ${next.outlets.length} outlets, ${next.vehicles.length} vehicles, ${next.orders.length} orders.`)
console.log(`Data sources: ${JSON.stringify(next.demoSource?.sources)}`)
process.exit(0)
