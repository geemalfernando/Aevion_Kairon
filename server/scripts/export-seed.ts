/**
 * Writes the demo delivery day that `docker compose up` seeds (SEED_DEMO_DAY=true) to data/seed/:
 *   demo-day.json  the operation, as stored in kairon_state.data
 *   demo-day.sql   loads it into the local stack, replacing the current operation:
 *                  docker compose exec -T database psql -U kairon -d kairon < data/seed/demo-day.sql
 * Uses the same inputs as the backend: competition CSVs and catalog.json under DATA_DIR, otherwise placeholders.
 * data/seed/ is git-ignored, because with real CSVs the seed contains the confidential datasets.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Catalog } from '@core/catalog'
import { seedDemoOps } from '@core/demo'
import { config } from '../src/config'
import { readCsvs } from '../src/demo-data'

const csv = readCsvs(config.dataDir)
const catalogFile = path.join(config.dataDir, 'catalog.json')
const catalog = fs.existsSync(catalogFile) ? (JSON.parse(fs.readFileSync(catalogFile, 'utf8')) as Catalog) : undefined
const ops = seedDemoOps({ csv, catalog })
ops.version = 1

const out = path.join(config.dataDir, 'seed')
fs.mkdirSync(out, { recursive: true })
const json = JSON.stringify(ops)
fs.writeFileSync(path.join(out, 'demo-day.json'), JSON.stringify(ops, null, 2) + '\n')
// The row version moves forward (never back), so running servers and devices treat the seed as the newest state.
fs.writeFileSync(
  path.join(out, 'demo-day.sql'),
  `-- Kairon demo delivery day for ${ops.deliveryDate}, generated ${new Date().toISOString()}.
-- Replaces the current operation in the local stack:
--   docker compose exec -T database psql -U kairon -d kairon < data/seed/demo-day.sql
begin;
insert into kairon_state (id, version, data) values (1, 1, $kairon_seed$${json}$kairon_seed$::jsonb)
on conflict (id) do update set
  version = kairon_state.version + 1,
  data = jsonb_set(excluded.data, '{version}', to_jsonb(kairon_state.version + 1)),
  updated_at = now();
commit;
`,
)
const sources = Object.keys(csv).length ? `CSVs: ${Object.keys(csv).join(', ')}` : 'placeholder data (no CSVs in data/)'
console.log(`Wrote ${path.relative(process.cwd(), out)}/demo-day.json and demo-day.sql`)
console.log(`Delivery ${ops.deliveryDate}: ${ops.outlets.length} outlets, ${ops.vehicles.length} vehicles, ${ops.orders.length} orders, from ${sources}`)
