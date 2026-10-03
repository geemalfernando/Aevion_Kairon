/**
 * Replace the operation's outlets with outlets.csv alone, keeping districts, service allowances, vehicles,
 * users and the audit log. The current delivery day (orders, trips, plan, issues, predictions) belonged to the
 * old outlets, so it is cleared. Outlets whose district/depot has no travel row or whose brand/dock has no
 * service allowance cannot be planned and are skipped, never given invented values.
 *
 *   OUTLETS_CSV=path/to/outlets.csv node --import tsx scripts/import-outlets.ts [--dry-run]
 *   OUTLETS_S3_KEY=migration/outlets-….csv reads it from MEDIA_BUCKET instead (AWS one-off task; read-only filesystem).
 *   DRY_RUN_STATE=state.json reads the operation from a file instead of the database (with --dry-run).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { buildReference } from '@core/reference'
import { outletsFrom } from '@core/adapter'
import type { OpsData } from '@core/types'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config } from '../src/config'

const dryRun = process.argv.includes('--dry-run')
const key = process.env.OUTLETS_S3_KEY
if (key && !key.startsWith('migration/')) throw new Error('OUTLETS_S3_KEY must be under migration/')
const csvText = key
  ? await (await new S3Client({}).send(new GetObjectCommand({ Bucket: config.mediaBucket, Key: key }))).Body!.transformToString()
  : fs.readFileSync(process.env.OUTLETS_CSV ?? path.join(config.dataDir, 'outlets.csv'), 'utf8')
const db = dryRun && process.env.DRY_RUN_STATE ? undefined : await import('../src/db')
const before = (db ? await db.loadOps() : JSON.parse(fs.readFileSync(process.env.DRY_RUN_STATE!, 'utf8'))) as OpsData | null
if (!before) throw new Error('There is no operation to update')

const ref = buildReference({ outlets: csvText })
const plannable = (o: { district: string; depot: string; brand: string; dock: string }) =>
  before.districts.some((d) => d.district === o.district && d.depot === o.depot) &&
  before.allowances.some((a) => a.brand === o.brand && a.dock_type === o.dock)
const all = outletsFrom(ref, before.districts)
if (new Set(all.map((o) => o.id)).size !== all.length) throw new Error('outlets.csv has duplicate outlet IDs')
const outlets = all.filter(plannable)
const skipped = all.filter((o) => !plannable(o))
if (!outlets.length) throw new Error('No outlet in outlets.csv matches the operation\'s travel data')

const next = structuredClone(before)
Object.assign(next, { outlets, orders: [], trips: [], issues: [], plan: 'NONE', ordersClosed: false, predictions: { service: {}, demand: [] } })
delete (next as Partial<OpsData> & { analysis?: unknown }).analysis
next.audit.push({
  id: `a-${crypto.randomUUID()}`, entity: 'outlets', at: Date.now(), actor: 'SYSTEM',
  text: `Outlets replaced from outlets.csv: ${outlets.length} imported, ${skipped.length} skipped without travel data; delivery day cleared`,
})

const byDepot = (list: typeof outlets) => Object.entries(list.reduce<Record<string, number>>((m, o) => ({ ...m, [o.depot]: (m[o.depot] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ')
console.log(`outlets.csv: ${all.length} rows; importing ${outlets.length} (${byDepot(outlets)}); clearing ${before.orders.length} orders and ${before.trips.length} trips.`)
if (skipped.length) console.log(`Skipped without travel data or allowance: ${skipped.map((o) => `${o.id} ${o.district}/${o.depot}`).join(', ')}`)
if (dryRun) { console.log('Dry run: nothing saved.'); process.exit(0) }
await db!.persistState(before, next, db!.transaction())
console.log(`Saved operation version ${next.version}.`)
process.exit(0)
