/**
 * Named states of the demo story, built by running the real commands and events on a fresh seed.
 * Open any screen with ?demo=<id> to see that state in a sandbox (see demo/mode.ts).
 */
import { applyEvent, commands, opNow, seedOps, setClock, uid } from '@core/ops'
import { byId, validate } from '@core/rules'
import { colomboDate, colomboTs, hm } from '@core/time'
import type { FieldEvent, OpsData, QueuedEvent, Role } from '@core/types'
import { detectConflict, type RouteConflict } from '../store/conflict'
import { DAY } from './mode'

export interface PresetDevice {
  queue: QueuedEvent[]
  snapshot: OpsData | null
  offlineFrom: number | null
  conflict: RouteConflict | null
  lastSync: number | null
}

export interface PresetState {
  data: OpsData
  device?: PresetDevice
  offline?: boolean
}

export interface Preset {
  id: string
  title: string
  role: Role
  group: 'Dispatcher' | 'Loader' | 'Driver' | 'Store manager'
  /** Screen to open for this state. */
  path: string
  note: string
  degradation?: boolean
  build: () => PresetState
}

const STORY = 'TRP-014-1'
/** Fresh seed, on the pinned ordering day when ?day= is set. */
const seed = () => seedOps(DAY ? { today: DAY } : {})
const at = (d: OpsData, min: number) => setClock(d, colomboTs(d.deliveryDate, min))
const ev = (d: OpsData, actor: Role, event: FieldEvent) => applyEvent(d, { actor, event, at: opNow(d) })
const orderAt = (d: OpsData, outletId: string, temp: 'CHILLED' | 'AMBIENT' = 'CHILLED') => d.orders.find((o) => o.outletId === outletId && o.temp === temp)!
const storeOrder = (d: OpsData) => orderAt(d, 'OUT032')

function planned() {
  const d = seed()
  commands.closeOrders(d)
  // Plan at 16:05 on the ordering day, just after the cutoff.
  commands.setClock(d, colomboTs(colomboDate(opNow(d)), hm(16, 5)))
  commands.generatePlan(d)
  return d
}
function published() {
  const d = planned()
  commands.publishPlan(d)
  return d
}
function loading(countAll = false) {
  const d = published()
  at(d, hm(3, 40))
  ev(d, 'LOADER', { type: 'LOAD_START', tripId: STORY })
  const trip = byId(d.trips, STORY)!
  for (const id of trip.stops) {
    const o = byId(d.orders, id)!
    if (!countAll && o.outletId === 'OUT032') continue
    for (const i of o.items) ev(d, 'LOADER', { type: 'LOAD_COUNT', orderId: id, item: i.name, count: i.qty })
  }
  return d
}
/** 03:52 — Kamal counts OUT032 and finds 3 dairy crates damaged in the cold room; he flags it before departure. */
function shortfallReported() {
  const d = loading()
  at(d, hm(3, 52))
  const o = storeOrder(d)
  for (const i of o.items) ev(d, 'LOADER', { type: 'LOAD_COUNT', orderId: o.id, item: i.name, count: i.name === 'Dairy' ? i.qty - 3 : i.qty })
  ev(d, 'LOADER', { type: 'SHORTFALL', orderId: o.id, item: 'Dairy', missing: 3, reason: 'Damaged in the cold room' })
  at(d, hm(3, 55))
  return d
}
/** 03:58 — Geemal decides to send the rest of the order; the loader and the store see the decision. */
function shortfallDecided() {
  const d = shortfallReported()
  at(d, hm(3, 58))
  commands.resolveIssue(d, d.issues.find((i) => i.kind === 'SHORTFALL')!.id, 'Continue delivery')
  at(d, hm(4, 0))
  return d
}
function loaded() {
  const d = loading(true)
  ev(d, 'LOADER', { type: 'LOAD_COMPLETE', tripId: STORY })
  at(d, hm(4, 25))
  return d
}
/** Dispatcher takes OUT056 off VEH014 and adds a deferred Colombo chilled order after loading began. */
function planChanged() {
  const d = loading(true)
  at(d, hm(4, 5))
  const trip = byId(d.trips, STORY)!
  const drop = orderAt(d, 'OUT056')
  commands.unassign(d, drop.id)
  const veh = byId(d.vehicles, trip.vehicleId)!
  const add = d.orders
    .filter((o) => o.status === 'DEFERRED' && o.temp === 'CHILLED' && byId(d.outlets, o.outletId)?.district === 'Colombo' && byId(d.outlets, o.outletId)?.depot === veh.depot)
    .find((o) => validate(o, veh, d).ok)
  if (add) commands.assign(d, add.id, veh.id)
  return d
}
function enRoute() {
  const d = loaded()
  at(d, hm(4, 38))
  ev(d, 'DRIVER', { type: 'START_ROUTE', tripId: STORY })
  const first = byId(d.trips, STORY)!.stops[0]
  at(d, hm(5, 6))
  ev(d, 'DRIVER', { type: 'ARRIVE', orderId: first, tripId: STORY })
  at(d, hm(5, 20))
  ev(d, 'DRIVER', { type: 'DELIVER', orderId: first, tripId: STORY, record: { outcome: 'DELIVERED', receiver: 'Store staff', completedAt: opNow(d) } })
  return d
}
/** 05:22 — before losing signal Nimal reports that the road to OUT032 is flooded: about 90 minutes' detour. */
function reportBlocked(d: OpsData) {
  at(d, hm(5, 22))
  ev(d, 'DRIVER', { type: 'VEHICLE_ISSUE', vehicleId: 'VEH014', tripId: STORY, kind: 'Road blocked', delayOrderId: storeOrder(d).id, delayMin: 90, note: 'Baseline Road flooded near Borella — police diversion' })
}
/**
 * Driver reports the blocked road, loses signal at 05:24 and keeps recording on the phone.
 * With collided, the road reopened, so he went straight to OUT032 and delivered it before the dispatcher's change reached him.
 */
function offline(until = hm(6, 18), collided = false): PresetState {
  const d = enRoute()
  reportBlocked(d)
  at(d, hm(5, 24))
  const offlineFrom = opNow(d)
  const snapshot = structuredClone(d)
  const trip = byId(d.trips, STORY)!
  const queue: QueuedEvent[] = []
  const rec = (event: FieldEvent, min: number) => min <= until && queue.push({ id: uid('evt'), at: colomboTs(d.deliveryDate, min), actor: 'DRIVER', event, status: 'pending' })
  const [a, b] = collided ? [storeOrder(d).id, null] : [trip.stops[1], trip.stops[2]]
  rec({ type: 'ARRIVE', orderId: a, tripId: STORY }, hm(5, 36))
  rec({ type: 'DELIVER', orderId: a, tripId: STORY, record: { outcome: 'DELIVERED', receiver: collided ? 'Dilini' : 'Store staff', offline: true, completedAt: colomboTs(d.deliveryDate, hm(5, 52)) } }, hm(5, 52))
  if (b) {
    rec({ type: 'ARRIVE', orderId: b, tripId: STORY }, hm(6, 1))
    rec({ type: 'DELIVER', orderId: b, tripId: STORY, record: { outcome: 'DELIVERED', receiver: 'Store staff', offline: true, completedAt: colomboTs(d.deliveryDate, hm(6, 16)) } }, hm(6, 16))
  }
  at(d, until)
  // The dispatcher last heard from the phone when it lost signal.
  d.presence['driver@kairon.demo'] = Date.now() - (until - hm(5, 24)) * 60_000
  return { data: d, device: { queue, snapshot, offlineFrom, conflict: null, lastSync: offlineFrom }, offline: true }
}
/**
 * 05:40 — the dispatcher moves OUT032 to the reserve van VEH031 (re-picked, leaves 06:05); the phone reconnects.
 * Normally at 06:20 after two more deliveries. With collided, at 06:00 with OUT032 already delivered: the
 * driver's record wins and the van's re-pick is cancelled before it leaves.
 */
function conflict(collided = false): PresetState {
  const syncAt = collided ? hm(6, 0) : hm(6, 20)
  const s = offline(syncAt, collided)
  const d = s.data
  at(d, hm(5, 40))
  commands.moveStop(d, storeOrder(d).id, 'VEH031', 'Road to Borella flooded — Nimal reported ~90 min detour, would miss the 07:30 window. Sent on the reserve van.')
  at(d, syncAt)
  const delivered: string[] = []
  const clashes: string[] = []
  for (const q of s.device!.queue) {
    const r = applyEvent(d, q)
    if (q.event.type === 'DELIVER' && r.status === 'applied') delivered.push(q.event.orderId)
    if (r.conflict && 'orderId' in q.event && !clashes.includes(q.event.orderId)) clashes.push(q.event.orderId)
  }
  commands.recordSync(d, { email: 'driver@kairon.demo', name: 'Nimal', role: 'DRIVER', vehicleId: 'VEH014', offlineFrom: s.device!.offlineFrom!, events: s.device!.queue.length, deliveries: delivered.length, conflicts: clashes, routeChanged: true })
  const c = detectConflict(s.device!.snapshot!, d, 'VEH014', s.device!.offlineFrom!, delivered, clashes, opNow(d))
  return { data: d, device: { queue: [], snapshot: null, offlineFrom: null, conflict: c, lastSync: opNow(d) } }
}
/** Driver has just arrived at stop 2 and is recording the delivery. */
function atStop() {
  const d = enRoute()
  at(d, hm(5, 36))
  ev(d, 'DRIVER', { type: 'ARRIVE', orderId: byId(d.trips, STORY)!.stops[1], tripId: STORY })
  at(d, hm(5, 41))
  return d
}
function breakdown() {
  const d = enRoute()
  at(d, hm(5, 34))
  ev(d, 'DRIVER', { type: 'VEHICLE_ISSUE', vehicleId: 'VEH014', tripId: STORY, kind: 'Breakdown', note: 'Engine overheating on Galle Road' })
  return d
}
function recovered() {
  const d = breakdown()
  at(d, hm(5, 42))
  commands.applyRecovery(d, d.issues.find((i) => i.kind === 'BREAKDOWN')!.id)
  return d
}
function live() {
  const d = conflict().data
  // 06:21 — Nimal taps “I’ve seen the changes”.
  at(d, hm(6, 21))
  ev(d, 'DRIVER', { type: 'ROUTE_ACK', tripId: STORY, changeIds: (byId(d.trips, STORY)!.changes ?? []).map((c) => c.id) })
  commands.simulateFleet(d, 'VEH014')
  return d
}
function storeDelivered() {
  const d = enRoute()
  const o = storeOrder(d)
  if (o.status !== 'DELIVERED') {
    at(d, hm(5, 45))
    ev(d, 'DRIVER', { type: 'ARRIVE', orderId: o.id, tripId: STORY })
    at(d, hm(5, 58))
    ev(d, 'DRIVER', { type: 'DELIVER', orderId: o.id, tripId: STORY, record: { outcome: 'DELIVERED', receiver: 'Dilini', completedAt: opNow(d) } })
  }
  return d
}
function storeDeferred() {
  const d = published()
  const o = storeOrder(d)
  commands.defer(d, o.id, 'reefer_capacity', 'No reefer space', 'Refrigerated delivery space was fully used on this run. Your order has high priority on the next run.')
  return d
}

const one = (build: () => OpsData) => () => ({ data: build() })

export const PRESETS: Preset[] = [
  { id: 'orders-open', title: 'Orders open (15:20)', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher', note: 'Ordering day, 40 minutes before the 16:00 cutoff.', build: one(seed) },
  { id: 'close-orders', title: 'Closing orders at the cutoff', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/orders?close=1', note: 'Confirmed orders enter one planning queue; late orders roll to the next run.', build: one(seed) },
  { id: 'blocked', title: 'Allocation blocked by a rule', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/planning?modal=blocked', note: 'A chilled order dropped on a dry truck: every rule checked, no override, vehicles that fit suggested.', build: one(planned) },
  { id: 'plan-draft', title: 'Draft plan on an over-capacity day', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/planning', note: 'Recommended plan with deferrals, the binding resource and the recovery-reserve trade-off.', build: one(planned) },
  { id: 'plan-published', title: 'Plan published', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/planning', note: 'Loaders, drivers and stores notified.', build: one(published) },
  { id: 'deferrals', title: 'Deferral review', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/deferred', note: 'Every deferral with its constraint, calculation and next run.', build: one(planned) },
  { id: 'forecast', title: 'Capacity forecast', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/capacity', note: 'Depot × brand × week demand (Datathon Task 2A slot).', build: one(planned) },
  { id: 'move-stop', title: 'Move a stop mid-route', role: 'DISPATCHER', group: 'Dispatcher', path: `/dispatcher/routes/${STORY}?modal=move-stop`, note: 'Driver reported a flooded road, then lost signal: the dispatcher compares staying with moving before taking the stop off.', build: () => offline(hm(5, 40)) },
  { id: 'synced', title: 'Driver back online', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/live', note: 'Sync report: who was offline, what arrived, which change the driver saw.', degradation: true, build: () => ({ data: live() }) },
  { id: 'shortfall-reported', title: 'Loading shortfall to decide', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/issues/shortfall', note: 'The loader flagged damaged dairy before departure; the dispatcher decides.', build: one(shortfallReported) },
  { id: 'breakdown', title: 'Breakdown recovery', role: 'DISPATCHER', group: 'Dispatcher', path: '/dispatcher/issues/breakdown', note: 'Recovery plan using the reserve reefer.', degradation: true, build: one(breakdown) },

  { id: 'loading', title: 'Loading in stop order', role: 'LOADER', group: 'Loader', path: `/loader/load/${STORY}`, note: 'Last stop in first; one stop left to count.', build: one(() => loading()) },
  { id: 'shortfall', title: 'Shortfall before departure', role: 'LOADER', group: 'Loader', path: `/loader/load/${STORY}?modal=shortfall`, note: 'Loader flags missing dairy before the vehicle leaves.', build: one(() => loading()) },
  { id: 'shortfall-decided', title: 'Shortfall decision received', role: 'LOADER', group: 'Loader', path: `/loader/load/${STORY}?stop=OUT032`, note: 'The dispatcher’s decision appears on the stop the loader flagged.', build: one(shortfallDecided) },
  { id: 'plan-changed', title: 'Plan changed after loading started', role: 'LOADER', group: 'Loader', path: `/loader/load/${STORY}`, note: 'Second degradation screen: unload one stop, add one, confirm before departure.', degradation: true, build: one(planChanged) },

  { id: 'ready', title: 'Loaded, ready to leave', role: 'DRIVER', group: 'Driver', path: '/driver', note: '04:25, night theme.', build: one(loaded) },
  { id: 'change-pending', title: 'Waiting for the loader to re-check', role: 'DRIVER', group: 'Driver', path: '/driver', note: 'Departure blocked until the new load is confirmed.', degradation: true, build: one(planChanged) },
  { id: 'in-route', title: 'On the road', role: 'DRIVER', group: 'Driver', path: '/driver/route', note: 'Next stop, ETA, model estimates.', build: one(enRoute) },
  { id: 'offline', title: 'Offline mid-route', role: 'DRIVER', group: 'Driver', path: '/driver/route', note: 'Two deliveries saved on the phone, waiting to sync.', degradation: true, build: () => offline() },
  { id: 'conflict', title: 'Reconnected — route changed', role: 'DRIVER', group: 'Driver', path: '/driver/reconcile', note: 'Hero degradation screen: what was kept, what moved, what to do now.', degradation: true, build: conflict },
  { id: 'conflict-collided', title: 'Reconnected — delivered before the change', role: 'DRIVER', group: 'Driver', path: '/driver/reconcile', note: 'Edge case: the road reopened and the driver delivered the moved stop offline; his record wins and the van’s re-pick is cancelled before it leaves.', degradation: true, build: () => conflict(true) },
  { id: 'at-stop', title: 'Proof of delivery', role: 'DRIVER', group: 'Driver', path: '/driver/stop/next?modal=proof', note: 'Outcome, items, receiver, photo or signature — works offline.', build: one(atStop) },
  { id: 'recovered', title: 'After a breakdown', role: 'DRIVER', group: 'Driver', path: '/driver', note: 'Stops handed to the reserve reefer.', degradation: true, build: one(recovered) },

  { id: 'store-ordering', title: 'Ordering before cutoff', role: 'STORE_MANAGER', group: 'Store manager', path: '/store/orders/new', note: 'Countdown to 16:00; chilled and dry split into two deliveries.', build: one(seed) },
  { id: 'store-scheduled', title: 'Delivery scheduled with ETA', role: 'STORE_MANAGER', group: 'Store manager', path: '/store', note: 'Expected arrival for staffing.', build: one(published) },
  { id: 'store-deferred', title: 'Order moved to the next run', role: 'STORE_MANAGER', group: 'Store manager', path: '/store', note: 'Clear notice with the reason and new date.', build: one(storeDeferred) },
  { id: 'store-shortfall', title: 'Told what will be missing', role: 'STORE_MANAGER', group: 'Store manager', path: '/store', note: 'Before the truck leaves, the store sees what is short and what the dispatcher decided.', build: one(shortfallDecided) },
  { id: 'store-issue', title: 'Report a delivery issue', role: 'STORE_MANAGER', group: 'Store manager', path: '/store?modal=report-issue', note: 'Missing, damaged or wrong goods reach the dispatcher with a photo.', build: one(storeDelivered) },
  { id: 'store-delivered', title: 'Confirm receipt', role: 'STORE_MANAGER', group: 'Store manager', path: '/store', note: 'Confirm what arrived or report an issue.', build: one(storeDelivered) },
]

export function buildPreset(id: string): (PresetState & { preset: Preset }) | null {
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) return null
  return { ...preset.build(), preset }
}

