/**
 * The authoritative operation. State is held in memory for fast reads and rebuilt from PostgreSQL on boot;
 * every write runs the shared core command/event on a draft, persists the difference in one transaction,
 * and only then becomes visible. Writes are serialised so concurrent devices can't interleave half-applied changes.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CsvName } from '@core/csv'
import { applyEvent, COMMAND_ROLES, commands, EVENT_ROLES, seedOps, type ApplyResult, type CommandName } from '@core/ops'
import { buildReference, type Reference } from '@core/reference'
import { byId } from '@core/rules'
import type { FieldEvent, OpsData, QueuedEvent } from '@core/types'
import type { Session } from './auth'
import { seedUsers } from './auth'
import { config } from './config'
import { clearOperation, loadOps, persistDiff, pool, saveReference, tx, type Tx } from './db'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.catch(() => undefined)
    return next
  }
}

type Logger = { info: (m: string | object, msg?: string) => void; warn: (m: string | object, msg?: string) => void }

const CSV_FILES: Record<CsvName, string[]> = {
  outlets: ['outlets.csv'],
  vehicles: ['vehicles.csv'],
  calendar: ['calendar.csv'],
  district_travel: ['district_travel.csv'],
  service_allowance: ['service_allowance.csv'],
  fleet_status: ['fleet_status.csv'],
}

export interface EventResult extends ApplyResult {
  id: string
}

export class Operation {
  private state!: OpsData
  private lock = new Mutex()
  private listeners = new Set<(version: number) => void>()
  sources: Reference['sources'] | null = null

  constructor(private log: Logger) {}

  get data() {
    return this.state
  }

  subscribe(fn: (version: number) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const l of this.listeners) l(this.state.version)
  }

  async init(reseed: boolean) {
    const existing = reseed ? null : await loadOps()
    if (existing) {
      this.state = existing
      this.log.info(`Loaded operation for ${existing.deliveryDate} (version ${existing.version})`)
      return
    }
    await this.reset()
  }

  /** Find the competition CSVs anywhere under DATA_DIR (the datasets ship in sub-folders such as "General Data/"). */
  private readCsvs(): Partial<Record<CsvName, string>> {
    const found: Partial<Record<CsvName, string>> = {}
    const walk = (dir: string, depth = 0) => {
      if (depth > 3 || !fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(p, depth + 1)
        for (const [name, files] of Object.entries(CSV_FILES) as [CsvName, string[]][]) if (files.includes(entry.name.toLowerCase()) && !found[name]) found[name] = fs.readFileSync(p, 'utf8')
      }
    }
    walk(config.dataDir)
    return found
  }

  async reset() {
    return this.lock.run(async () => {
      const ref = buildReference(this.readCsvs())
      this.sources = ref.sources
      const next = seedOps({ reference: ref })
      await tx(async (c) => {
        await clearOperation(c)
        await seedUsers(c)
        await saveReference(c, next)
        await persistDiff(c, null, next)
      })
      this.state = next
      this.emit()
      this.log.info({ sources: ref.sources, deliveryDate: next.deliveryDate, orders: next.orders.length }, 'Seeded operation')
    })
  }

  touch(email: string) {
    if (this.state) this.state.presence[email] = Date.now()
  }

  /** Run one mutation on a draft, persist the difference, then publish it. */
  private mutate<T>(fn: (draft: OpsData, c: Tx) => Promise<T> | T): Promise<T> {
    return this.lock.run(async () => {
      const before = this.state
      const draft = structuredClone(before)
      const out = await tx(async (c) => {
        const r = await fn(draft, c)
        await persistDiff(c, before, draft)
        return r
      })
      this.state = draft
      this.emit()
      return out
    })
  }

  async command(user: Session, name: string, args: unknown[]) {
    if (!Object.hasOwn(commands, name)) throw new HttpError(404, `Unknown command ${name}`)
    const cmd = name as CommandName
    const allowed = COMMAND_ROLES[cmd]
    if (allowed === 'demo' ? !config.demoMode : !allowed.includes(user.role)) throw new HttpError(403, `${user.role} may not run ${name}`)
    const a = [...args]
    // Scope store managers to their own outlet; identity-bearing commands use the session, not the body.
    const ownOrder = (orderId: unknown) => {
      const o = byId(this.state.orders, String(orderId))
      if (!o || o.outletId !== user.assignedOutlet) throw new HttpError(403, 'Not your outlet’s order')
    }
    if (cmd === 'createOrder' && a[0] !== user.assignedOutlet) throw new HttpError(403, 'You can only order for your own outlet')
    if (cmd === 'confirmReceipt' || cmd === 'storeIssue' || cmd === 'acknowledgeDeferral') ownOrder(a[0])
    if (cmd === 'heartbeat') a[0] = user.email
    if (cmd === 'markRead') a[0] = user.role
    if (cmd === 'recordSync') a[0] = { ...(a[0] as object), email: user.email, name: user.name, role: user.role, vehicleId: user.assignedVehicle }
    return this.mutate((d) => {
      d.presence[user.email] = Date.now()
      return (commands[cmd] as (d: OpsData, ...rest: unknown[]) => unknown)(d, ...a)
    })
  }

  /** Why this user may not record this event (or undefined when they may). */
  private forbid(user: Session, e: FieldEvent, d: OpsData): string | undefined {
    if (!EVENT_ROLES[e.type].includes(user.role)) return `${user.role} cannot record ${e.type}`
    if (user.role === 'DRIVER') {
      const vehicleOfTrip = (id: string) => byId(d.trips, id)?.vehicleId
      const vehicle =
        e.type === 'VEHICLE_ISSUE' ? e.vehicleId : e.type === 'PROOF' ? vehicleOfTrip(byId(d.orders, e.orderId)?.tripId ?? '') ?? user.assignedVehicle : 'tripId' in e ? vehicleOfTrip(e.tripId) : undefined
      if (vehicle !== user.assignedVehicle) return 'Not your vehicle'
    }
    if (user.role === 'LOADER') {
      const tripId = 'tripId' in e ? e.tripId : byId(d.orders, 'orderId' in e ? e.orderId : '')?.tripId
      const v = byId(d.vehicles, byId(d.trips, tripId ?? '')?.vehicleId)
      if (v && v.depot !== user.depot) return 'Trip belongs to another depot'
    }
    return undefined
  }

  /** Photos and signatures are stored as media rows; the event keeps a URL instead of a data URL. */
  private async extractMedia(c: Tx, e: FieldEvent): Promise<FieldEvent> {
    const store = async (dataUrl: string | undefined, kind: string, orderId: string) => {
      const m = dataUrl && /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl)
      if (!m) return dataUrl
      const id = crypto.randomBytes(16).toString('hex')
      await c.query('insert into media (id, order_id, kind, content_type, data) values ($1, $2, $3, $4, $5)', [id, orderId, kind, m[1], Buffer.from(m[2], 'base64')])
      return `/api/media/${id}`
    }
    if (e.type === 'PROOF') return { ...e, photo: await store(e.photo, 'photo', e.orderId), signature: await store(e.signature, 'signature', e.orderId) }
    if (e.type === 'SHORTFALL') return { ...e, photo: await store(e.photo, 'shortfall', e.orderId) }
    return e
  }

  /**
   * Replay a device's outbox. Each event id is recorded, so resending the same outbox is harmless.
   * When the device was offline, a sync report tells the dispatcher what arrived and what collided.
   */
  async events(user: Session, list: QueuedEvent[], sync?: { offlineFrom?: number; routeChanged?: boolean }): Promise<EventResult[]> {
    if (!Array.isArray(list) || list.length > 500) throw new HttpError(400, 'Send between 1 and 500 events')
    return this.mutate(async (d, c) => {
      const ids = list.map((q) => q.id)
      const seen = new Set((await c.query('select id from field_events where id = any($1)', [ids])).rows.map((r) => r.id as string))
      const results: EventResult[] = []
      for (const q of list) {
        if (seen.has(q.id)) {
          results.push({ id: q.id, status: 'duplicate' })
          continue
        }
        const why = this.forbid(user, q.event, d)
        const event = why ? q.event : await this.extractMedia(c, q.event)
        const r: ApplyResult = why ? { status: 'rejected', message: why } : applyEvent(d, { actor: user.role, event, at: q.at })
        results.push({ id: q.id, ...r })
        await c.query('insert into field_events (id, user_email, actor, type, payload, occurred_at, result, message) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing', [
          q.id,
          user.email,
          user.role,
          q.event.type,
          JSON.stringify(event),
          new Date(q.at).toISOString(),
          r.status,
          r.message ?? null,
        ])
      }
      if (sync?.offlineFrom && (user.role === 'DRIVER' || user.role === 'LOADER')) {
        const applied = results.filter((r) => r.status === 'applied')
        const conflicts = list.filter((q, i) => results[i].conflict && 'orderId' in q.event).map((q) => (q.event as { orderId: string }).orderId)
        commands.recordSync(d, {
          email: user.email,
          name: user.name,
          role: user.role,
          vehicleId: user.assignedVehicle,
          offlineFrom: sync.offlineFrom,
          events: applied.length,
          deliveries: list.filter((q, i) => q.event.type === 'DELIVER' && results[i].status === 'applied').length,
          conflicts: [...new Set(conflicts)],
          routeChanged: !!sync.routeChanged,
        })
      }
      d.presence[user.email] = Date.now()
      return results
    })
  }

  async media(id: string) {
    const r = await pool.query('select content_type, data from media where id = $1', [id])
    return r.rows[0] as { content_type: string; data: Buffer } | undefined
  }
}
