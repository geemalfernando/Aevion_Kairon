/**
 * The shared operation: seed data, dispatcher/store commands and field events.
 * Pure functions over a draft state, so the same code runs in the browser (offline, optimistic)
 * and on the API (authoritative).
 */
import { districtsFrom, outletsFrom, vehiclesFrom } from './adapter'
import { isOperating, nextOperatingDay, runForOrderPlacedAt, splitByTemp, measure } from './catalog'
import { buildReference, type Reference } from './reference'
import {
  analyzePlan,
  byId,
  customerMessageFor,
  DEFERRAL_LABEL,
  generatePlan as planDay,
  isDoneStatus,
  moveOptions,
  nextTripId,
  priorityOf,
  recoveryPlan,
  retimeAll,
  scheduleOfTrip,
  sequence,
  validate,
  vehicleDay,
  type World,
} from './rules'
import { addDays, colomboDate, colomboTs, fmtClock, fmtDate, fmtMin, hm, isoWeekOf } from './time'
import type {
  AuditEvent,
  DeferralCode,
  DeliveryRecord,
  FieldEvent,
  Issue,
  IssueKind,
  Notification,
  OpsData,
  Order,
  OrderItem,
  Predictions,
  QueuedEvent,
  Receipt,
  Role,
  Severity,
  SyncReport,
  Trip,
  TripChange,
} from './types'

export function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// ---------------------------------------------------------------------------
// Operation clock
// ---------------------------------------------------------------------------

/** Current operation time (ms). The demo can move it; in production sim === real. */
export const opNow = (d: Pick<OpsData, 'clock'>) => d.clock.sim + (Date.now() - d.clock.real)

/** Minutes since midnight of the delivery date (negative on the evening before). */
export const opMinutes = (d: Pick<OpsData, 'clock' | 'deliveryDate'>, at = opNow(d)) => (at - colomboTs(d.deliveryDate, 0)) / 60_000

export function setClock(d: OpsData, ts: number) {
  d.clock = { sim: ts, real: Date.now() }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export interface SeedOptions {
  reference?: Reference
  /** Colombo date on which orders are placed (defaults to today). Deliveries run on the next operating day. */
  today?: string
}

export function seedOps(opts: SeedOptions = {}): OpsData {
  const ref = opts.reference ?? buildReference()
  const today = opts.today ?? colomboDate(Date.now())
  const deliveryDate = nextOperatingDay(ref.calendar, today)
  const districts = districtsFrom(ref)
  const outlets = outletsFrom(ref, districts)
  const vehicles = vehiclesFrom(ref)
  const calendar = ref.calendar.filter((c) => c.date >= addDays(today, -21) && c.date <= addDays(today, 120))
  const orders: Order[] = []
  return {
    catalog: {},
    version: 1,
    deliveryDate,
    clock: { sim: Date.now(), real: Date.now() },
    ordersClosed: false,
    plan: 'NONE',
    outlets,
    vehicles,
    districts,
    allowances: ref.allowances,
    calendar,
    orders,
    trips: [],
    issues: [],
    notifications: [],
    audit: orders.flatMap((o) => [
      { id: uid('a'), entity: o.id, at: o.createdAt, actor: 'STORE_MANAGER' as const, text: `Order placed · ${o.temp === 'CHILLED' ? 'chilled' : 'ambient'} · ${o.units} units` },
      { id: uid('a'), entity: o.id, at: o.createdAt + 20_000, actor: 'SYSTEM' as const, text: `Order confirmed for ${fmtDate(o.deliveryDate, { weekday: 'long', day: 'numeric', month: 'long' })}` },
    ]),
    syncLog: [],
    presence: {},
    predictions: { service: {}, demand: [] },
  }
}

// ---------------------------------------------------------------------------
// Draft helpers
// ---------------------------------------------------------------------------

function log(d: OpsData, entity: string, actor: Role | 'SYSTEM', text: string, at = opNow(d)) {
  d.audit.push({ id: uid('a'), entity, at, actor, text } satisfies AuditEvent)
}

function notify(d: OpsData, n: Omit<Notification, 'id' | 'at' | 'readBy'>) {
  d.notifications.unshift({ ...n, id: uid('n'), at: opNow(d), readBy: [] })
  if (d.notifications.length > 200) d.notifications.length = 200
}

function raise(d: OpsData, i: Omit<Issue, 'id' | 'createdAt'>) {
  const issue = { ...i, id: uid('ISS'), createdAt: opNow(d) }
  d.issues.unshift(issue)
  return issue
}

const outletOf = (d: OpsData, o: Order) => byId(d.outlets, o.outletId)!
const tripOf = (d: OpsData, id?: string) => byId(d.trips, id)

/** Keep trip numbers and departures consistent after any change; drop empty unstarted trips. */
export function normalize(d: OpsData) {
  for (const t of d.trips) if (!t.stops.length && (t.status === 'LOADING' || t.status === 'LOADED')) t.status = 'ABORTED'
  d.trips = d.trips.filter((t) => t.stops.length || !['DRAFT', 'PLANNED'].includes(t.status))
  retimeAll(d)
  d.version = (d.version ?? 0) + 1
}

function nextOrderId(d: OpsData) {
  const max = Math.max(1400, ...d.orders.map((o) => Number(o.id.slice(3)) || 0))
  return `ORD${max + 1}`
}

/** Loading has started on this trip: the loader must see and confirm the change before departure. */
function recordLoadingChange(d: OpsData, trip: Trip | undefined, change: { added?: string[]; removed?: TripChange['removed']; reason: string }) {
  if (!trip || !['LOADING', 'LOADED'].includes(trip.status)) return
  const pc: TripChange = trip.pendingChange ?? { id: uid('chg'), at: opNow(d), phase: 'loading', added: [], removed: [], reason: change.reason }
  for (const id of change.added ?? []) {
    const back = pc.removed.findIndex((r) => r.orderId === id)
    if (back >= 0) pc.removed.splice(back, 1)
    else if (!pc.added.includes(id)) pc.added.push(id)
  }
  for (const r of change.removed ?? []) {
    const undo = pc.added.indexOf(r.orderId)
    if (undo >= 0) pc.added.splice(undo, 1)
    else if (!pc.removed.some((x) => x.orderId === r.orderId)) pc.removed.push(r)
  }
  pc.at = opNow(d)
  pc.reason = change.reason
  trip.pendingChange = pc.added.length || pc.removed.length ? pc : undefined
  if (!trip.pendingChange) return
  if (trip.status === 'LOADED') trip.status = 'LOADING'
  const what = [pc.removed.length && `${pc.removed.length} to unload`, pc.added.length && `${pc.added.length} to add`].filter(Boolean).join(', ')
  log(d, trip.vehicleId, 'DISPATCHER', `Plan changed after loading started (${trip.id}: ${what})`)
  notify(d, { to: ['LOADER'], severity: 'HIGH', title: `${trip.vehicleId} plan changed during loading`, body: `${what}. Confirm the new load before the vehicle leaves.`, link: `/loader/load/${trip.id}` })
  notify(d, { to: ['DRIVER'], vehicleId: trip.vehicleId, severity: 'WARNING', title: 'Load being re-checked', body: 'The dispatcher changed your trip. Wait for the loader to confirm before leaving.', link: '/driver' })
}

function plannedWindow(d: OpsData, o: Order) {
  const t = tripOf(d, o.tripId)
  const s = t && scheduleOfTrip(d, t).stops.find((x) => x.orderId === o.id)
  return s ? `${fmtMin(s.eta)}–${fmtMin(s.eta + 20)}` : undefined
}

function deferralFor(d: OpsData, o: Order, code: DeferralCode, reason: string, detail: string | undefined, customerMessage: string, confirmed: boolean, internalNote?: string) {
  const nextRun = nextOperatingDay(d.calendar, o.deliveryDate)
  const out = outletOf(d, o)
  return {
    code,
    reason,
    detail,
    customerMessage,
    internalNote,
    nextRun,
    nextRecommendation: `${fmtDate(nextRun, { weekday: 'short', day: 'numeric', month: 'short' })} · first in queue`,
    repeat: out.deferredYesterday || (o.runsDeferred ?? 0) > 0,
    confirmed,
    at: opNow(d),
  }
}

// ---------------------------------------------------------------------------
// Field events
// ---------------------------------------------------------------------------

export type ApplyResult = { status: 'applied' | 'duplicate' | 'rejected'; conflict?: boolean; message?: string }

/** Apply one field event. Pure over a draft and safe to replay after reconnection (idempotent where it matters). */
export function applyEvent(d: OpsData, q: Pick<QueuedEvent, 'actor' | 'event' | 'at'>): ApplyResult {
  const e = q.event
  const actor = q.actor
  const done = (r: ApplyResult = { status: 'applied' }) => {
    if (r.status === 'applied') normalize(d)
    return r
  }
  switch (e.type) {
    case 'LOAD_START': {
      const t = tripOf(d, e.tripId)
      if (!t) return { status: 'rejected', message: 'Trip not found' }
      if (t.status !== 'PLANNED') return { status: 'duplicate' }
      t.status = 'LOADING'
      log(d, t.vehicleId, actor, `Loading started for ${t.id}`, q.at)
      return done()
    }
    case 'LOAD_COUNT': {
      const o = byId(d.orders, e.orderId)
      if (!o) return { status: 'rejected', message: 'Order not found' }
      o.loaded = { ...o.loaded, [e.item]: e.count }
      return done()
    }
    case 'SHORTFALL': {
      const o = byId(d.orders, e.orderId)
      if (!o) return { status: 'rejected', message: 'Order not found' }
      if (o.shortfall?.item === e.item) return { status: 'duplicate' }
      const out = outletOf(d, o)
      const unit = o.items.find((i) => i.name === e.item)?.unit ?? 'units'
      o.shortfall = { item: e.item, missing: e.missing, reason: e.reason }
      log(d, o.id, actor, `Loading shortfall: ${e.missing} ${unit} of ${e.item} (${e.reason})`, q.at)
      raise(d, { kind: 'SHORTFALL', severity: 'HIGH', title: `${out.id} loading shortfall`, detail: `${e.missing} ${unit} of ${e.item} missing · ${e.reason}`, tripId: o.tripId, vehicleId: tripOf(d, o.tripId)?.vehicleId, orderIds: [o.id] })
      notify(d, { to: ['DISPATCHER'], severity: 'WARNING', title: 'Loader shortfall', body: `${out.id}: ${e.missing} ${unit} of ${e.item} missing`, link: '/dispatcher/issues' })
      return done()
    }
    case 'LOAD_COMPLETE': {
      const t = tripOf(d, e.tripId)
      if (!t) return { status: 'rejected', message: 'Trip not found' }
      if (t.pendingChange) return { status: 'rejected', message: 'The plan changed — confirm the new load first' }
      if (t.status !== 'LOADING') return { status: 'duplicate' }
      t.status = 'LOADED'
      for (const id of t.stops) {
        const o = byId(d.orders, id)
        if (!o || o.status !== 'PLANNED') continue
        o.status = 'LOADED'
        log(d, o.id, actor, `Loaded onto ${t.vehicleId}`, q.at)
        notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'INFO', title: 'Vehicle loaded', body: `${o.id} is loaded on ${t.vehicleId} · expected ${plannedWindow(d, o) ?? 'on schedule'}`, link: `/store/orders/${o.id}` })
      }
      notify(d, { to: ['DRIVER'], vehicleId: t.vehicleId, severity: 'INFO', title: 'Route ready', body: `${t.id} is loaded — ${t.stops.length} stops, leave at ${fmtMin(t.departure)}`, link: '/driver' })
      log(d, t.vehicleId, actor, `${t.id} loading complete`, q.at)
      return done()
    }
    case 'LOAD_CHANGE_ACK': {
      const t = tripOf(d, e.tripId)
      if (!t) return { status: 'rejected', message: 'Trip not found' }
      if (!t.pendingChange || t.pendingChange.id !== e.changeId) return { status: 'duplicate' }
      const pc = { ...t.pendingChange, ackAt: q.at }
      t.changes = [...(t.changes ?? []), pc]
      t.pendingChange = undefined
      for (const r of pc.removed) {
        const o = byId(d.orders, r.orderId)
        if (o && o.tripId !== t.id) o.loaded = undefined
      }
      log(d, t.vehicleId, actor, `Loader confirmed the new load for ${t.id} (${pc.removed.length} unloaded, ${pc.added.length} added)`, q.at)
      notify(d, { to: ['DISPATCHER'], severity: 'INFO', title: `${t.vehicleId} load re-checked`, body: `Loader confirmed the change to ${t.id}`, link: `/dispatcher/routes/${t.id}` })
      return done()
    }
    case 'START_ROUTE': {
      const t = tripOf(d, e.tripId)
      if (!t) return { status: 'rejected', message: 'Trip not found' }
      if (t.pendingChange) return { status: 'rejected', message: 'Waiting for the loader to confirm a plan change' }
      if (['IN_PROGRESS', 'PAUSED', 'COMPLETED'].includes(t.status)) return { status: 'duplicate' }
      t.status = 'IN_PROGRESS'
      t.startedAt = q.at
      t.departure = Math.round(opMinutes(d, q.at))
      for (const id of t.stops) {
        const o = byId(d.orders, id)
        if (!o || !['LOADED', 'PLANNED'].includes(o.status)) continue
        o.status = 'IN_TRANSIT'
        log(d, o.id, actor, `Departed on ${t.vehicleId}`, q.at)
      }
      normalize(d)
      for (const id of t.stops) {
        const o = byId(d.orders, id)
        if (o?.status === 'IN_TRANSIT') notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'INFO', title: 'Driver on the way', body: `${t.vehicleId} left ${fmtClock(q.at)} · expected ${plannedWindow(d, o) ?? 'soon'}`, link: `/store/orders/${o.id}` })
      }
      return { status: 'applied' }
    }
    case 'ARRIVE': {
      const o = byId(d.orders, e.orderId)
      if (!o) return { status: 'rejected', message: 'Order not found' }
      if (isDoneStatus(o.status) || o.status === 'ARRIVED') return { status: 'duplicate' }
      const conflict = o.tripId !== e.tripId
      o.status = 'ARRIVED'
      o.delivery = { ...o.delivery, outcome: o.delivery?.outcome ?? 'DELIVERED', arrivedAt: q.at }
      log(d, o.id, actor, 'Driver arrived', q.at)
      notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'INFO', title: 'Delivery arriving', body: `${o.id} — the driver has arrived`, link: `/store/orders/${o.id}` })
      return done({ status: 'applied', conflict })
    }
    case 'DELIVER': {
      const o = byId(d.orders, e.orderId)
      if (!o) return { status: 'rejected', message: 'Order not found' }
      if (isDoneStatus(o.status)) return { status: 'duplicate' }
      const out = outletOf(d, o)
      let conflict = false
      // Goods already handed over win over a later reassignment: take the order back off any rescue trip.
      if (o.tripId && o.tripId !== e.tripId) {
        conflict = true
        const other = tripOf(d, o.tripId)
        if (other) other.stops = other.stops.filter((s) => s !== o.id)
        const mine = tripOf(d, e.tripId)
        // Put it back where it happened: after the stops already done, before the ones still to come.
        if (mine && !mine.stops.includes(o.id)) {
          const at = mine.stops.findIndex((id) => !isDoneStatus(byId(d.orders, id)?.status))
          mine.stops.splice(at < 0 ? mine.stops.length : at, 0, o.id)
        }
        o.tripId = e.tripId
        // Synced before the rescue vehicle left: nothing drove. After: it is called back.
        const left = other ? opMinutes(d) >= other.departure : false
        log(d, o.id, 'SYSTEM', `Delivered offline by ${mine?.vehicleId ?? 'the original vehicle'} before the reassignment reached the driver — the delivery record was kept and ${other?.vehicleId ?? 'the rescue vehicle'}${left ? ' was called back' : `'s re-pick was cancelled before it left (${other ? fmtMin(other.departure) : ''}), so no extra trip was driven`}`, q.at)
      }
      const r = e.record
      o.delivery = { ...o.delivery, ...r }
      o.status = r.outcome === 'DELIVERED' ? 'DELIVERED' : r.outcome === 'PARTIAL' ? 'PARTIAL' : 'FAILED'
      const label = { DELIVERED: 'Delivered in full', PARTIAL: 'Partial delivery', REFUSED: 'Delivery refused', CLOSED: 'Outlet closed', NO_ACCESS: 'Unable to access' }[r.outcome]
      log(d, o.id, actor, `${label}${r.receiver ? ` · received by ${r.receiver}` : ''}${r.offline ? ' · recorded offline' : ''}`, r.completedAt ?? q.at)
      if (o.status === 'FAILED') {
        raise(d, { kind: 'DELIVERY_FAILED', severity: 'WARNING', title: `${out.id} ${label.toLowerCase()}`, detail: r.notes || 'Failed attempt recorded by driver', orderIds: [o.id], tripId: o.tripId, vehicleId: tripOf(d, o.tripId)?.vehicleId })
        notify(d, { to: ['DISPATCHER'], severity: 'WARNING', title: 'Failed delivery attempt', body: `${out.id}: ${label}`, link: '/dispatcher/issues' })
        notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'WARNING', title: 'Delivery attempt failed', body: `${o.id}: ${label}`, link: `/store/orders/${o.id}` })
      } else {
        out.lastServedDaysAgo = 0
        out.deferredYesterday = false
        notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'INFO', title: 'Delivered — please confirm receipt', body: `${o.id} ${label.toLowerCase()}`, link: `/store/orders/${o.id}` })
      }
      const t = tripOf(d, o.tripId)
      if (t && t.stops.every((id) => isDoneStatus(byId(d.orders, id)?.status))) {
        t.status = 'COMPLETED'
        log(d, t.vehicleId, actor, `${t.id} completed`, q.at)
      }
      return done({ status: 'applied', conflict })
    }
    case 'PROOF': {
      const o = byId(d.orders, e.orderId)
      if (!o) return { status: 'rejected', message: 'Order not found' }
      if ((e.photo && o.delivery?.photo) || (e.signature && o.delivery?.signature)) return { status: 'duplicate' }
      o.delivery = { outcome: 'DELIVERED', ...o.delivery, ...(e.photo ? { photo: e.photo } : {}), ...(e.signature ? { signature: e.signature } : {}) }
      log(d, o.id, actor, `Proof of delivery ${e.photo ? 'photo' : 'signature'} attached`, q.at)
      return done()
    }
    case 'VEHICLE_ISSUE': {
      const v = byId(d.vehicles, e.vehicleId)
      if (!v) return { status: 'rejected', message: 'Vehicle not found' }
      if (v.status === 'BREAKDOWN') return { status: 'duplicate' }
      const t = tripOf(d, e.tripId)
      // A blocked road delays the route but the vehicle still works: record the delay, don't pause the trip.
      if (e.kind === 'Road blocked') {
        if (!t) return { status: 'rejected', message: 'Trip not found' }
        const target = e.delayOrderId ? byId(d.orders, e.delayOrderId) : undefined
        const where = target ? outletOf(d, target).id : 'the rest of the route'
        t.reportedDelay = { orderId: target?.id, minutes: e.delayMin ?? 30, note: e.note, at: q.at }
        raise(d, { kind: 'LATE_RISK', severity: 'HIGH', title: `${v.id} road blocked · ${where}`, detail: `Driver expects about ${e.delayMin ?? 30} min delay${e.note ? ` · ${e.note}` : ''}`, vehicleId: v.id, tripId: t.id, orderIds: target ? [target.id] : t.stops })
        log(d, v.id, actor, `Road blocked reported at ${fmtClock(q.at)}: ~${e.delayMin ?? 30} min delay to ${where}`, q.at)
        notify(d, { to: ['DISPATCHER'], severity: 'WARNING', title: `${v.id} road blocked`, body: `~${e.delayMin ?? 30} min delay to ${where}`, link: `/dispatcher/routes/${t.id}` })
        return done()
      }
      const reefer = e.kind === 'Refrigeration failure'
      v.status = 'BREAKDOWN'
      if (t && t.status === 'IN_PROGRESS') t.status = 'PAUSED'
      const remaining = t ? t.stops.filter((id) => !isDoneStatus(byId(d.orders, id)?.status)) : []
      const kind: IssueKind = reefer ? 'REEFER_FAILURE' : 'BREAKDOWN'
      raise(d, { kind, severity: 'CRITICAL', title: `${v.id} ${reefer ? 'refrigeration failure' : e.kind.toLowerCase()}`, detail: `${remaining.length} ${remaining.length === 1 ? 'delivery' : 'deliveries'} impacted${e.note ? ` · ${e.note}` : ''}`, vehicleId: v.id, tripId: t?.id, orderIds: remaining })
      log(d, v.id, actor, `${e.kind} reported at ${fmtClock(q.at)}`, q.at)
      notify(d, { to: ['DISPATCHER'], severity: 'CRITICAL', title: `${v.id} ${reefer ? 'refrigeration failure' : 'breakdown'}`, body: `${remaining.length} deliveries impacted`, link: '/dispatcher/issues' })
      return done()
    }
    case 'ROUTE_ACK': {
      const t = tripOf(d, e.tripId)
      if (!t) return { status: 'rejected', message: 'Trip not found' }
      let n = 0
      for (const c of t.changes ?? []) if (e.changeIds.includes(c.id) && !c.ackAt) (c.ackAt = q.at), n++
      const report = d.syncLog.find((s) => s.vehicleId === t.vehicleId && s.routeChanged && !s.ackAt)
      if (report) report.ackAt = q.at
      if (!n && !report) return { status: 'duplicate' }
      log(d, t.vehicleId, actor, `Driver acknowledged the route change on ${t.id}`, q.at)
      notify(d, { to: ['DISPATCHER'], severity: 'INFO', title: `${t.vehicleId} driver saw the route change`, body: 'Acknowledged on the device', link: '/dispatcher/live' })
      return done()
    }
  }
}

export function describeEvent(e: FieldEvent, d: OpsData): string {
  const out = (orderId: string) => byId(d.outlets, byId(d.orders, orderId)?.outletId)?.id ?? orderId
  switch (e.type) {
    case 'LOAD_START':
      return `Loading started · ${e.tripId}`
    case 'LOAD_COUNT':
      return `${out(e.orderId)} · ${e.item} counted (${e.count})`
    case 'SHORTFALL':
      return `${out(e.orderId)} · shortfall reported`
    case 'LOAD_COMPLETE':
      return `Loading complete · ${e.tripId}`
    case 'LOAD_CHANGE_ACK':
      return `New load confirmed · ${e.tripId}`
    case 'START_ROUTE':
      return `Route started · ${e.tripId}`
    case 'ARRIVE':
      return `${out(e.orderId)} arrival`
    case 'DELIVER':
      return `${out(e.orderId)} delivery`
    case 'PROOF':
      return `${out(e.orderId)} proof ${e.photo ? 'photo' : 'signature'}`
    case 'VEHICLE_ISSUE':
      return `${e.vehicleId} · ${e.kind}`
    case 'ROUTE_ACK':
      return `Route change acknowledged · ${e.tripId}`
  }
}

// ---------------------------------------------------------------------------
// Commands (dispatcher, store manager, system). Always online.
// ---------------------------------------------------------------------------

function commit(d: OpsData) {
  normalize(d)
}

export const commands = {
  // ----- Store manager -----

  /** Fresh baskets are split into a chilled order and a dry order: they travel on different vehicles. */
  createOrder(d: OpsData, outletId: string, items: OrderItem[], notes: string) {
    const out = byId(d.outlets, outletId)
    if (!out) throw new Error('Unknown outlet')
    if (!items.length) throw new Error('Choose at least one product')
    measure(out.brand, items, d.catalog)
    const now = opNow(d)
    let run = runForOrderPlacedAt(d.calendar, now)
    // Orders for a run the dispatcher has already closed wait for the following run.
    if (run.date === d.deliveryDate && d.ordersClosed) run = { ...run, date: nextOperatingDay(d.calendar, run.date), afterCutoff: true }
    const ids: string[] = []
    for (const part of splitByTemp(out.brand, items, d.catalog)) {
      const id = nextOrderId(d)
      const m = measure(out.brand, part.items, d.catalog)
      const pr = priorityOf({ brand: out.brand, temp: part.temp }, out)
      d.orders.push({ id, outletId, brand: out.brand, temp: part.temp, items: part.items, ...m, deliveryDate: run.date, status: 'CONFIRMED', priority: pr.score, priorityWhy: pr.why, createdAt: now, notes: notes || undefined })
      log(d, id, 'STORE_MANAGER', `Order placed · ${part.temp === 'CHILLED' ? 'chilled' : 'ambient'} · ${m.units} units`)
      log(d, id, 'SYSTEM', `Order confirmed for ${fmtDate(run.date, { weekday: 'long', day: 'numeric', month: 'long' })}${run.afterCutoff ? ' (after the 16:00 cutoff)' : ''}`)
      notify(d, { to: ['DISPATCHER'], severity: 'INFO', title: 'New order received', body: `${out.id} · ${id} · ${m.volumeM3} m³ ${part.temp.toLowerCase()}${run.afterCutoff ? ' · next run' : ''}`, link: '/dispatcher/orders' })
      ids.push(id)
    }
    commit(d)
    return { ids, deliveryDate: run.date, afterCutoff: run.afterCutoff }
  },

  confirmReceipt(d: OpsData, orderId: string, r: Omit<Receipt, 'at'>) {
    const o = byId(d.orders, orderId)!
    o.receipt = { ...r, at: opNow(d) }
    o.status = 'RECEIVED'
    log(d, o.id, 'STORE_MANAGER', `Receipt confirmed · ${r.received} units · ${r.condition.toLowerCase()} · ${r.receiver}`)
    notify(d, { to: ['DISPATCHER'], severity: r.condition === 'GOOD' ? 'INFO' : 'WARNING', title: 'Receipt confirmed', body: `${o.outletId} · ${o.id}${r.condition !== 'GOOD' ? ` · ${r.condition.toLowerCase()}` : ''}`, link: '/dispatcher/history' })
    if (r.condition !== 'GOOD') commands.storeIssue(d, orderId, r.condition === 'MISSING' ? 'Missing goods' : r.condition === 'DAMAGED' ? 'Damaged goods' : 'Wrong product', 'Reported at receipt')
    commit(d)
  },

  storeIssue(d: OpsData, orderId: string, kind: string, description: string) {
    const o = byId(d.orders, orderId)!
    raise(d, { kind: 'STORE_ISSUE', severity: 'WARNING', title: `${o.outletId} · ${kind}`, detail: description || kind, orderIds: [o.id] })
    log(d, o.id, 'STORE_MANAGER', `Issue reported: ${kind}`)
    notify(d, { to: ['DISPATCHER'], severity: 'WARNING', title: 'Store reported an issue', body: `${o.outletId}: ${kind}`, link: '/dispatcher/issues' })
    commit(d)
  },

  acknowledgeDeferral(d: OpsData, orderId: string) {
    const o = byId(d.orders, orderId)!
    if (o.deferral) o.deferral.acknowledged = true
    log(d, o.id, 'STORE_MANAGER', 'Deferral acknowledged')
    commit(d)
  },

  // ----- Dispatcher: planning -----

  /**
   * Close the delivery day and open the next operating day. Refused while a trip is still loading or on the road.
   * - Fuel: what the day's completed trips used is added to each vehicle's fuel used this week, so the weekly quota
   *   builds up day by day; a new ISO week starts every vehicle at 0.
   * - Outlets: days since the last delivery, and "skipped on the previous run", which raises tomorrow's priority.
   * - Orders: deferred orders join the next run's queue; orders that were never planned carry over.
   * Trips of the closed day are cleared, so they no longer count towards a vehicle's trips, time or fuel.
   */
  startNextDay(d: OpsData) {
    const open = d.trips.filter((t) => ['LOADING', 'LOADED', 'IN_PROGRESS', 'PAUSED'].includes(t.status))
    if (open.length) return { ok: false as const, message: `${open.length} ${open.length === 1 ? 'trip is' : 'trips are'} still loading or on the road (${open.slice(0, 3).map((t) => t.id).join(', ')})` }
    const from = d.deliveryDate
    const to = nextOperatingDay(d.calendar, from)
    const week = (date: string) => { const w = isoWeekOf(date); return `${w.iso_year}-${w.iso_week}` }
    const newWeek = week(to) !== week(from)
    const ran = d.trips.filter((t) => t.status === 'COMPLETED')
    let litres = 0
    for (const v of d.vehicles) {
      const used = vehicleDay(v, ran, d).fuelL
      litres += used
      v.fuelUsedL = newWeek ? 0 : Math.round((v.fuelUsedL + used) * 10) / 10
    }
    const day = d.orders.filter((o) => o.deliveryDate === from)
    const served = new Set(day.filter((o) => isDoneStatus(o.status)).map((o) => o.outletId))
    const skipped = new Set(day.filter((o) => o.status === 'DEFERRED').map((o) => o.outletId))
    for (const out of d.outlets) {
      out.lastServedDaysAgo = served.has(out.id) ? 1 : out.lastServedDaysAgo + 1
      out.deferredYesterday = skipped.has(out.id)
      if (newWeek) out.deferralsThisWeek = 0
    }
    let carried = 0
    for (const o of d.orders) {
      if (o.status === 'DEFERRED' && o.deliveryDate === from) {
        o.deliveryDate = o.deferral?.nextRun && o.deferral.nextRun > from ? o.deferral.nextRun : to
        o.status = 'CONFIRMED'
        carried++
      } else if ((o.status === 'CONFIRMED' || o.status === 'PLANNED') && o.deliveryDate === from) {
        o.deliveryDate = to
        o.status = 'CONFIRMED'
        o.tripId = undefined
        carried++
      }
      if (o.deliveryDate === to && !isDoneStatus(o.status)) o.lock = undefined
    }
    d.trips = []
    d.deliveryDate = to
    d.ordersClosed = false
    d.plan = 'NONE'
    d.analysis = undefined
    const text = `Closed ${fmtDate(from, { weekday: 'short', day: 'numeric', month: 'short' })}: ${Math.round(litres)} L of fuel recorded${newWeek ? ', new week (fuel quotas reset)' : ''}; ${carried} orders carried to ${fmtDate(to, { weekday: 'short', day: 'numeric', month: 'short' })}`
    log(d, from, 'DISPATCHER', text)
    notify(d, { to: ['DISPATCHER', 'LOADER', 'DRIVER'], severity: 'INFO', title: `Planning ${fmtDate(to, { weekday: 'long', day: 'numeric', month: 'long' })}`, body: text })
    commit(d)
    return { ok: true as const, from, to, litres: Math.round(litres), newWeek, carried }
  },

  closeOrders(d: OpsData) {
    d.ordersClosed = true
    const n = d.orders.filter((o) => o.status === 'CONFIRMED' && o.deliveryDate === d.deliveryDate)
    for (const o of n) log(d, o.id, 'DISPATCHER', 'Orders closed · entered planning queue')
    commit(d)
    return { queued: n.length }
  },

  /** Re-plan from scratch: drafts and unconfirmed deferrals return to the queue first. */
  generatePlan(d: OpsData) {
    const drafts = new Set(d.trips.filter((t) => t.status === 'DRAFT').map((t) => t.id))
    for (const o of d.orders) {
      if ((o.tripId && drafts.has(o.tripId)) || (o.status === 'DEFERRED' && !o.deferral?.confirmed && o.deliveryDate === d.deliveryDate)) {
        o.tripId = undefined
        o.status = 'CONFIRMED'
        o.deferral = undefined
      }
      if (o.status === 'CONFIRMED') {
        const pr = priorityOf(o, outletOf(d, o))
        o.priority = pr.score
        o.priorityWhy = pr.why
      }
    }
    d.trips = d.trips.filter((t) => t.status !== 'DRAFT')
    const before: World = { ...d, orders: d.orders.map((o) => ({ ...o })), trips: d.trips.map((t) => ({ ...t, stops: [...t.stops] })) }
    const res = planDay(before, d.deliveryDate)
    const kept = new Set(d.trips.map((t) => t.id))
    d.trips.push(...res.trips.filter((t) => !kept.has(t.id)))
    for (const [oid, tid] of Object.entries(res.assigned)) {
      const o = byId(d.orders, oid)!
      o.status = 'PLANNED'
      o.tripId = tid
      o.deferral = undefined
      log(d, o.id, 'SYSTEM', `Allocated to ${tripOf(d, tid)?.vehicleId} (draft plan)`)
    }
    for (const [oid, info] of Object.entries(res.deferred)) {
      const o = byId(d.orders, oid)!
      o.status = 'DEFERRED'
      o.tripId = undefined
      o.deferral = deferralFor(d, o, info.code, info.reason, info.detail, customerMessageFor(info.code), false)
      log(d, o.id, 'SYSTEM', `Proposed deferral: ${info.reason} — ${info.detail}`)
    }
    d.analysis = analyzePlan(before, res, d.deliveryDate, opNow(d))
    d.plan = 'DRAFT'
    commit(d)
    return {
      served: Object.keys(res.assigned).length,
      deferred: Object.keys(res.deferred).length,
      trips: d.trips.filter((t) => t.status === 'DRAFT').length,
      vehicles: new Set(d.trips.filter((t) => t.status === 'DRAFT').map((t) => t.vehicleId)).size,
      binding: d.analysis.binding,
    }
  },

  publishPlan(d: OpsData) {
    for (const t of d.trips) if (t.status === 'DRAFT') t.status = 'PLANNED'
    for (const o of d.orders) {
      if (o.status === 'PLANNED') {
        const t = tripOf(d, o.tripId)!
        log(d, o.id, 'DISPATCHER', `Scheduled on ${t.vehicleId} · Trip ${t.number}`)
        notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'INFO', title: 'Delivery scheduled', body: `${o.id} · expected ${plannedWindow(d, o)} on ${t.vehicleId}`, link: `/store/orders/${o.id}` })
      }
      if (o.status === 'DEFERRED' && o.deferral && !o.deferral.confirmed) commands.confirmDeferral(d, o.id)
    }
    d.plan = 'PUBLISHED'
    notify(d, { to: ['LOADER'], severity: 'INFO', title: 'Plan released', body: `${d.trips.filter((t) => t.status === 'PLANNED').length} trips ready for loading`, link: '/loader/trips' })
    for (const v of new Set(d.trips.filter((t) => t.status === 'PLANNED').map((t) => t.vehicleId))) notify(d, { to: ['DRIVER'], vehicleId: v, severity: 'INFO', title: 'Route assigned', body: 'Your trips for the next run are planned', link: '/driver' })
    commit(d)
  },

  /** Allocate (or re-allocate before departure). Returns the validation so the UI can explain a block. */
  assign(d: OpsData, orderId: string, vehicleId: string) {
    const o = byId(d.orders, orderId)!
    const v = byId(d.vehicles, vehicleId)!
    const prev = tripOf(d, o.tripId)
    const world: World = { ...d, trips: d.trips.map((t) => (t.id === prev?.id ? { ...t, stops: t.stops.filter((s) => s !== orderId) } : t)) }
    const r = validate(o, v, world)
    if (!r.ok || (prev && !['DRAFT', 'PLANNED', 'LOADING', 'LOADED'].includes(prev.status))) return r
    if (prev?.id === r.trip.id) return r
    if (prev) {
      prev.stops = prev.stops.filter((s) => s !== orderId)
      recordLoadingChange(d, prev, { removed: [{ orderId, to: v.id, reason: 'Reallocated by dispatcher' }], reason: `${outletOf(d, o).id} moved to ${v.id}` })
    }
    let t = r.trip.id ? tripOf(d, r.trip.id) : undefined
    if (!t) {
      t = { id: nextTripId(d.trips, v.id), vehicleId: v.id, number: r.trip.number, brand: o.brand, district: r.trip.district, departure: r.trip.departure, stops: [], status: d.plan === 'PUBLISHED' ? 'PLANNED' : 'DRAFT' }
      d.trips.push(t)
    }
    t.stops = r.trip.stops
    o.tripId = t.id
    if (prev) o.loaded = undefined
    o.status = 'PLANNED'
    o.deferral = undefined
    recordLoadingChange(d, t, { added: [orderId], reason: `${outletOf(d, o).id} added by dispatcher` })
    log(d, o.id, 'DISPATCHER', `Allocated to ${v.id} · ${t.brand} · ${t.district}`)
    if (t.status !== 'DRAFT' && !t.pendingChange) notify(d, { to: ['LOADER'], severity: 'INFO', title: 'Trip changed', body: `${o.id} added to ${t.id}`, link: `/loader/load/${t.id}` })
    commit(d)
    return r
  },

  unassign(d: OpsData, orderId: string) {
    const o = byId(d.orders, orderId)!
    const t = tripOf(d, o.tripId)
    if (t) {
      t.stops = t.stops.filter((s) => s !== orderId)
      recordLoadingChange(d, t, { removed: [{ orderId, reason: 'Returned to the planning queue' }], reason: `${o.outletId} removed by dispatcher` })
    }
    o.tripId = undefined
    o.status = 'CONFIRMED'
    o.deferral = undefined
    o.loaded = undefined
    o.lock = undefined
    log(d, o.id, 'DISPATCHER', 'Returned to unassigned queue')
    commit(d)
  },

  /**
   * Team policy: lock a stop to its current vehicle (or a given one). Re-planning then keeps it on that vehicle at the
   * same arrival time and only uses the room around it. Manual moves need an unlock first.
   */
  lockStop(d: OpsData, orderId: string, vehicleId?: string) {
    const o = byId(d.orders, orderId)
    const vid = vehicleId ?? tripOf(d, o?.tripId)?.vehicleId
    if (!o || !vid || !byId(d.vehicles, vid)) return { ok: false as const, message: 'Put the stop on a vehicle before locking it' }
    o.lock = { vehicleId: vid, by: 'DISPATCHER', at: opNow(d) }
    log(d, o.id, 'DISPATCHER', `Stop locked to ${vid}`)
    commit(d)
    return { ok: true as const }
  },

  /**
   * Team policy: lock a whole trip. Every stop on it is locked to the trip's vehicle as one closed trip: re-planning
   * keeps exactly these stops at the same times and adds nothing to the trip. The same actions that clear a stop lock
   * clear it for that stop.
   */
  lockTrip(d: OpsData, tripId: string) {
    const t = tripOf(d, tripId)
    const stops = t ? t.stops.filter((id) => !isDoneStatus(byId(d.orders, id)?.status)) : []
    if (!t || !stops.length) return { ok: false as const, message: 'This trip has no stops left to lock' }
    const at = opNow(d)
    for (const id of stops) byId(d.orders, id)!.lock = { vehicleId: t.vehicleId, by: 'DISPATCHER', at, wholeTrip: true }
    log(d, t.vehicleId, 'DISPATCHER', `Trip ${t.id} locked (${stops.length} stops)`)
    commit(d)
    return { ok: true as const }
  },

  unlockTrip(d: OpsData, tripId: string) {
    const t = tripOf(d, tripId)
    const locked = t ? t.stops.map((id) => byId(d.orders, id)!).filter((o) => o?.lock) : []
    if (!t || !locked.length) return { ok: false as const, message: 'This trip has no locked stops' }
    for (const o of locked) o.lock = undefined
    log(d, t.vehicleId, 'DISPATCHER', `Trip ${t.id} unlocked`)
    commit(d)
    return { ok: true as const }
  },

  unlockStop(d: OpsData, orderId: string) {
    const o = byId(d.orders, orderId)
    if (!o?.lock) return { ok: false as const, message: 'This stop is not locked' }
    const vid = o.lock.vehicleId
    o.lock = undefined
    log(d, o.id, 'DISPATCHER', `Stop unlocked from ${vid}`)
    commit(d)
    return { ok: true as const }
  },

  defer(d: OpsData, orderId: string, code: DeferralCode, reason: string, customerMessage: string, internalNote?: string) {
    const o = byId(d.orders, orderId)!
    const t = tripOf(d, o.tripId)
    if (t) {
      t.stops = t.stops.filter((s) => s !== orderId)
      recordLoadingChange(d, t, { removed: [{ orderId, reason: `Deferred: ${reason}` }], reason: `${o.outletId} deferred` })
    }
    o.tripId = undefined
    o.status = 'DEFERRED'
    o.loaded = undefined
    o.lock = undefined
    o.deferral = deferralFor(d, o, code, reason || DEFERRAL_LABEL[code], undefined, customerMessage, false, internalNote)
    commands.confirmDeferral(d, orderId)
  },

  confirmDeferral(d: OpsData, orderId: string) {
    const o = byId(d.orders, orderId)!
    if (!o.deferral || o.deferral.confirmed) return
    o.deferral.confirmed = true
    o.deferral.at = opNow(d)
    o.runsDeferred = (o.runsDeferred ?? 0) + 1
    const out = outletOf(d, o)
    out.deferralsThisWeek += 1
    log(d, o.id, 'DISPATCHER', `Deferred to ${fmtDate(o.deferral.nextRun, { weekday: 'short', day: 'numeric', month: 'short' })}: ${o.deferral.reason}${o.deferral.detail ? ` — ${o.deferral.detail}` : ''}`)
    notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'WARNING', title: 'Delivery moved to the next run', body: `${o.id}: ${o.deferral.customerMessage}`, link: `/store/orders/${o.id}` })
    commit(d)
  },

  // ----- Dispatcher: live operation -----

  /**
   * Take a stop off a vehicle that is already on the road and send it on another vehicle. The goods are
   * re-picked at the depot; the original driver keeps theirs on board and returns them. The driver's
   * device learns about it on its next sync (the hero degradation scenario).
   */
  moveStop(d: OpsData, orderId: string, vehicleId: string, reason: string) {
    const o = byId(d.orders, orderId)!
    const from = tripOf(d, o.tripId)
    if (!from || !['IN_PROGRESS', 'PAUSED'].includes(from.status) || isDoneStatus(o.status)) return { ok: false as const, message: 'Only stops on a vehicle that is on the road can be moved' }
    const opt = moveOptions(orderId, d, opMinutes(d)).find((x) => x.vehicle.id === vehicleId)
    if (!opt?.validation.ok) return { ok: false as const, message: `${vehicleId} can't take this stop`, validation: opt?.validation }
    const out = outletOf(d, o)
    from.stops = from.stops.filter((s) => s !== orderId)
    const change: TripChange = { id: uid('chg'), at: opNow(d), phase: 'route', added: [], removed: [{ orderId, to: vehicleId, reason }], reason }
    from.changes = [...(from.changes ?? []), change]
    const trip: Trip = { id: nextTripId(d.trips, vehicleId, 'M'), vehicleId, number: opt.validation.trip.number, brand: o.brand, district: out.district, departure: opt.departure, stops: [orderId], status: 'PLANNED', rescue: { from: from.id, reason } }
    d.trips.push(trip)
    o.tripId = trip.id
    o.status = 'PLANNED'
    o.lock = undefined
    o.loaded = undefined
    const eta = fmtMin(opt.eta)
    log(d, o.id, 'DISPATCHER', `Moved from ${from.vehicleId} to ${vehicleId} (${reason}) · leaves depot ${fmtMin(opt.departure)}, arrives ~${eta}`)
    log(d, from.vehicleId, 'DISPATCHER', `${out.id} taken off ${from.id}: ${reason}`)
    notify(d, { to: ['DRIVER'], vehicleId: from.vehicleId, severity: 'WARNING', title: `${out.id} moved to ${vehicleId}`, body: `Skip ${out.id}. Keep its goods on board and return them to ${byId(d.vehicles, from.vehicleId)?.depot}.`, link: '/driver/route' })
    notify(d, { to: ['LOADER'], severity: 'HIGH', title: `Re-pick ${out.id} for ${vehicleId}`, body: `Leaves ${fmtMin(opt.departure)} · ${o.items.map((i) => `${i.qty} ${i.name}`).join(', ')}`, link: `/loader/load/${trip.id}` })
    notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'WARNING', title: 'Delivery vehicle changed', body: `${o.id} now arrives on ${vehicleId} at about ${eta}`, link: `/store/orders/${o.id}` })
    commit(d)
    return { ok: true as const, tripId: trip.id, eta: opt.eta }
  },

  resolveIssue(d: OpsData, issueId: string, decision: string) {
    const i = byId(d.issues, issueId)
    if (!i || i.resolved) return
    i.resolved = { at: opNow(d), by: 'DISPATCHER', decision }
    if (i.kind === 'SHORTFALL' && i.orderIds?.[0]) {
      const o = byId(d.orders, i.orderIds[0])!
      if (o.shortfall) o.shortfall.decision = decision
      log(d, o.id, 'DISPATCHER', `Shortfall decision: ${decision}`)
      if (decision === 'Defer order') {
        commands.defer(d, o.id, 'inventory', DEFERRAL_LABEL.inventory, customerMessageFor('inventory'))
      } else {
        const t = tripOf(d, o.tripId)
        notify(d, { to: ['LOADER'], severity: 'INFO', title: 'Shortfall decision', body: `${outletOf(d, o).id}: ${decision}`, link: t ? `/loader/load/${t.id}` : '/loader' })
        notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'WARNING', title: 'Order adjusted', body: `${o.shortfall?.missing} × ${o.shortfall?.item} unavailable — ${decision.toLowerCase()}`, link: `/store/orders/${o.id}` })
      }
    }
    commit(d)
  },

  applyRecovery(d: OpsData, issueId: string) {
    const i = byId(d.issues, issueId)!
    const t = tripOf(d, i.tripId)
    if (!t || i.resolved) return
    const now = opMinutes(d)
    const plan = recoveryPlan(t.id, d, now)
    const change: TripChange = { id: uid('chg'), at: opNow(d), phase: 'route', added: [], removed: [], reason: `${t.vehicleId} breakdown recovery` }
    for (const opt of plan.options) {
      const v = byId(d.vehicles, opt.vehicleId)!
      const rescue: Trip = { id: nextTripId(d.trips, v.id, 'R'), vehicleId: v.id, number: 1, brand: t.brand, district: t.district, departure: opt.departure, stops: [], status: 'IN_PROGRESS', startedAt: opNow(d), rescue: { from: t.id, reason: 'Breakdown recovery' } }
      d.trips.push(rescue)
      for (const oid of opt.orderIds) {
        const o = byId(d.orders, oid)!
        t.stops = t.stops.filter((s) => s !== oid)
        rescue.stops.push(oid)
        o.tripId = rescue.id
        o.status = 'IN_TRANSIT'
        o.lock = undefined
        change.removed.push({ orderId: oid, to: v.id, reason: 'Breakdown recovery' })
        log(d, o.id, 'DISPATCHER', `Reassigned ${t.vehicleId} → ${v.id} after breakdown (+${opt.delayMin} min)`)
        notify(d, { to: ['STORE_MANAGER'], outletId: o.outletId, severity: 'WARNING', title: 'Delivery vehicle changed', body: `${o.id} now arrives on ${v.id} (about +${opt.delayMin} min)`, link: `/store/orders/${o.id}` })
      }
      rescue.stops = sequence(rescue.stops, d)
      if (v.reserve) log(d, v.id, 'DISPATCHER', `Recovery reserve released for ${t.vehicleId}`)
      notify(d, { to: ['DRIVER'], vehicleId: v.id, severity: 'WARNING', title: 'Rescue trip assigned', body: `Take over ${opt.orderIds.length} stops from ${t.vehicleId}`, link: '/driver/route' })
    }
    for (const oid of plan.defer) {
      change.removed.push({ orderId: oid, reason: 'Deferred after breakdown' })
      commands.defer(d, oid, 'breakdown', DEFERRAL_LABEL.breakdown, customerMessageFor('breakdown'), `Incident ${i.id}`)
    }
    if (change.removed.length) t.changes = [...(t.changes ?? []), change]
    const moved = plan.options.reduce((s, o) => s + o.orderIds.length, 0)
    const left = t.stops.filter((id) => !isDoneStatus(byId(d.orders, id)?.status))
    t.status = left.length ? 'PAUSED' : t.stops.length ? 'COMPLETED' : 'ABORTED'
    notify(d, { to: ['DRIVER'], vehicleId: t.vehicleId, severity: 'WARNING', title: 'Route updated', body: `${moved} stops reassigned${plan.defer.length ? `, ${plan.defer.length} deferred` : ''}. Remain safely stopped.`, link: '/driver/route' })
    i.resolved = { at: opNow(d), by: 'DISPATCHER', decision: `Recovery applied: ${moved} reassigned, ${plan.defer.length} deferred` }
    commit(d)
  },

  markRead(d: OpsData, role: Role) {
    for (const n of d.notifications) if (n.to.includes(role) && !n.readBy.includes(role)) n.readBy.push(role)
  },

  // ----- Sync & presence -----

  heartbeat(d: OpsData, email: string) {
    d.presence[email] = Date.now()
  },

  /** A device replayed its offline records. The dispatcher sees who was offline, for how long, and any conflicts. */
  recordSync(d: OpsData, report: Omit<SyncReport, 'id' | 'syncedAt'>) {
    const r: SyncReport = { ...report, id: uid('sync'), syncedAt: opNow(d) }
    d.syncLog.unshift(r)
    if (d.syncLog.length > 50) d.syncLog.length = 50
    d.presence[report.email] = Date.now()
    const mins = Math.max(1, Math.round((r.syncedAt - r.offlineFrom) / 60_000))
    notify(d, {
      to: ['DISPATCHER'],
      severity: r.conflicts.length || r.routeChanged ? 'WARNING' : 'INFO',
      title: `${r.vehicleId ?? r.name} back online`,
      body: `${r.events} records synced after ${mins} min offline${r.conflicts.length ? ` · ${r.conflicts.length} conflict resolved` : ''}${r.routeChanged ? ' · route change shown to driver' : ''}`,
      link: '/dispatcher/live',
    })
    commit(d)
  },

  // ----- Datathon model outputs -----

  loadPredictions(d: OpsData, p: Partial<Predictions> & { source?: string }) {
    d.predictions = {
      service: { ...d.predictions.service, ...(p.service ?? {}) },
      demand: p.demand?.length ? p.demand : d.predictions.demand,
      source: p.source ?? d.predictions.source,
      loadedAt: opNow(d),
    }
    commit(d)
  },

  // ----- Demo controls -----

  setClock(d: OpsData, ts: number) {
    setClock(d, ts)
    commit(d)
  },

  /** Move the operation clock to a minute of the delivery day (negative = the evening before). */
  setClockMinutes(d: OpsData, minutes: number) {
    setClock(d, colomboTs(d.deliveryDate, 0) + minutes * 60_000)
    commit(d)
  },

  /** Demo: the rest of the fleet heads out so live operations have something to show. */
  /**
   * Demo only: a vehicle with no demo driver account (the reserve van) drives its next trip and delivers every stop,
   * through the same field events a driver's phone sends, each at its scheduled time. The operation clock only moves
   * forward, to the last delivery.
   */
  simulateRun(d: OpsData, vehicleId: string) {
    // The vehicle's next trip in driving order (a Fresh trip 2 can leave before a Style trip 1).
    const t = d.trips
      .filter((x) => x.vehicleId === vehicleId && ['PLANNED', 'LOADING', 'LOADED', 'IN_PROGRESS'].includes(x.status) && x.stops.some((id) => !isDoneStatus(byId(d.orders, id)?.status)))
      .sort((a, b) => Number(b.status === 'IN_PROGRESS') - Number(a.status === 'IN_PROGRESS') || a.departure - b.departure)[0]
    if (!t) return { ok: false as const, message: `${vehicleId} has nothing left to deliver` }
    const at = (min: number) => colomboTs(d.deliveryDate, min)
    if (t.status !== 'IN_PROGRESS') {
      const r = applyEvent(d, { actor: 'DRIVER', event: { type: 'START_ROUTE', tripId: t.id }, at: Math.max(at(t.departure), t.startedAt ?? 0) })
      if (r.status === 'rejected') return { ok: false as const, message: r.message ?? 'Could not start the trip' }
    }
    let delivered = 0
    let last = opNow(d)
    for (const s of scheduleOfTrip(d, t).stops) {
      const o = byId(d.orders, s.orderId)
      if (!o || isDoneStatus(o.status)) continue
      const done = at(s.finish)
      if (o.status !== 'ARRIVED') applyEvent(d, { actor: 'DRIVER', event: { type: 'ARRIVE', orderId: o.id, tripId: t.id }, at: at(s.start) })
      const r = applyEvent(d, { actor: 'DRIVER', event: { type: 'DELIVER', orderId: o.id, tripId: t.id, record: { outcome: 'DELIVERED', receiver: outletOf(d, o).manager, arrivedAt: at(s.start), completedAt: done } }, at: done })
      if (r.status === 'applied') delivered++
      last = Math.max(last, done)
    }
    if (last > opNow(d)) setClock(d, last)
    commit(d)
    return { ok: true as const, tripId: t.id, delivered }
  },

  /** Demo only: every vehicle drives its remaining trips, so the day can be closed. Paused trips stay as they are. */
  simulateDayEnd(d: OpsData) {
    let delivered = 0
    let trips = 0
    for (const v of d.vehicles) {
      for (let i = 0; i < 4; i++) {
        const r = commands.simulateRun(d, v.id)
        if (!r.ok) break
        delivered += r.delivered
        trips++
      }
    }
    // Trips whose stops were all delivered (or moved away) have nothing left to drive.
    for (const t of d.trips) if (['PLANNED', 'LOADING', 'LOADED'].includes(t.status) && t.stops.every((id) => isDoneStatus(byId(d.orders, id)?.status))) t.status = t.stops.length ? 'COMPLETED' : 'ABORTED'
    commit(d)
    return { trips, delivered }
  },

  simulateFleet(d: OpsData, keep: string) {
    if (opMinutes(d) < hm(5, 40)) setClock(d, colomboTs(d.deliveryDate, hm(5, 40)))
    const now = opNow(d)
    let k = 0
    for (const t of d.trips) {
      if (t.vehicleId === keep || !['PLANNED', 'LOADING', 'LOADED'].includes(t.status) || t.brand !== 'Fresh' || t.number !== 1) continue
      t.status = 'IN_PROGRESS'
      t.startedAt = colomboTs(d.deliveryDate, t.departure)
      const sched = scheduleOfTrip(d, t)
      const done = Math.floor(t.stops.length * (0.3 + ((k++ * 37) % 50) / 100))
      t.stops.forEach((id, idx) => {
        const o = byId(d.orders, id)!
        if (idx < done) {
          o.status = 'DELIVERED'
          const at = Math.min(now - 60_000, colomboTs(d.deliveryDate, sched.stops[idx]?.finish ?? t.departure))
          o.delivery = { outcome: 'DELIVERED', receiver: outletOf(d, o).manager, completedAt: at }
          log(d, o.id, 'DRIVER', 'Delivered in full', at)
        } else o.status = 'IN_TRANSIT'
      })
    }
    for (const t of d.trips) if (t.vehicleId !== keep && t.status === 'PLANNED' && t.brand === 'Fresh') t.status = 'LOADED'
    const late = d.trips.find((t) => t.status === 'IN_PROGRESS' && t.vehicleId !== keep && t.stops.length > 3)
    if (late) {
      const s = scheduleOfTrip(d, late).stops.at(-1)!
      raise(d, { kind: 'LATE_RISK', severity: 'HIGH', title: `${s.outletId} may miss its window`, detail: `${late.vehicleId} running 18 min behind plan · window closes ${fmtMin(s.window[1])}`, orderIds: [s.orderId], tripId: late.id, vehicleId: late.vehicleId })
    }
    const fuel = d.vehicles.find((v) => v.id === 'VEH024')
    if (fuel) raise(d, { kind: 'FUEL', severity: 'INFO', title: 'VEH024 fuel quota', detail: `${Math.round((fuel.fuelUsedL / fuel.fuelQuotaL) * 100)}% of weekly quota used — held off long routes`, vehicleId: 'VEH024' })
    commit(d)
  },
}

export type CommandName = keyof typeof commands

export function severityRank(s: Severity) {
  return { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 }[s]
}

/** Which commands each role may send (the API enforces this; demo controls are open when DEMO_MODE is on). */
export const COMMAND_ROLES: Record<CommandName, Role[] | 'demo'> = {
  createOrder: ['STORE_MANAGER'],
  confirmReceipt: ['STORE_MANAGER'],
  storeIssue: ['STORE_MANAGER'],
  acknowledgeDeferral: ['STORE_MANAGER'],
  closeOrders: ['DISPATCHER'],
  startNextDay: ['DISPATCHER'],
  generatePlan: ['DISPATCHER'],
  publishPlan: ['DISPATCHER'],
  assign: ['DISPATCHER'],
  unassign: ['DISPATCHER'],
  lockStop: ['DISPATCHER'],
  unlockStop: ['DISPATCHER'],
  lockTrip: ['DISPATCHER'],
  unlockTrip: ['DISPATCHER'],
  defer: ['DISPATCHER'],
  confirmDeferral: ['DISPATCHER'],
  moveStop: ['DISPATCHER'],
  resolveIssue: ['DISPATCHER'],
  applyRecovery: ['DISPATCHER'],
  markRead: ['DISPATCHER', 'LOADER', 'DRIVER', 'STORE_MANAGER'],
  heartbeat: ['DISPATCHER', 'LOADER', 'DRIVER', 'STORE_MANAGER'],
  recordSync: ['LOADER', 'DRIVER'],
  loadPredictions: ['DISPATCHER'],
  setClock: 'demo',
  setClockMinutes: 'demo',
  simulateFleet: 'demo',
  simulateRun: 'demo',
  simulateDayEnd: 'demo',
}

/** Which field events each role may record. */
export const EVENT_ROLES: Record<FieldEvent['type'], Role[]> = {
  LOAD_START: ['LOADER'],
  LOAD_COUNT: ['LOADER'],
  SHORTFALL: ['LOADER'],
  LOAD_COMPLETE: ['LOADER'],
  LOAD_CHANGE_ACK: ['LOADER'],
  START_ROUTE: ['DRIVER'],
  ARRIVE: ['DRIVER'],
  DELIVER: ['DRIVER'],
  PROOF: ['DRIVER'],
  VEHICLE_ISSUE: ['DRIVER'],
  ROUTE_ACK: ['DRIVER'],
}

export { isOperating, nextOperatingDay }
export type { DeliveryRecord }
