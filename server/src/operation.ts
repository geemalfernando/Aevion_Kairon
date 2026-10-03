/**
 * The authoritative operation. State is held in memory for fast reads and rebuilt from PostgreSQL on boot;
 * every write runs the shared core command/event on a draft, persists the difference in one transaction,
 * and only then becomes visible. Writes are serialised so concurrent devices can't interleave half-applied changes.
 */
import crypto from 'node:crypto'
import { notificationVisible, projectState, mergeDepot } from '@core/access'
import { buildDemoReference, seedDemoOps, storedReference } from '@core/demo'
import { applyEvent, COMMAND_ROLES, commands, EVENT_ROLES, seedOps, type ApplyResult, type CommandName } from '@core/ops'
import type { Reference } from '@core/reference'
import { byId } from '@core/rules'
import type { FieldEvent, OpsData, QueuedEvent } from '@core/types'
import type { Session } from './auth'
import { config } from './config'
import { loadOps, persistState, transaction, seenEvents, loadMedia, type Tx } from './db'
import { readCatalog, readCsvs } from './demo-data'

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
      this.sources = existing.demoSource?.sources ?? null
      if (config.seedDemoEveryStart) {
        await this.resetDemo()
        return
      }
      this.log.info(`Loaded operation for ${existing.deliveryDate} (version ${existing.version})`)
      return
    }
    await this.reset()
  }

  /**
   * The starting operation. Normally empty (reference data comes from `npm run import:data`). With SEED_DEMO_DAY=true:
   * one realistic delivery day.
   */
  private seed(): OpsData {
    return config.seedDemoDay ? this.demoDay(null) : seedOps()
  }

  /**
   * A fresh demo delivery day for today, from the competition CSVs in DATA_DIR when present; otherwise from the
   * reference rows the previous demo day stored (a hosted server has no CSVs); otherwise from placeholders.
   */
  private demoDay(previous: OpsData | null): OpsData {
    const csv = readCsvs(config.dataDir)
    const stored = previous && storedReference(previous)
    const catalog = readCatalog(config.dataDir) ?? previous?.catalog
    const next = Object.keys(csv).length || !stored ? seedDemoOps({ csv, catalog }) : seedDemoOps({ reference: stored, catalog })
    this.sources = next.demoSource?.sources ?? buildDemoReference(csv).sources
    return next
  }

  private async reset() {
    const next = this.seed()
    await this.db.persistState(null, next, this.db.transaction())
    this.state = next
    this.log.info(config.seedDemoDay ? { sources: this.sources, deliveryDate: next.deliveryDate, orders: next.orders.length } : {}, config.seedDemoDay ? 'Seeded demo delivery day' : 'Initialized empty operation')
  }

  /** Demo mode only: start the demo delivery day again, replacing the current operation for every device. */
  async resetDemo() {
    if (!config.demoMode) throw new HttpError(403, 'Demo reset is only available in demo mode')
    return this.lock.run(async () => {
      const before = (await this.db.loadOps()) ?? this.state
      const next = this.demoDay(before)
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
  private mutate<T>(fn: (draft: OpsData, c: Tx) => Promise<T> | T, user?: Session): Promise<T> {
    return this.lock.run(async () => {
      const before = await this.db.loadOps() ?? this.state
      const draft = structuredClone(before)
      Object.assign(draft.presence, this.presence)
      const c = this.db.transaction()
      const out = await fn(draft, c)
      const oldNotifications = new Set(before.notifications.map((n) => n.id))
      const oldAudit = new Set(before.audit.map((a) => a.id))
      for (const n of draft.notifications) if (!oldNotifications.has(n.id)) n.depot ??= user?.depot
      for (const a of draft.audit) if (!oldAudit.has(a.id)) { a.depot ??= user?.depot; a.userId ??= user?.id }
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
    if (cmd === 'recordSync') a[0] = { ...(a[0] as object), email: user.email, name: user.name, role: user.role, vehicleId: user.assignedVehicle }
    return this.mutate((d) => {
      d.presence[user.email] = Date.now()
      if (user.role === 'DRIVER' && user.assignedVehicle) d.presence[`vehicle:${user.assignedVehicle}`] = Date.now()
      if (cmd === 'markRead') {
        for (const n of d.notifications) if (notificationVisible(d, n, user)) {
          n.readByUserIds ??= []
          if (!n.readByUserIds.includes(user.id)) n.readByUserIds.push(user.id)
        }
        return
      }
      if (user.role === 'STORE_MANAGER') {
        const outlet = byId(d.outlets, user.assignedOutlet)
        if (!outlet || outlet.depot !== user.depot) throw new HttpError(403, 'Outlet assignment required')
        if (['confirmReceipt', 'storeIssue', 'acknowledgeDeferral'].includes(cmd) && byId(d.orders, String(a[0]))?.outletId !== outlet.id) throw new HttpError(403, 'Not your outlet’s order')
        const closed = d.ordersClosed
        d.ordersClosed = d.ordersClosedByDepot?.[user.depot] ?? closed
        try { return (commands[cmd] as (d: OpsData, ...rest: unknown[]) => unknown)(d, ...a) }
        finally { d.ordersClosed = closed }
      }
      // Closing the day changes the whole operation (both depots' delivery date and fuel), so it runs on the full state.
      if (user.role !== 'DISPATCHER' || allowed === 'demo' || cmd === 'startNextDay') return (commands[cmd] as (d: OpsData, ...rest: unknown[]) => unknown)(d, ...a)
      const working = projectState(d, user)
      const before = structuredClone(working)
      const own = (list: { id: string }[], id: unknown) => { if (typeof id !== 'string' || !list.some((x) => x.id === id)) throw new HttpError(403, 'Resource belongs to another depot or does not exist') }
      if (['assign', 'unassign', 'lockStop', 'unlockStop', 'defer', 'confirmDeferral', 'moveStop'].includes(cmd)) own(working.orders, a[0])
      if (['assign', 'moveStop'].includes(cmd) || cmd === 'lockStop' && a[1] !== undefined) own(working.vehicles, a[1])
      if (['lockTrip', 'unlockTrip'].includes(cmd)) own(working.trips, a[0])
      if (['resolveIssue', 'applyRecovery'].includes(cmd)) own(working.issues, a[0])
      if (cmd === 'applyRecovery') {
        const plan = a[1] as { options?: { vehicleId: string; orderIds: string[] }[]; defer?: string[] }
        if (!plan || !Array.isArray(plan.options) || !Array.isArray(plan.defer)) throw new HttpError(400, 'Invalid recovery plan')
        for (const option of plan.options) { own(working.vehicles, option.vehicleId); for (const id of option.orderIds ?? []) own(working.orders, id) }
        for (const id of plan.defer) own(working.orders, id)
      }
      if (cmd === 'loadPredictions') {
        const p = a[0] as { service?: Record<string, unknown>; demand?: { depot: string }[] }
        if (!p || typeof p !== 'object') throw new HttpError(400, 'Invalid predictions')
        for (const id of Object.keys(p.service ?? {})) own(working.orders, id)
        if (p.demand?.some((row) => row.depot !== user.depot)) throw new HttpError(403, 'Predictions belong to another depot')
      }
      const out = (commands[cmd] as (d: OpsData, ...rest: unknown[]) => unknown)(working, ...a)
      mergeDepot(d, before, working, user.depot)
      return out
    }, user)
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
      if (byId(d.vehicles, vehicle)?.depot !== user.depot) return 'Vehicle belongs to another depot'
    }
    if ('orderId' in e) {
      const order = byId(d.orders, e.orderId)
      if (!order || byId(d.outlets, order.outletId)?.depot !== user.depot) return 'Order belongs to another depot'
      if (user.role === 'DRIVER' && 'tripId' in e) {
        const trip = byId(d.trips, e.tripId)
        if (!trip?.stops.includes(e.orderId) && !trip?.changes?.some((change) => change.removed.some((r) => r.orderId === e.orderId))) return 'Order does not belong to this trip'
      }
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
      if (!dataUrl) return undefined
      if (!m) throw new HttpError(400, 'Proof must be an inline image')
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(m[1])) throw new HttpError(400, 'Proof must be a PNG, JPEG or WebP image')
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(m[2]) || m[2].length > 4 * 1024 * 1024) throw new HttpError(400, 'Invalid or oversized proof image')
      const bytes = Buffer.from(m[2], 'base64')
      const valid = m[1] === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : m[1] === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      if (!valid) throw new HttpError(400, 'Proof content does not match its image type')
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
          depot: user.depot,
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
    }, user)
  }

  async media(id: string) {
    return this.db.loadMedia(id)
  }
}
