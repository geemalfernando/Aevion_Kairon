/**
 * The authoritative operation. State is held in memory for fast reads and rebuilt from PostgreSQL on boot;
 * every write runs the shared core command/event on a draft, persists the difference in one transaction,
 * and only then becomes visible. Writes are serialised so concurrent devices can't interleave half-applied changes.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Catalog } from '@core/catalog'
import type { CsvName } from '@core/csv'
import { buildDemoReference, seedDemoOps } from '@core/demo'
import { applyEvent, COMMAND_ROLES, commands, EVENT_ROLES, seedOps, type ApplyResult, type CommandName } from '@core/ops'
import type { Reference } from '@core/reference'
import { byId } from '@core/rules'
import type { FieldEvent, OpsData, QueuedEvent } from '@core/types'
import type { Session } from './auth'
import { config } from './config'
import { loadOps, persistState, transaction, seenEvents, loadMedia, type Tx } from './db'

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

const repository = { loadOps, persistState, transaction, seenEvents, loadMedia }
const CSV_NAMES: CsvName[] = ['outlets', 'vehicles', 'calendar', 'district_travel', 'service_allowance', 'fleet_status']

/** Find the competition CSVs anywhere under DATA_DIR (the datasets ship in sub-folders such as "General Data/"). */
function readCsvs(dir: string): Partial<Record<CsvName, string>> {
  const found: Partial<Record<CsvName, string>> = {}
  const walk = (d: string, depth = 0) => {
    if (depth > 3 || !fs.existsSync(d)) return
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) walk(p, depth + 1)
      const name = CSV_NAMES.find((n) => `${n}.csv` === entry.name.toLowerCase())
      if (name && !found[name]) found[name] = fs.readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return found
}
export interface EventResult extends ApplyResult {
  id: string
}

export class Operation {
  private state!: OpsData
  private presence: Record<string, number> = {}
  private lock = new Mutex()
  private listeners = new Set<(version: number) => void>()
  sources: Reference['sources'] | null = null

  constructor(private log: Logger, private db = repository) {}

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

  async init() {
    const existing = await this.db.loadOps()
    if (existing) {
      this.state = existing
      if (config.seedDemoDay) this.sources = buildDemoReference(readCsvs(config.dataDir)).sources
      this.log.info(`Loaded operation for ${existing.deliveryDate} (version ${existing.version})`)
      return
    }
    await this.reset()
  }

  /**
   * The starting operation. Normally empty (reference data comes from `npm run import:data`). With SEED_DEMO_DAY=true:
   * one realistic delivery day, built from the competition CSVs in DATA_DIR when present, otherwise placeholders.
   */
  private seed(): OpsData {
    if (!config.seedDemoDay) return seedOps()
    const csv = readCsvs(config.dataDir)
    const catalogFile = path.join(config.dataDir, 'catalog.json')
    const catalog = fs.existsSync(catalogFile) ? (JSON.parse(fs.readFileSync(catalogFile, 'utf8')) as Catalog) : undefined
    this.sources = buildDemoReference(csv).sources
    return seedDemoOps({ csv, catalog })
  }

  private async reset() {
    const next = this.seed()
    await this.db.persistState(null, next, this.db.transaction())
    this.state = next
    this.log.info(config.seedDemoDay ? { sources: this.sources, deliveryDate: next.deliveryDate, orders: next.orders.length } : {}, config.seedDemoDay ? 'Seeded demo delivery day' : 'Initialized empty operation')
  }

  /** Demo mode only: start the demo delivery day again, replacing the current operation for every device. */
  async resetDemo() {
    if (!config.demoMode || !config.seedDemoDay) throw new HttpError(403, 'Demo reset is only available in demo mode')
    return this.lock.run(async () => {
      const before = (await this.db.loadOps()) ?? this.state
      const next = this.seed()
      await this.db.persistState(before, next, this.db.transaction())
      this.state = next
      this.emit()
      this.log.info({ deliveryDate: next.deliveryDate, orders: next.orders.length }, 'Demo reset')
    })
  }

  async reload() {
    const latest = await this.db.loadOps()
    if (latest && (!this.state || latest.version >= this.state.version)) this.state = { ...latest, presence: { ...latest.presence, ...this.presence } }
  }

  touch(user: Session) {
    if (this.state) {
      this.presence[user.email] = this.state.presence[user.email] = Date.now()
      if (user.role === 'DRIVER' && user.assignedVehicle) this.presence[`vehicle:${user.assignedVehicle}`] = this.state.presence[`vehicle:${user.assignedVehicle}`] = Date.now()
    }
  }

  /** Run one mutation on a draft, persist the difference, then publish it. */
  private mutate<T>(fn: (draft: OpsData, c: Tx) => Promise<T> | T): Promise<T> {
    return this.lock.run(async () => {
      const before = await this.db.loadOps() ?? this.state
      const draft = structuredClone(before)
      Object.assign(draft.presence, this.presence)
      const c = this.db.transaction()
      const out = await fn(draft, c)
      await this.db.persistState(before, draft, c)
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
      if (user.role === 'DRIVER' && user.assignedVehicle) d.presence[`vehicle:${user.assignedVehicle}`] = Date.now()
      return (commands[cmd] as (d: OpsData, ...rest: unknown[]) => unknown)(d, ...a)
    })
  }

  /** Why this user may not record this event (or undefined when they may). */
  private forbid(user: Session, e: FieldEvent, d: OpsData): string | undefined {
    if (!e || !EVENT_ROLES[e.type]?.includes(user.role)) return `${user.role} cannot record this event`
    if (user.role === 'DRIVER') {
      if (!user.assignedVehicle) return 'Vehicle assignment required'
      const vehicleOfTrip = (id: string) => byId(d.trips, id)?.vehicleId
      const vehicle =
        e.type === 'VEHICLE_ISSUE' ? e.vehicleId : e.type === 'PROOF' ? vehicleOfTrip(byId(d.orders, e.orderId)?.tripId ?? '') : 'tripId' in e ? vehicleOfTrip(e.tripId) : undefined
      if (vehicle !== user.assignedVehicle) return 'Not your vehicle'
    }
    if (user.role === 'LOADER') {
      const tripId = 'tripId' in e ? e.tripId : byId(d.orders, 'orderId' in e ? e.orderId : '')?.tripId
      const v = byId(d.vehicles, byId(d.trips, tripId ?? '')?.vehicleId)
      if (!v || v.depot !== user.depot) return 'Trip belongs to another depot'
    }
    return undefined
  }

  /** Photos and signatures are stored as media rows; the event keeps a URL instead of a data URL. */
  private async extractMedia(c: Tx, e: FieldEvent): Promise<FieldEvent> {
    const store = async (dataUrl: string | undefined, _kind: string, _orderId: string) => {
      const m = dataUrl && /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl)
      if (!m) return dataUrl
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(m[1])) throw new HttpError(400, 'Proof must be a PNG, JPEG or WebP image')
      const id = crypto.randomBytes(16).toString('hex')
      c.media.push({ id, content_type: m[1], data: m[2] })
      return `${config.publicApiUrl}/api/media/${id}`
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
    if (!Array.isArray(list) || list.length > 500 || list.some((q) => !q || typeof q.id !== 'string' || !q.id || !Number.isFinite(q.at) || !q.event)) throw new HttpError(400, 'Send between 1 and 500 events')
    return this.mutate(async (d, c) => {
      const ids = list.map((q) => q.id)
      const seen = await this.db.seenEvents(ids)
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
        c.events.push({ id: q.id, user_email: user.email, result: r.status, message: r.message })
        seen.add(q.id)
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
      if (user.role === 'DRIVER' && user.assignedVehicle) d.presence[`vehicle:${user.assignedVehicle}`] = Date.now()
      return results
    })
  }

  async media(id: string) {
    return this.db.loadMedia(id)
  }
}
