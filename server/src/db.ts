import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { OpsData } from '@core/types'
import { config } from './config'

// NUMERIC comes back as a string by default; the domain uses numbers.
pg.types.setTypeParser(1700, (v) => Number(v))
// DATE stays a plain YYYY-MM-DD string (no time-zone shifts).
pg.types.setTypeParser(1082, (v) => v)

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
export type Tx = pg.PoolClient

const here = path.dirname(fileURLToPath(import.meta.url))

export async function waitForDb(log: (m: string) => void, attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('select 1')
      return
    } catch (e) {
      if (i >= attempts) throw e
      log(`Database not ready (attempt ${i}/${attempts}) — retrying`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

export async function migrate() {
  await pool.query(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'))
}

export async function tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const out = await fn(c)
    await c.query('commit')
    return out
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

// ---------------------------------------------------------------------------
// Entity tables: typed columns for querying + the full document for rebuilding state
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
interface EntityTable<T> {
  key: keyof OpsData
  table: string
  pk: string
  row: (x: T) => Row
  id: (x: T) => string
}

const ts = (ms?: number) => new Date(ms ?? Date.now()).toISOString()

/* eslint-disable @typescript-eslint/no-explicit-any */
const ENTITIES: EntityTable<any>[] = [
  {
    key: 'outlets',
    table: 'outlets',
    pk: 'outlet_id',
    id: (o) => o.id,
    row: (o) => ({
      outlet_id: o.id,
      brand: o.brand,
      district: o.district,
      depot: o.depot,
      dock_type: o.dock,
      parking_constraint: o.parking,
      mall_window: o.mallWindow ? `${hhmm(o.mallWindow[0])}-${hhmm(o.mallWindow[1])}` : '',
      window_open_time: hhmm(o.requestedWindow[0]),
      window_close_time: hhmm(o.requestedWindow[1]),
      doc: o,
    }),
  },
  {
    key: 'vehicles',
    table: 'vehicles',
    pk: 'vehicle_id',
    id: (v) => v.id,
    row: (v) => ({ vehicle_id: v.id, type: v.kind, temp: v.temp, weight_cap_kg: v.capacityKg, volume_cap_m3: v.capacityM3, fuel_type: v.fuelType, km_per_l: v.kmPerL, weekly_fuel_quota_l: v.fuelQuotaL, depot: v.depot, status: v.status, reserve: !!v.reserve, doc: v }),
  },
  {
    key: 'orders',
    table: 'orders',
    pk: 'id',
    id: (o) => o.id,
    row: (o) => ({ id: o.id, outlet_id: o.outletId, brand: o.brand, temp: o.temp, delivery_date: o.deliveryDate, status: o.status, trip_id: o.tripId ?? null, priority: o.priority, units: o.units, volume_m3: o.volumeM3, weight_kg: o.weightKg, doc: o }),
  },
  {
    key: 'trips',
    table: 'trips',
    pk: 'id',
    id: (t) => t.id,
    row: (t) => ({ id: t.id, vehicle_id: t.vehicleId, number: t.number, brand: t.brand, district: t.district, departure_min: Math.round(t.departure), status: t.status, doc: t }),
  },
  { key: 'issues', table: 'issues', pk: 'id', id: (i) => i.id, row: (i) => ({ id: i.id, kind: i.kind, severity: i.severity, created_at: ts(i.createdAt), resolved: !!i.resolved, doc: i }) },
  { key: 'notifications', table: 'notifications', pk: 'id', id: (n) => n.id, row: (n) => ({ id: n.id, at: ts(n.at), doc: n }) },
  { key: 'audit', table: 'audit_events', pk: 'id', id: (a) => a.id, row: (a) => ({ id: a.id, entity: a.entity, at: ts(a.at), actor: a.actor, text: a.text }) },
  { key: 'syncLog', table: 'sync_reports', pk: 'id', id: (s) => s.id, row: (s) => ({ id: s.id, email: s.email, synced_at: ts(s.syncedAt), doc: s }) },
]
/* eslint-enable @typescript-eslint/no-explicit-any */

const META_KEYS = ['version', 'deliveryDate', 'clock', 'ordersClosed', 'plan', 'presence', 'predictions', 'analysis'] as const

function hhmm(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`
}

async function upsert(c: Tx, table: string, pk: string, rows: Row[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  // Chunk to stay well under Postgres' 65k parameter limit.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const values: unknown[] = []
    const tuples = chunk.map((r) => `(${cols.map((k) => (values.push(k === 'doc' ? JSON.stringify(r[k]) : r[k]), `$${values.length}`)).join(', ')})`)
    const set = cols.filter((k) => k !== pk).map((k) => `${k} = excluded.${k}`)
    await c.query(`insert into ${table} (${cols.join(', ')}) values ${tuples.join(', ')} on conflict (${pk}) do ${set.length ? `update set ${set.join(', ')}` : 'nothing'}`, values)
  }
}

/** Persist only what changed between two versions of the operation. */
export async function persistDiff(c: Tx, before: OpsData | null, after: OpsData) {
  for (const e of ENTITIES) {
    const prev = new Map(((before?.[e.key] as unknown[]) ?? []).map((x) => [e.id(x), JSON.stringify(x)]))
    const next = after[e.key] as unknown[]
    const changed = next.filter((x) => prev.get(e.id(x)) !== JSON.stringify(x))
    await upsert(c, e.table, e.pk, changed.map(e.row))
    const nextIds = new Set(next.map(e.id))
    const removed = [...prev.keys()].filter((id) => !nextIds.has(id))
    if (removed.length) await c.query(`delete from ${e.table} where ${e.pk} = any($1)`, [removed])
  }
  const meta = Object.fromEntries(META_KEYS.map((k) => [k, after[k] ?? null]))
  await c.query(`insert into app_meta (key, value, updated_at) values ('ops', $1, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(meta)])
}

export async function saveReference(c: Tx, d: OpsData) {
  await c.query('delete from district_travel; delete from service_allowance; delete from calendar')
  await upsert(c, 'district_travel', 'district', d.districts.map(({ x: _x, y: _y, ...row }) => row))
  for (const a of d.allowances) await c.query('insert into service_allowance (brand, dock_type, service_allowance_min) values ($1, $2, $3)', [a.brand, a.dock_type, a.service_allowance_min])
  await upsert(c, 'calendar', 'date', d.calendar as unknown as Row[])
}

/** Rebuild the in-memory operation from the database, or null when nothing has been seeded yet. */
export async function loadOps(): Promise<OpsData | null> {
  const meta = await pool.query(`select value from app_meta where key = 'ops'`)
  if (!meta.rowCount) return null
  const docs = async (table: string, order = '') => (await pool.query(`select doc from ${table} ${order}`)).rows.map((r) => r.doc)
  const districts = (await pool.query('select * from district_travel')).rows
  const { districtPosition } = await import('@core/reference')
  return {
    ...meta.rows[0].value,
    outlets: await docs('outlets', 'order by outlet_id'),
    vehicles: await docs('vehicles', 'order by vehicle_id'),
    districts: districts.map((d) => ({ ...d, ...districtPosition(d.district, d.depot) })),
    allowances: (await pool.query('select * from service_allowance')).rows,
    calendar: (await pool.query(`select to_char(date, 'YYYY-MM-DD') as date, dow, dow_name, is_weekend, iso_year, iso_week, is_payday, festival, festival_ramp, is_holiday, monsoon, is_operating from calendar order by date`)).rows,
    orders: await docs('orders', 'order by id'),
    trips: await docs('trips', 'order by id'),
    issues: await docs('issues', 'order by created_at desc'),
    notifications: await docs('notifications', 'order by at desc'),
    audit: (await pool.query('select id, entity, extract(epoch from at) * 1000 as at, actor, text from audit_events order by at')).rows.map((r) => ({ ...r, at: Number(r.at) })),
    syncLog: await docs('sync_reports', 'order by synced_at desc'),
  } as OpsData
}

export async function clearOperation(c: Tx) {
  await c.query('truncate orders, trips, issues, notifications, audit_events, sync_reports, field_events, media, app_meta')
  await c.query('delete from outlets; delete from vehicles')
}
