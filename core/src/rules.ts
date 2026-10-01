/**
 * Operating rules and the planning engine. Shared by the web app (so planning works offline and every
 * drag is validated instantly) and the API (so nothing invalid is ever stored).
 *
 * Trip time follows the booklet's Task 2B formula exactly:
 *   trip_minutes = depot_to_district_freeflow_min + inter_stop_freeflow_min × (stops − 1) + Σ service_allowance_min
 * with no return leg. Budgets are per vehicle per day: Fresh trips share 270 min (03:30–08:00),
 * Style + Tech trips share 480 min (trading day), and a vehicle runs at most two trips in total.
 */
import { DEPOT_POS } from './reference'
import { fmtMin, hm, type Minutes } from './time'
import type { Brand, DeferralCode, DistrictInfo, OpsData, Order, Outlet, PlanAnalysis, Trip, TripStatus, Vehicle, VehicleType } from './types'

export const FRESH_START = hm(3, 30)
export const FRESH_END = hm(8)
export const STYLE_TECH_START = hm(6, 30)
export const BUDGET = { fresh: 270, styleTech: 480 } as const
export const TRIPS_PER_VEHICLE = 2
/** Return, unload and reload between a vehicle's two trips. */
export const RELOAD_MIN = 20
/** A move-stop re-picks the goods at the depot before the new vehicle leaves. */
export const REPICK_MIN = 25
/** After a breakdown, the rescue vehicle drives out and transfers the load. */
export const TRANSFER_MIN = 30

export type World = Pick<OpsData, 'orders' | 'outlets' | 'vehicles' | 'trips' | 'districts' | 'allowances'>
export type BudgetGroup = keyof typeof BUDGET

export const byId = <T extends { id: string }>(list: T[], id?: string) => (id ? list.find((x) => x.id === id) : undefined)
export const DONE: Order['status'][] = ['DELIVERED', 'PARTIAL', 'FAILED', 'RECEIVED']
export const isDoneStatus = (s?: Order['status']) => !!s && DONE.includes(s)

export const isReefer = (t: VehicleType) => t === 'REEFER_TRUCK' || t === 'REEFER_VAN'
export const isVan = (t: VehicleType) => t === 'VAN' || t === 'REEFER_VAN'
export const VEHICLE_LABEL: Record<VehicleType, string> = { REEFER_TRUCK: 'Reefer truck', REEFER_VAN: 'Reefer van', TRUCK: 'Dry-box truck', VAN: 'Van' }
export const vehicleLabel = (t: VehicleType) => VEHICLE_LABEL[t]

export const budgetGroup = (b: Brand): BudgetGroup => (b === 'Fresh' ? 'fresh' : 'styleTech')
export const groupStart = (g: BudgetGroup) => (g === 'fresh' ? FRESH_START : STYLE_TECH_START)
export const BUDGET_LABEL: Record<BudgetGroup, string> = { fresh: 'Fresh window · 03:30–08:00', styleTech: 'Style + Tech · trading day' }

const EDITABLE: TripStatus[] = ['DRAFT', 'PLANNED', 'LOADING', 'LOADED']
export const isEditable = (t: Pick<Trip, 'status'>) => EDITABLE.includes(t.status)
/** Trips whose departure no longer moves: started, finished, or rescue trips with a fixed leave time. */
const isFixed = (t: Trip) => !isEditable(t) || !!t.rescue

export function districtOf(w: Pick<World, 'districts'>, name: string): DistrictInfo {
  return (
    w.districts.find((d) => d.district === name) ?? {
      district: name,
      depot: 'Peliyagoda',
      road_class: 'suburban',
      free_flow_kmh: 40,
      depot_to_district_km: 30,
      depot_to_district_freeflow_min: 45,
      inter_stop_km: 6,
      inter_stop_freeflow_min: 10,
      ...DEPOT_POS.Peliyagoda,
    }
  )
}

export function allowanceFor(w: Pick<World, 'allowances'>, brand: Brand, dock: Outlet['dock']): number {
  return w.allowances.find((a) => a.brand === brand && a.dock_type === dock)?.service_allowance_min ?? 15
}

/** Delivery order within a trip: earliest window close first, then earliest open, then outlet id. */
export function sequence(stopIds: string[], w: Pick<World, 'orders' | 'outlets'>): string[] {
  const key = (id: string) => {
    const o = byId(w.orders, id)
    const out = o && byId(w.outlets, o.outletId)
    return out ? [out.window[1], out.window[0], out.id] : [9999, 9999, id]
  }
  return [...stopIds].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return (ka[0] as number) - (kb[0] as number) || (ka[1] as number) - (kb[1] as number) || String(ka[2]).localeCompare(String(kb[2]))
  })
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export interface StopPlan {
  orderId: string
  outletId: string
  /** Planned arrival at the outlet. */
  eta: Minutes
  /** Service starts at the window opening if the vehicle arrives early. */
  start: Minutes
  wait: number
  window: [Minutes, Minutes]
  /** Service allowance (planning figure from service_allowance.csv). */
  service: number
  finish: Minutes
  /** Arrives after the window closes. */
  late: boolean
  /** Minutes between arrival and window close (negative = late). */
  slack: number
}

export interface Schedule {
  stops: StopPlan[]
  departure: Minutes
  outbound: number
  interStop: number
  handling: number
  /** Booklet trip_minutes: outbound + inter-stop + handling, no return leg. */
  minutes: number
  finish: Minutes
  /** Back at the depot (used to time a second trip). */
  returnAt: Minutes
  /** finish − departure, including any waiting for windows to open. */
  totalMin: number
  distanceKm: number
  fuelL: number
  weightKg: number
  volumeM3: number
  /** Stop ids whose order or outlet is not in the data. They are left out of the timings, so callers must not ignore them. */
  unknownOrders: string[]
}

export function scheduleTrip(trip: Pick<Trip, 'district' | 'stops' | 'departure' | 'brand'>, vehicle: Vehicle, w: Omit<World, 'trips' | 'vehicles'>): Schedule {
  const dist = districtOf(w, trip.district)
  const stops: StopPlan[] = []
  let t = trip.departure + dist.depot_to_district_freeflow_min
  let handling = 0
  let weightKg = 0
  let volumeM3 = 0
  const unknownOrders: string[] = []
  trip.stops.forEach((id, i) => {
    const o = byId(w.orders, id)
    const out = o && byId(w.outlets, o.outletId)
    if (!o || !out) {
      unknownOrders.push(id)
      return
    }
    if (i > 0) t += dist.inter_stop_freeflow_min
    const eta = t
    const start = Math.max(eta, out.window[0])
    const service = allowanceFor(w, trip.brand, out.dock)
    stops.push({ orderId: id, outletId: out.id, eta, start, wait: start - eta, window: out.window, service, finish: start + service, late: eta > out.window[1], slack: out.window[1] - eta })
    handling += service
    t = start + service
    weightKg += o.weightKg
    volumeM3 += o.volumeM3
  })
  const n = stops.length
  const interStop = dist.inter_stop_freeflow_min * Math.max(0, n - 1)
  const outbound = n ? dist.depot_to_district_freeflow_min : 0
  const distanceKm = n ? 2 * dist.depot_to_district_km + dist.inter_stop_km * (n - 1) : 0
  return {
    stops,
    departure: trip.departure,
    outbound,
    interStop,
    handling,
    minutes: outbound + interStop + handling,
    finish: n ? t : trip.departure,
    returnAt: n ? t + dist.depot_to_district_freeflow_min : trip.departure,
    totalMin: n ? t - trip.departure : 0,
    distanceKm,
    fuelL: Math.round((distanceKm / vehicle.kmPerL) * 10) / 10,
    weightKg: Math.round(weightKg),
    volumeM3: Math.round(volumeM3 * 100) / 100,
    unknownOrders,
  }
}

export interface DayPlan {
  trips: { trip: Trip; sched: Schedule; number: 1 | 2 }[]
  freshMin: number
  styleTechMin: number
  fuelL: number
}

/**
 * Lay out one vehicle's trips for the day. Fresh trips run first, from 03:30; Style and Tech from 06:30.
 * An editable trip leaves just in time to reach its first window, but never before the vehicle is back
 * from its previous trip and reloaded.
 */
export function vehicleDay(vehicle: Vehicle, trips: Trip[], w: Omit<World, 'trips' | 'vehicles'>): DayPlan {
  const active = trips.filter((t) => t.vehicleId === vehicle.id && t.status !== 'ABORTED' && t.stops.length)
  const rank = (t: Trip) => (budgetGroup(t.brand) === 'fresh' ? 0 : 1)
  // Order depends only on trip content, so a validation and the saved plan always lay the day out the same way:
  // started/fixed trips by their departure, then the trip whose windows close earliest goes first.
  const closes = (t: Trip) => Math.min(...t.stops.map((id) => byId(w.outlets, byId(w.orders, id)?.outletId)?.window[1] ?? 1e4))
  const ordered = [...active].sort(
    (a, b) => rank(a) - rank(b) || (isFixed(a) ? a.departure : 1e4) - (isFixed(b) ? b.departure : 1e4) || closes(a) - closes(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  let ready = 0
  const out: DayPlan['trips'] = []
  let freshMin = 0
  let styleTechMin = 0
  let fuelL = 0
  ordered.forEach((trip, i) => {
    let departure = trip.departure
    if (!isFixed(trip)) {
      const g = budgetGroup(trip.brand)
      const dist = districtOf(w, trip.district)
      const first = byId(w.orders, trip.stops[0])
      const firstOpen = (first && byId(w.outlets, first.outletId)?.window[0]) ?? groupStart(g)
      departure = Math.max(groupStart(g), ready, firstOpen - dist.depot_to_district_freeflow_min)
    }
    const sched = scheduleTrip({ ...trip, departure }, vehicle, w)
    ready = sched.returnAt + RELOAD_MIN
    if (budgetGroup(trip.brand) === 'fresh') freshMin += sched.minutes
    else styleTechMin += sched.minutes
    fuelL += sched.fuelL
    out.push({ trip, sched, number: Math.min(2, i + 1) as 1 | 2 })
  })
  return { trips: out, freshMin, styleTechMin, fuelL: Math.round(fuelL * 10) / 10 }
}

/** Write numbers and departures back onto a vehicle's trips (editable trips only move their departure). */
export function retime(d: World, vehicleId: string) {
  const v = byId(d.vehicles, vehicleId)
  if (!v) return
  for (const { trip, sched, number } of vehicleDay(v, d.trips, d).trips) {
    trip.number = number
    if (!isFixed(trip)) trip.departure = sched.departure
  }
}

export function retimeAll(d: World) {
  for (const id of new Set(d.trips.map((t) => t.vehicleId))) retime(d, id)
}

export function scheduleOfTrip(d: World, t: Trip): Schedule {
  const v = byId(d.vehicles, t.vehicleId)!
  return scheduleTrip(t, v, d)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type CheckKey = 'status' | 'reserve' | 'depot' | 'temperature' | 'access' | 'mall' | 'orders' | 'trip' | 'trips' | 'weight' | 'volume' | 'window' | 'budget' | 'fuel'

export interface Check {
  key: CheckKey
  label: string
  ok: boolean
  /** Warnings are shown but never block the allocation. */
  blocking: boolean
  detail: string
}

export interface Validation {
  ok: boolean
  checks: Check[]
  trip: { id?: string; number: 1 | 2; stops: string[]; departure: Minutes; brand: Brand; district: string; isNew: boolean }
  schedule: Schedule
  day: DayPlan
  fuelProjected: number
}

export interface ValidateOptions {
  /** Rescue mode: a new trip that leaves at this fixed time. */
  rescueDeparture?: Minutes
  /** Join this specific trip (used to grow a rescue trip). */
  joinTrip?: string
  /** Only join draft trips (the planner never edits a published trip). */
  draftOnly?: boolean
}

/** Would adding `order` to `vehicle` keep every operating constraint? The order joins the vehicle's matching trip or opens a new one. */
export function validate(order: Order, vehicle: Vehicle, w: World, opts: ValidateOptions = {}): Validation {
  // The order under test is always known, even if the caller's snapshot does not list it yet.
  if (!w.orders.some((x) => x.id === order.id)) w = { ...w, orders: [...w.orders, order] }
  const outlet = byId(w.outlets, order.outletId)!
  const mine = w.trips.filter((t) => t.vehicleId === vehicle.id && t.status !== 'ABORTED').map((t) => ({ ...t, stops: t.stops.filter((s) => s !== order.id) }))
  const rescue = opts.rescueDeparture !== undefined
  const target = opts.joinTrip ? mine.find((t) => t.id === opts.joinTrip) : rescue ? undefined : mine.find((t) => isEditable(t) && (!opts.draftOnly || t.status === 'DRAFT') && !t.rescue && t.brand === order.brand && t.district === outlet.district)
  const focus: Trip = target
    ? { ...target, stops: target.rescue ? [...target.stops, order.id] : sequence([...target.stops, order.id], w) }
    : { id: '__new', vehicleId: vehicle.id, number: 1, brand: order.brand, district: outlet.district, departure: opts.rescueDeparture ?? 0, stops: [order.id], status: 'DRAFT', rescue: rescue ? { reason: 'rescue' } : undefined }
  const trips = target ? mine.map((t) => (t.id === target.id ? focus : t)) : [...mine, focus]
  const day = vehicleDay(vehicle, trips, w)
  const entry = day.trips.find((x) => x.trip.id === focus.id)!
  const sch = entry.sched
  const g = budgetGroup(order.brand)
  const used = g === 'fresh' ? day.freshMin : day.styleTechMin
  const fuel = vehicle.fuelUsedL + day.fuelL
  const isDone = (id: string) => isDoneStatus(byId(w.orders, id)?.status)
  const late = day.trips.flatMap((x) => x.sched.stops.filter((s) => s.late && !isDone(s.orderId)))
  const lateOutlet = late[0] && byId(w.outlets, late[0].outletId)
  // Booklet rule (hard): every order on a trip shares its brand and district. Checked against the trip's own stops,
  // not assumed from how the order was matched, so a hand-built or joined trip that mixes them is rejected.
  const mixed = trips.flatMap((t) =>
    t.stops.flatMap((id) => {
      const o = byId(w.orders, id)
      const out = o && byId(w.outlets, o.outletId)
      return o && out && (o.brand !== t.brand || out.district !== t.district) ? [{ trip: t, order: o, outlet: out }] : []
    }),
  )
  const mix = mixed[0]
  const tripName = (t: Trip) => (t.id === '__new' ? 'This trip' : `Trip ${t.id}`)
  // Booklet rule (hard): mall_dock outlets accept deliveries only inside mall_window. Checked on the raw mall window,
  // independent of the narrowed outlet window, so it still holds if an outlet's window was never narrowed.
  const mallMiss = day.trips.flatMap((x) =>
    x.sched.stops.flatMap((s) => {
      const out = byId(w.outlets, s.outletId)
      const mw = out?.mallWindow
      return out && mw && !isDone(s.orderId) && (s.start < mw[0] || s.eta > mw[1]) ? [{ stop: s, outlet: out, mw }] : []
    }),
  )
  const mall = mallMiss[0]
  const unknown = day.trips.flatMap((x) => x.sched.unknownOrders)
  const others = mine.filter((t) => t.stops.length && t.id !== target?.id)

  const checks: Check[] = [
    { key: 'status', label: 'Vehicle available', ok: vehicle.status === 'AVAILABLE', blocking: true, detail: vehicle.status === 'AVAILABLE' ? 'Ready for dispatch' : vehicle.status === 'IN_WORKSHOP' ? `${vehicle.id} is in the workshop` : `${vehicle.id} has broken down` },
    { key: 'reserve', label: 'Recovery reserve', ok: !vehicle.reserve || rescue, blocking: false, detail: vehicle.reserve ? (rescue ? 'Reserve vehicle used for recovery' : 'Held for breakdown recovery — using it leaves no spare reefer') : 'Not a reserve vehicle' },
    { key: 'depot', label: 'Home depot', ok: outlet.depot === vehicle.depot, blocking: true, detail: outlet.depot === vehicle.depot ? `${vehicle.depot} outlet` : `${outlet.id} is served from ${outlet.depot}` },
    {
      key: 'temperature',
      label: 'Temperature',
      ok: order.temp === 'AMBIENT' || vehicle.temp === 'reefer',
      blocking: true,
      detail: order.temp === 'CHILLED' ? (vehicle.temp === 'reefer' ? 'Chilled goods on a reefer' : 'Chilled goods need a reefer') : vehicle.temp === 'reefer' ? 'Ambient goods on a reefer (allowed)' : 'Ambient goods',
    },
    { key: 'access', label: 'Outlet access', ok: !outlet.vanOnly || vehicle.kind === 'van', blocking: true, detail: outlet.vanOnly ? (vehicle.kind === 'van' ? 'Van-only outlet · van selected' : `${outlet.id} is van only — trucks cannot reach it`) : outlet.mall ? `Mall bay · ${fmtMin(outlet.window[0])}–${fmtMin(outlet.window[1])}` : 'Any vehicle' },
    {
      key: 'mall',
      label: 'Mall access window',
      ok: !mall,
      blocking: true,
      detail: mall
        ? `${mall.outlet.id} would be served ${fmtMin(mall.stop.start)} (arrives ${fmtMin(mall.stop.eta)}) — mall bay only open ${fmtMin(mall.mw[0])}–${fmtMin(mall.mw[1])}`
        : outlet.mallWindow
          ? `Mall bay open ${fmtMin(outlet.mallWindow[0])}–${fmtMin(outlet.mallWindow[1])}`
          : 'Not a mall outlet',
    },
    { key: 'orders', label: 'Known orders', ok: !unknown.length, blocking: true, detail: unknown.length ? `Unknown order or outlet on the vehicle's trips: ${unknown.join(', ')}` : 'Every order on the vehicle is known' },
    {
      key: 'trip',
      label: 'One brand, one district per trip',
      ok: !mix,
      blocking: true,
      detail: mix ? `${tripName(mix.trip)} is ${mix.trip.brand} · ${mix.trip.district}, but ${mix.order.id} is ${mix.order.brand} · ${mix.outlet.district}` : target ? `Joins trip ${entry.number} · ${order.brand} · ${outlet.district}` : `New trip · ${order.brand} · ${outlet.district}`,
    },
    {
      key: 'trips',
      label: 'Two trips per vehicle',
      ok: day.trips.length <= TRIPS_PER_VEHICLE,
      blocking: true,
      detail: day.trips.length <= TRIPS_PER_VEHICLE ? `${day.trips.length} / ${TRIPS_PER_VEHICLE} trips today` : `Already runs ${others.map((t) => `${t.brand} · ${t.district}`).join(' and ')}`,
    },
    { key: 'weight', label: 'Weight', ok: sch.weightKg <= vehicle.capacityKg, blocking: true, detail: `${sch.weightKg.toLocaleString()} / ${vehicle.capacityKg.toLocaleString()} kg` },
    { key: 'volume', label: 'Volume', ok: sch.volumeM3 <= vehicle.capacityM3, blocking: true, detail: `${sch.volumeM3} / ${vehicle.capacityM3} m³` },
    {
      key: 'window',
      label: 'Delivery windows',
      ok: late.length === 0,
      blocking: true,
      detail: late.length ? `${lateOutlet?.id} arrives ${fmtMin(late[0].eta)} — window closes ${fmtMin(late[0].window[1])}` : 'Every stop inside its window',
    },
    { key: 'budget', label: g === 'fresh' ? 'Fresh time budget' : 'Style + Tech time budget', ok: used <= BUDGET[g], blocking: true, detail: `${Math.round(used)} / ${BUDGET[g]} min · ${BUDGET_LABEL[g]}` },
    { key: 'fuel', label: 'Weekly fuel quota', ok: fuel <= vehicle.fuelQuotaL, blocking: true, detail: `${Math.round(fuel)} / ${vehicle.fuelQuotaL} L this week` },
  ]
  return {
    ok: checks.every((c) => c.ok || !c.blocking),
    checks,
    trip: { id: target?.id, number: entry.number, stops: focus.stops, departure: sch.departure, brand: order.brand, district: outlet.district, isNew: !target },
    schedule: sch,
    day,
    fuelProjected: fuel,
  }
}

export function suggestVehicles(order: Order, w: World, exclude?: string, limit = 3) {
  const outlet = byId(w.outlets, order.outletId)!
  return w.vehicles
    .filter((v) => v.id !== exclude && v.depot === outlet.depot)
    .map((v) => ({ v, r: validate(order, v, w) }))
    .filter((x) => x.r.ok)
    .sort((a, b) => fitScore(order, outlet, a.v, a.r) - fitScore(order, outlet, b.v, b.r))
    .slice(0, limit)
    .map((x) => x.v)
}

/**
 * Lower is better. Join an existing trip before opening a new one, reuse a vehicle before starting another,
 * and keep reefers for chilled goods and vans for van-only outlets.
 */
function fitScore(order: Order, outlet: Outlet, v: Vehicle, r: Validation) {
  let s = r.trip.isNew ? (r.day.trips.length > 1 ? 10 : 20) : 0
  if (order.temp === 'AMBIENT' && v.temp === 'reefer') s += 30
  if (!outlet.vanOnly && v.kind === 'van') s += 25
  if (v.reserve) s += 100
  s += (1 - r.schedule.volumeM3 / v.capacityM3) * 5
  return s
}

// ---------------------------------------------------------------------------
// Priority and deferral explanations
// ---------------------------------------------------------------------------

/** Allocation priority. The parts are shown to the dispatcher so every decision can be explained. */
export function priorityOf(order: Pick<Order, 'brand' | 'temp' | 'runsDeferred'>, outlet: Outlet): { score: number; why: string[] } {
  const why: string[] = []
  let s = 0
  if (order.brand === 'Fresh' && order.temp === 'CHILLED') (s += 60), why.push('Chilled Fresh: perishable, must be on shelf before 08:00')
  else if (order.brand === 'Fresh') (s += 50), why.push('Fresh dry goods: daily replenishment')
  else if (order.brand === 'Tech') (s += 40), why.push('Tech: high-value, customer-promised items')
  else (s += 30), why.push('Style: weekly replenishment')
  if (outlet.deferredYesterday) (s += 35), why.push('Skipped on the previous run')
  if (order.runsDeferred) (s += 20 * order.runsDeferred), why.push(`Deferred ${order.runsDeferred} run${order.runsDeferred > 1 ? 's' : ''} already`)
  const gap = Math.max(0, Math.min(4, outlet.lastServedDaysAgo - 1))
  if (gap) (s += gap * 4), why.push(`${outlet.lastServedDaysAgo} days since last delivery`)
  return { score: Math.min(99, s), why }
}

export const DEFERRAL_LABEL: Record<DeferralCode, string> = {
  reefer_capacity: 'No reefer space',
  van_capacity: 'No van space',
  vehicle_capacity: 'No vehicle space',
  weight_cap: 'Over weight limit',
  volume_cap: 'Over volume limit',
  time_budget: 'Time budget used',
  delivery_window: 'Misses window',
  fuel_quota: 'Fuel quota',
  vehicle_unavailable: 'Vehicle unavailable',
  dispatcher_choice: 'Dispatcher choice',
  inventory: 'Stock unavailable',
  breakdown: 'Vehicle breakdown',
}

export function customerMessageFor(code: DeferralCode): string {
  switch (code) {
    case 'reefer_capacity':
      return 'Refrigerated delivery space was fully used on this run. Your order has high priority on the next run.'
    case 'van_capacity':
      return 'Your outlet can only be reached by van, and every van was fully booked on this run. You have high priority on the next run.'
    case 'delivery_window':
      return 'No vehicle could reach your outlet inside its delivery window on this run.'
    case 'time_budget':
      return 'Every suitable vehicle had used its delivery time for this run.'
    case 'fuel_quota':
      return 'Weekly fuel limits prevented a safe allocation on this run.'
    case 'vehicle_unavailable':
      return 'The vehicle type your outlet needs was unavailable on this run.'
    case 'inventory':
      return 'Some items were unavailable at the depot, so your delivery moved to the next run.'
    case 'breakdown':
      return 'The delivery vehicle broke down and no replacement could reach you inside your window. You have high priority on the next run.'
    default:
      return 'Delivery capacity for this run was fully used. Your order has been prioritised for the next run.'
  }
}

export interface DeferralInfo {
  code: DeferralCode
  reason: string
  detail: string
}

/** Why no vehicle can take this order: the most common blocking constraint across compatible vehicles. */
export function explainDeferral(order: Order, w: World, opts: { releaseReserve?: boolean } = {}): DeferralInfo {
  const outlet = byId(w.outlets, order.outletId)!
  const chilled = order.temp === 'CHILLED'
  const pool = w.vehicles.filter((v) => v.depot === outlet.depot && (!chilled || v.temp === 'reefer') && (!outlet.vanOnly || v.kind === 'van'))
  const kind = chilled && outlet.vanOnly ? 'refrigerated van' : chilled ? 'reefer' : outlet.vanOnly ? 'van' : 'vehicle'
  const capCode: DeferralCode = chilled ? 'reefer_capacity' : outlet.vanOnly ? 'van_capacity' : 'vehicle_capacity'
  const usable = pool.filter((v) => v.status === 'AVAILABLE' && (opts.releaseReserve || !v.reserve))
  if (!usable.length) {
    const down = pool.filter((v) => v.status !== 'AVAILABLE').map((v) => v.id)
    const reserve = pool.filter((v) => v.status === 'AVAILABLE' && v.reserve).map((v) => v.id)
    const parts = [down.length && `${down.join(', ')} in the workshop`, reserve.length && `${reserve.join(', ')} held for recovery`].filter(Boolean).join('; ')
    return { code: 'vehicle_unavailable', reason: `No ${kind} available`, detail: `${outlet.depot} has ${pool.length} ${kind}${pool.length === 1 ? '' : 's'}${parts ? ` (${parts})` : ''}.` }
  }
  const PRECEDENCE: CheckKey[] = ['trips', 'budget', 'window', 'mall', 'volume', 'weight', 'fuel']
  const tally: Partial<Record<CheckKey, number>> = {}
  let earliest = Infinity
  for (const v of usable) {
    const r = validate(order, v, w)
    const fail = PRECEDENCE.find((k) => r.checks.find((c) => c.key === k && !c.ok))
    if (fail) tally[fail] = (tally[fail] ?? 0) + 1
    const own = r.schedule.stops.find((s) => s.orderId === order.id)
    if ((fail === 'window' || fail === 'budget') && own?.late) earliest = Math.min(earliest, own.eta)
  }
  const [top] = (Object.entries(tally) as [CheckKey, number][]).sort((a, b) => b[1] - a[1])
  const n = usable.length
  const noun = `${n} ${kind}${n === 1 ? '' : 's'} at ${outlet.depot}`
  const fleetCode: DeferralCode = chilled ? 'reefer_capacity' : outlet.vanOnly ? 'van_capacity' : 'delivery_window'
  const tooLate = Number.isFinite(earliest)
    ? ` The earliest any could reach ${outlet.id} is ${fmtMin(earliest)}, after its ${fmtMin(outlet.window[1])} close.`
    : ' Fitting it in would push stops already booked past their windows.'
  const window = order.brand === 'Fresh' ? 'the 03:30–08:00 Fresh window' : 'the trading day'
  switch (top?.[0]) {
    case 'trips':
      return { code: capCode, reason: DEFERRAL_LABEL[capCode], detail: `All ${noun} already run two trips or have no matching trip left.` }
    case 'budget':
      return { code: chilled || outlet.vanOnly ? fleetCode : 'time_budget', reason: DEFERRAL_LABEL[chilled || outlet.vanOnly ? fleetCode : 'time_budget'], detail: `The ${noun} have used their ${order.brand === 'Fresh' ? '270 Fresh minutes (03:30–08:00)' : '480 Style + Tech minutes'}.${tooLate}` }
    case 'window':
    case 'mall':
      return { code: fleetCode, reason: DEFERRAL_LABEL[fleetCode], detail: `The ${noun} are fully booked in ${window}.${tooLate}` }
    case 'volume':
      return { code: chilled ? 'reefer_capacity' : 'volume_cap', reason: chilled ? DEFERRAL_LABEL.reefer_capacity : DEFERRAL_LABEL.volume_cap, detail: `No ${kind} has ${order.volumeM3} m³ free on a ${outlet.district} trip.` }
    case 'weight':
      return { code: 'weight_cap', reason: DEFERRAL_LABEL.weight_cap, detail: `No ${kind} has ${order.weightKg} kg free on a ${outlet.district} trip.` }
    case 'fuel':
      return { code: 'fuel_quota', reason: DEFERRAL_LABEL.fuel_quota, detail: `The remaining ${noun} are at their weekly fuel quota.` }
    default:
      return { code: capCode, reason: DEFERRAL_LABEL[capCode], detail: `No ${kind} could take this order on this run.` }
  }
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export function nextTripId(trips: Trip[], vehicleId: string, suffix = '') {
  const base = `TRP-${vehicleId.slice(3)}-`
  for (let n = 1; ; n++) if (!trips.some((t) => t.id === `${base}${suffix}${n}`)) return `${base}${suffix}${n}`
}

export interface PlanResult {
  trips: Trip[]
  assigned: Record<string, string>
  deferred: Record<string, DeferralInfo>
}

/** Allocation order: priority (fairness first), then earliest window close. */
export function planQueue(w: World, deliveryDate: string) {
  return w.orders
    .filter((o) => o.status === 'CONFIRMED' && !o.tripId && o.deliveryDate === deliveryDate)
    .sort((a, b) => b.priority - a.priority || (byId(w.outlets, a.outletId)?.window[1] ?? 0) - (byId(w.outlets, b.outletId)?.window[1] ?? 0) || a.id.localeCompare(b.id))
}

/**
 * Greedy, explainable allocation. Orders are taken by priority; each goes to the feasible vehicle with the
 * best fit (join a trip > reuse a vehicle > open a new one; reefers kept for chilled, vans for van-only).
 * Anything no vehicle can take is deferred with the constraint that stopped it.
 */
export function generatePlan(w: World, deliveryDate: string, opts: { releaseReserve?: boolean } = {}): PlanResult {
  const trips: Trip[] = w.trips.filter((t) => t.status !== 'DRAFT').map((t) => ({ ...t, stops: [...t.stops] }))
  const world: World = { ...w, trips }
  const assigned: Record<string, string> = {}
  const deferred: Record<string, DeferralInfo> = {}

  for (const order of planQueue(w, deliveryDate)) {
    const outlet = byId(w.outlets, order.outletId)!
    const candidates = w.vehicles.filter((v) => v.depot === outlet.depot && v.status === 'AVAILABLE' && (opts.releaseReserve || !v.reserve))
    let best: { v: Vehicle; r: Validation; s: number } | undefined
    for (const v of candidates) {
      const r = validate(order, v, world, { draftOnly: true })
      if (!r.ok) continue
      const s = fitScore(order, outlet, v, r)
      if (!best || s < best.s) best = { v, r, s }
    }
    if (!best) {
      deferred[order.id] = explainDeferral(order, world, opts)
      continue
    }
    let trip = best.r.trip.id ? trips.find((t) => t.id === best.r.trip.id) : undefined
    if (!trip) {
      trip = { id: nextTripId([...trips, ...w.trips], best.v.id), vehicleId: best.v.id, number: best.r.trip.number, brand: order.brand, district: outlet.district, departure: best.r.trip.departure, stops: [], status: 'DRAFT' }
      trips.push(trip)
    }
    trip.stops = best.r.trip.stops
    assigned[order.id] = trip.id
    retime(world, best.v.id)
  }
  return { trips: trips.filter((t) => t.stops.length), assigned, deferred }
}

/** What limited the plan: deferrals by cause, resource use, and what releasing the recovery reserve would change. */
export function analyzePlan(before: World, result: PlanResult, deliveryDate: string, now: number, depots: string[] = ['Peliyagoda', 'Kandy']): PlanAnalysis {
  const after: World = { ...before, trips: result.trips }
  const dayOrders = before.orders.filter((o) => o.deliveryDate === deliveryDate && (o.status === 'CONFIRMED' || result.assigned[o.id]))
  const byCode: PlanAnalysis['byCode'] = {}
  for (const d of Object.values(result.deferred)) byCode[d.code] = (byCode[d.code] ?? 0) + 1
  const binding = (Object.entries(byCode) as [DeferralCode, number][]).sort((a, b) => b[1] - a[1])[0]?.[0]
  const usable = (v: Vehicle) => v.status === 'AVAILABLE' && !v.reserve && depots.includes(v.depot)
  const days = new Map(before.vehicles.map((v) => [v.id, vehicleDay(v, after.trips, after)]))
  const reefers = before.vehicles.filter((v) => v.temp === 'reefer' && usable(v))
  const vans = before.vehicles.filter((v) => v.kind === 'van' && usable(v))
  const dry = before.vehicles.filter((v) => v.temp === 'ambient' && v.kind === 'truck' && usable(v))
  const outletOf = (o: Order) => byId(before.outlets, o.outletId)!
  const chilled = dayOrders.filter((o) => o.temp === 'CHILLED')
  const vanOnly = dayOrders.filter((o) => outletOf(o).vanOnly)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  // Counterfactual: release the reserve and re-plan.
  const released = generatePlan(before, deliveryDate, { releaseReserve: true })
  const reserve = before.vehicles.filter((v) => v.reserve && v.status === 'AVAILABLE').map((v) => v.id)

  return {
    at: now,
    served: Object.keys(result.assigned).length,
    deferred: Object.keys(result.deferred).length,
    byCode,
    binding,
    resources: [
      {
        key: 'reefer',
        label: 'Reefer Fresh minutes',
        used: Math.round(sum(reefers.map((v) => days.get(v.id)!.freshMin))),
        available: reefers.length * BUDGET.fresh,
        unit: 'min',
        note: `${reefers.length} reefers × 270 min · ${chilled.filter((o) => result.assigned[o.id]).length}/${chilled.length} chilled orders served`,
      },
      {
        key: 'van',
        label: 'Van trips',
        used: sum(vans.map((v) => days.get(v.id)!.trips.length)),
        available: vans.length * TRIPS_PER_VEHICLE,
        unit: 'trips',
        note: `${vans.length} vans · ${vanOnly.filter((o) => result.assigned[o.id]).length}/${vanOnly.length} van-only orders served`,
      },
      {
        key: 'dry',
        label: 'Dry-box volume',
        used: Math.round(sum(dry.flatMap((v) => days.get(v.id)!.trips.map((t) => t.sched.volumeM3)))),
        available: Math.round(sum(dry.map((v) => v.capacityM3 * TRIPS_PER_VEHICLE))),
        unit: 'm³',
        note: `${dry.length} dry-box trucks`,
      },
      {
        key: 'fuel',
        label: 'Vehicles near fuel quota',
        used: before.vehicles.filter((v) => usable(v) && v.fuelUsedL + days.get(v.id)!.fuelL > v.fuelQuotaL * 0.9).length,
        available: before.vehicles.filter(usable).length,
        unit: 'vehicles',
        note: 'Above 90% of weekly quota',
      },
    ],
    reserveImpact: reserve.length ? { vehicles: reserve, extraServed: Math.max(0, Object.keys(released.assigned).length - Object.keys(result.assigned).length) } : undefined,
    repeatSkips: Object.keys(result.deferred).filter((id) => outletOf(byId(before.orders, id)!).deferredYesterday),
  }
}

// ---------------------------------------------------------------------------
// Recovery and move-stop
// ---------------------------------------------------------------------------

export interface RecoveryOption {
  vehicleId: string
  orderIds: string[]
  departure: Minutes
  delayMin: number
  checks: string[]
}

/** Vehicles that could run a rescue trip now: available, same depot, not already on the road. */
function rescueCandidates(w: World, depot: string, exclude: string) {
  const busy = new Set(w.trips.filter((t) => ['LOADING', 'LOADED', 'IN_PROGRESS', 'PAUSED'].includes(t.status)).map((t) => t.vehicleId))
  return w.vehicles.filter((v) => v.id !== exclude && v.depot === depot && v.status === 'AVAILABLE' && !busy.has(v.id))
}

/**
 * Re-plan the unfinished stops of a trip onto other vehicles. `now` is the operation clock (minutes).
 * Breakdown: a rescue vehicle drives out and takes over the load. Reserve reefers are tried first.
 */
export function recoveryPlan(tripId: string, w: World, now: Minutes): { options: RecoveryOption[]; defer: string[] } {
  const trip = byId(w.trips, tripId)!
  const broken = byId(w.vehicles, trip.vehicleId)!
  const remaining = trip.stops.filter((id) => !isDoneStatus(byId(w.orders, id)?.status))
  const oldSch = scheduleTrip(trip, broken, w)
  const trips = w.trips.map((t) => ({ ...t, stops: [...t.stops] }))
  const world: World = { ...w, trips }
  // Leave after dispatch prep and allow for the roadside transfer (modelled as a later departure).
  const departure = Math.ceil(now + TRANSFER_MIN)
  const options: Record<string, RecoveryOption> = {}
  const defer: string[] = []
  const cands = rescueCandidates(w, broken.depot, broken.id).sort((a, b) => Number(!!b.reserve) - Number(!!a.reserve) || Number(b.temp === 'reefer') - Number(a.temp === 'reefer') || a.id.localeCompare(b.id))
  for (const id of remaining) {
    const order = byId(w.orders, id)!
    const withoutOld = { ...world, trips: trips.map((t) => (t.id === trip.id ? { ...t, stops: t.stops.filter((s) => s !== id) } : t)) }
    let placed = false
    for (const v of [...cands].sort((a, b) => Number(!!options[b.id]) - Number(!!options[a.id]))) {
      const join = trips.find((t) => t.vehicleId === v.id && t.rescue?.from === trip.id)
      const r = validate(order, v, withoutOld, join ? { joinTrip: join.id } : { rescueDeparture: departure })
      if (!r.ok) continue
      if (join) join.stops = r.trip.stops
      else trips.push({ id: nextTripId(trips, v.id, 'R'), vehicleId: v.id, number: r.trip.number, brand: trip.brand, district: trip.district, departure, stops: r.trip.stops, status: 'DRAFT', rescue: { from: trip.id, reason: 'Breakdown recovery' } })
      const newEta = r.schedule.stops.find((s) => s.orderId === id)!.start
      const oldEta = oldSch.stops.find((s) => s.orderId === id)?.start ?? newEta
      const opt = (options[v.id] ??= { vehicleId: v.id, orderIds: [], departure, delayMin: 0, checks: [v.temp === 'reefer' ? 'Reefer' : 'Ambient', v.reserve ? 'Recovery reserve' : 'Idle today', 'Same depot', 'Capacity and windows OK'] })
      opt.orderIds.push(id)
      opt.delayMin = Math.max(opt.delayMin, Math.max(0, Math.round(newEta - oldEta)))
      placed = true
      break
    }
    if (!placed) defer.push(id)
  }
  return { options: Object.values(options), defer }
}

export interface MoveOption {
  vehicle: Vehicle
  validation: Validation
  departure: Minutes
  eta: Minutes
  /** Minutes later (+) or earlier (−) than the current plan. */
  delta: number
  /** Minutes earlier (+) than leaving the stop where it is, using the driver's reported delay. */
  gain: number
  /** Extra driving for the rescue trip (depot → outlet and back). */
  km: number
  fuelL: number
}

export interface StayEstimate {
  /** Planned arrival plus any delay the driver reported. */
  eta: Minutes
  planned: Minutes
  windowClose: Minutes
  late: boolean
  delay?: NonNullable<Trip['reportedDelay']>
}

/** When the stop arrives if it stays where it is. Silence alone changes nothing: only a reported delay does. */
export function stayEstimate(orderId: string, w: World): StayEstimate | undefined {
  const order = byId(w.orders, orderId)
  const trip = order && byId(w.trips, order.tripId)
  const s = trip && scheduleOfTrip(w, trip).stops.find((x) => x.orderId === orderId)
  if (!trip || !s) return undefined
  const delay = trip.reportedDelay && (!trip.reportedDelay.orderId || trip.reportedDelay.orderId === orderId) ? trip.reportedDelay : undefined
  const eta = s.eta + (delay?.minutes ?? 0)
  return { eta, planned: s.eta, windowClose: s.window[1], late: eta > s.window[1], delay }
}

/**
 * Where can a stop go if the dispatcher takes it off a vehicle mid-route? The goods are re-picked at the
 * depot and leave on a vehicle that is not on the road, as a new trip.
 */
export function moveOptions(orderId: string, w: World, now: Minutes): MoveOption[] {
  const order = byId(w.orders, orderId)!
  const outlet = byId(w.outlets, order.outletId)!
  const trip = byId(w.trips, order.tripId)
  const current = trip ? scheduleOfTrip(w, trip).stops.find((s) => s.orderId === orderId) : undefined
  const departure = Math.ceil(now + REPICK_MIN)
  const stay = stayEstimate(orderId, w)
  const world: World = { ...w, trips: w.trips.map((t) => (t.id === trip?.id ? { ...t, stops: t.stops.filter((s) => s !== orderId) } : t)) }
  return rescueCandidates(w, outlet.depot, trip?.vehicleId ?? '')
    .map((v) => {
      const r = validate(order, v, world, { rescueDeparture: departure })
      const eta = r.schedule.stops.find((s) => s.orderId === orderId)?.eta ?? 0
      return { vehicle: v, validation: r, departure, eta, delta: current ? Math.round(eta - current.eta) : 0, gain: stay ? Math.round(stay.eta - eta) : 0, km: r.schedule.distanceKm, fuelL: r.schedule.fuelL }
    })
    // Same arrival: the vehicle that burns less fuel for a one-stop trip (usually the van) goes first.
    .sort((a, b) => Number(b.validation.ok) - Number(a.validation.ok) || Number(!!b.vehicle.reserve) - Number(!!a.vehicle.reserve) || a.eta - b.eta || a.fuelL - b.fuelL)
}
