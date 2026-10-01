/**
 * Tests for the planner itself (core/src/rules.ts): multi-start construction, the audit, locked stops, the recovery
 * reserve and deferral explanations. Uses the seeded demo day and small seeded random worlds; no database or API.
 *   npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commands, opNow, seedOps } from '@core/ops'
import { auditPlan, byId, comparePlans, generatePlan, greedyPlan, isTripLocked, planQueue, planStarts, priorityOf, scorePlan, selectPlan, validate, vehicleDay, type PlanConstruction, type PlanScore, type World } from '@core/rules'
import { colomboDate, colomboTs, fmtMin, hm } from '@core/time'
import type { DistrictInfo, OpsData, Order, Outlet, Vehicle } from '@core/types'

// --- Fixtures ---------------------------------------------------------------------------------

/** The demo day as the dispatcher sees it at 16:05: orders closed, priorities scored, nothing planned yet. */
function demoDay(): OpsData {
  const d = seedOps({ today: '2026-09-27' })
  commands.closeOrders(d)
  commands.setClock(d, colomboTs(colomboDate(opNow(d)), hm(16, 5)))
  for (const o of d.orders) if (o.status === 'CONFIRMED') o.priority = priorityOf(o, byId(d.outlets, o.outletId)!).score
  return d
}

const lcg = (seed: number) => {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
}

/** A smaller, harder day drawn from the demo network: fewer vehicles, resized orders, some workshop, reserve and locks. */
function randomWorld(seed: number): OpsData {
  const r = lcg(seed)
  const d = demoDay()
  const depot = r() < 0.5 ? 'Peliyagoda' : 'Kandy'
  const vehicles: Vehicle[] = d.vehicles
    .filter((v) => v.depot === depot && r() < 0.4)
    .map((v) => ({ ...v, status: r() < 0.1 ? 'IN_WORKSHOP' : 'AVAILABLE', reserve: r() < 0.15 ? true : undefined }))
  if (!vehicles.length) vehicles.push({ ...d.vehicles.find((v) => v.depot === depot && v.status === 'AVAILABLE')! })
  const orders: Order[] = d.orders
    .filter((o) => o.deliveryDate === d.deliveryDate && byId(d.outlets, o.outletId)!.depot === depot && r() < 0.6)
    .map((o) => ({ ...o, lock: undefined, volumeM3: Math.round(o.volumeM3 * (0.5 + 2 * r()) * 100) / 100, weightKg: Math.round(o.weightKg * (0.5 + 2 * r())) }))
  for (const o of orders) if (r() < 0.06) o.lock = { vehicleId: vehicles[Math.floor(r() * vehicles.length)].id, by: 'DISPATCHER', at: 0 }
  return { ...d, vehicles, orders, trips: [] }
}

const etaOf = (w: World, vehicle: Vehicle, orderId: string) => {
  for (const x of vehicleDay(vehicle, w.trips, w).trips) {
    const s = x.sched.stops.find((y) => y.orderId === orderId)
    if (s) return s.eta
  }
  return undefined
}

// Small hand-built worlds for the locked-stop rules (Colombo: 24 min out, 8 min between stops).
const COLOMBO: DistrictInfo = { district: 'Colombo', depot: 'Peliyagoda', road_class: 'urban', free_flow_kmh: 25, depot_to_district_km: 10, depot_to_district_freeflow_min: 24, inter_stop_km: 3, inter_stop_freeflow_min: 8, x: 0, y: 0 }
const ALLOW = [{ brand: 'Fresh', dock_type: 'street', service_allowance_min: 16 }] as World['allowances']
const out = (id: string, close: string): Outlet => {
  const [h, m] = close.split(':').map(Number)
  const win: [number, number] = [hm(5), hm(h, m)]
  return { id, name: id, brand: 'Fresh', district: 'Colombo', depot: 'Peliyagoda', dock: 'street', parking: 'normal', requestedWindow: win, window: win, vanOnly: false, mall: false, x: 0, y: 0, lastServedDaysAgo: 1, deferralsThisWeek: 0, deferredYesterday: false, manager: 'T' }
}
const ord = (o: Outlet, extra: Partial<Order> = {}): Order => ({ id: `ORD-${o.id}`, outletId: o.id, brand: 'Fresh', temp: 'CHILLED', items: [], units: 1, volumeM3: 1, weightKg: 100, deliveryDate: '2026-10-01', status: 'CONFIRMED', priority: 60, createdAt: 0, ...extra })
const reefer = (id: string, extra: Partial<Vehicle> = {}): Vehicle => ({ id, kind: 'truck', temp: 'reefer', type: 'REEFER_TRUCK', depot: 'Peliyagoda', capacityKg: 3500, capacityM3: 16, fuelType: 'diesel', kmPerL: 5, fuelQuotaL: 1000, fuelUsedL: 0, status: 'AVAILABLE', driver: 'T', ...extra })
const small = (outlets: Outlet[], orders: Order[], vehicles: Vehicle[]): World => ({ outlets, orders, vehicles, trips: [], districts: [COLOMBO], allowances: ALLOW })
const LOCK = (vehicleId: string) => ({ vehicleId, by: 'DISPATCHER' as const, at: 0 })

// --- Objective ---------------------------------------------------------------------------------

describe('objective: lexicographic', () => {
  const base: PlanScore = { violations: 0, deferredPriority: 100, served: 10, trips: 5, km: 100 }
  it('no violations beats everything else', () => {
    assert.ok(comparePlans(base, { ...base, violations: 1, deferredPriority: 0, served: 99 }) < 0)
  })
  it('then least deferred priority, then most served, then fewest trips, then least km', () => {
    assert.ok(comparePlans({ ...base, deferredPriority: 90, served: 1 }, base) < 0)
    assert.ok(comparePlans({ ...base, served: 11, trips: 9 }, base) < 0)
    assert.ok(comparePlans({ ...base, trips: 4, km: 999 }, base) < 0)
    assert.ok(comparePlans({ ...base, km: 99 }, base) < 0)
    assert.equal(comparePlans(base, { ...base }), 0)
  })
})

// --- Demo day ----------------------------------------------------------------------------------

describe('multi-start planner on the demo day', () => {
  it('is deterministic: the same day always gives the same plan', () => {
    const a = demoDay()
    const b = demoDay()
    assert.equal(JSON.stringify(generatePlan(a, a.deliveryDate)), JSON.stringify(generatePlan(b, b.deliveryDate)))
  })
  it('is never worse than the original greedy plan, and passes the audit', () => {
    const w = demoDay()
    const plan = generatePlan(w, w.deliveryDate)
    const audit = auditPlan(w, plan, w.deliveryDate)
    assert.ok(audit.ok, audit.problems.join('\n'))
    assert.ok(comparePlans(scorePlan(w, plan), scorePlan(w, greedyPlan(w, w.deliveryDate))) <= 0)
  })
  it('every start passes the audit', () => {
    const w = demoDay()
    for (const r of planStarts(w, w.deliveryDate)) assert.ok(r.audit.ok, `${r.start}: ${r.audit.problems.join('; ')}`)
  })
  it('never plans the recovery reserve unless it is released', () => {
    const w = demoDay()
    const reserve = new Set(w.vehicles.filter((v) => v.reserve).map((v) => v.id))
    const plan = generatePlan(w, w.deliveryDate)
    for (const tid of Object.values(plan.assigned)) assert.ok(!reserve.has(byId(plan.trips, tid)!.vehicleId), `${tid} uses the reserve`)
    const released = generatePlan(w, w.deliveryDate, { releaseReserve: true })
    assert.ok(auditPlan(w, released, w.deliveryDate, { releaseReserve: true }).ok)
    assert.ok(Object.keys(released.assigned).length >= Object.keys(plan.assigned).length)
  })
  it('keeps the hero trip exactly the 5 designed stops at their story times (04:36 departure, OUT032 at 06:09)', () => {
    const d = demoDay()
    commands.generatePlan(d)
    const v = byId(d.vehicles, 'VEH014')!
    const story = d.orders.filter((o) => o.lock?.vehicleId === 'VEH014')
    assert.equal(story.length, 5)
    for (const o of story) assert.equal(byId(d.trips, o.tripId)?.vehicleId, 'VEH014')
    const trip = byId(d.trips, 'TRP-014-1')!
    assert.ok(isTripLocked(trip, d))
    assert.deepEqual(trip.stops.map((id) => byId(d.orders, id)!.outletId), ['OUT047', 'OUT004', 'OUT018', 'OUT032', 'OUT056'])
    assert.equal(fmtMin(trip.departure), '04:36')
    const out032 = story.find((o) => o.outletId === 'OUT032')!
    assert.equal(fmtMin(etaOf(d, v, out032.id)!), '06:09')
  })
  it('explains chilled deferrals as reefer time, keeping the reason code', () => {
    const w = demoDay()
    const plan = generatePlan(w, w.deliveryDate)
    const chilled = Object.entries(plan.deferred).filter(([id]) => byId(w.orders, id)!.temp === 'CHILLED')
    assert.ok(chilled.length > 0, 'the demo day defers some chilled orders')
    for (const [, info] of chilled) assert.equal(info.code, 'reefer_capacity')
    const time = chilled.filter(([, info]) => info.reason === 'No reefer time' || info.reason === 'No refrigerated van time')
    assert.ok(time.length > 0)
    for (const [, info] of time) assert.match(info.detail, /^No (reefer|refrigerated van) can reach OUT\d{3} before \d\d:\d\d/)
  })
  it('a stop the dispatcher locks stays on its vehicle when the day is re-planned', () => {
    const d = demoDay()
    commands.generatePlan(d)
    const o = d.orders.find((x) => x.tripId && !x.lock && byId(d.trips, x.tripId)?.status === 'DRAFT')!
    const vid = byId(d.trips, o.tripId)!.vehicleId
    assert.equal(commands.lockStop(d, o.id).ok, true)
    commands.generatePlan(d)
    assert.equal(byId(d.trips, o.tripId)?.vehicleId, vid)
    assert.equal(commands.unlockStop(d, o.id).ok, true)
    assert.equal(o.lock, undefined)
  })
})

// --- Audit -------------------------------------------------------------------------------------

describe('auditPlan catches broken plans', () => {
  const planned = () => {
    const w = demoDay()
    return { w, plan: generatePlan(w, w.deliveryDate) }
  }
  it('an order on two trips', () => {
    const { w, plan } = planned()
    const [a, b] = plan.trips
    b.stops.push(a.stops[0])
    assert.match(auditPlan(w, plan, w.deliveryDate).problems.join('\n'), /on two trips/)
  })
  it('an order neither assigned nor deferred', () => {
    const { w, plan } = planned()
    const id = Object.keys(plan.assigned)[0]
    delete plan.assigned[id]
    for (const t of plan.trips) t.stops = t.stops.filter((s) => s !== id)
    assert.match(auditPlan(w, plan, w.deliveryDate).problems.join('\n'), /neither assigned nor deferred/)
  })
  it('a chilled order slipped onto a dry truck', () => {
    const { w, plan } = planned()
    const dry = plan.trips.find((t) => byId(w.vehicles, t.vehicleId)!.temp === 'ambient')!
    const chilled = Object.keys(plan.assigned).find((id) => byId(w.orders, id)!.temp === 'CHILLED')!
    for (const t of plan.trips) t.stops = t.stops.filter((s) => s !== chilled)
    dry.stops.push(chilled)
    plan.assigned[chilled] = dry.id
    assert.equal(auditPlan(w, plan, w.deliveryDate).ok, false)
  })
})

// --- Random worlds -------------------------------------------------------------------------------

describe('random smaller worlds (seeded)', () => {
  for (let seed = 1; seed <= 24; seed++) {
    it(`seed ${seed}: passes the audit and is never worse than greedy`, () => {
      const w = randomWorld(seed)
      const plan = generatePlan(w, w.deliveryDate)
      const audit = auditPlan(w, plan, w.deliveryDate)
      assert.ok(audit.ok, audit.problems.join('\n'))
      assert.ok(comparePlans(scorePlan(w, plan), scorePlan(w, greedyPlan(w, w.deliveryDate))) <= 0)
    })
  }
})

// --- Locked stops --------------------------------------------------------------------------------

describe('locked stops', () => {
  it('the planner fills a locked vehicle around its locked stop without moving it', () => {
    const L = out('OUT901', '07:30')
    const X = out('OUT902', '08:00')
    const lo = ord(L, { lock: LOCK('VEH901') })
    const xo = ord(X)
    const w = small([L, X], [lo, xo], [reefer('VEH901'), reefer('VEH902')])
    const alone = generatePlan(small([L], [lo], [reefer('VEH901')]), '2026-10-01')
    const plan = generatePlan(w, '2026-10-01')
    assert.ok(auditPlan(w, plan, '2026-10-01').ok)
    assert.equal(byId(plan.trips, plan.assigned[lo.id])!.vehicleId, 'VEH901')
    assert.equal(byId(plan.trips, plan.assigned[xo.id])!.vehicleId, 'VEH901', 'uses the locked vehicle’s spare room')
    const v = reefer('VEH901')
    assert.equal(etaOf({ ...w, trips: plan.trips }, v, lo.id), etaOf({ ...w, trips: alone.trips }, v, lo.id))
  })
  it('an order that would delay a locked stop goes to another vehicle', () => {
    const L = out('OUT911', '07:30')
    const Y = out('OUT912', '07:00') // closes earlier, so it would be served before L and push L later
    const lo = ord(L, { lock: LOCK('VEH911') })
    const yo = ord(Y)
    const w = small([L, Y], [lo, yo], [reefer('VEH911'), reefer('VEH912')])
    const plan = generatePlan(w, '2026-10-01')
    assert.ok(auditPlan(w, plan, '2026-10-01').ok)
    assert.equal(byId(plan.trips, plan.assigned[yo.id])!.vehicleId, 'VEH912')
  })
  it('a locked stop is never moved to another vehicle; if its own can’t take it, it is deferred and says why', () => {
    const L = out('OUT921', '07:30')
    const lo = ord(L, { lock: LOCK('VEH921') })
    const w = small([L], [lo], [reefer('VEH921', { status: 'IN_WORKSHOP' }), reefer('VEH922')])
    const plan = generatePlan(w, '2026-10-01')
    assert.equal(plan.assigned[lo.id], undefined)
    assert.match(plan.deferred[lo.id].reason, /^Locked to VEH921/)
  })
  it('validate refuses moving a locked stop by hand until it is unlocked', () => {
    const L = out('OUT931', '07:30')
    const lo = ord(L, { lock: LOCK('VEH931') })
    const w = small([L], [lo], [reefer('VEH931'), reefer('VEH932')])
    const r = validate(lo, reefer('VEH932'), w)
    assert.equal(r.ok, false)
    assert.equal(r.checks.find((c) => c.key === 'locked')!.ok, false)
    assert.equal(validate({ ...lo, lock: undefined }, reefer('VEH932'), w).ok, true)
  })
})

// --- Locked trips --------------------------------------------------------------------------------

describe('locked trips', () => {
  const setup = () => {
    const A = out('OUT941', '07:30')
    const B = out('OUT942', '07:30')
    const X = out('OUT943', '08:00') // would happily join the trip if it were open
    const ao = ord(A, { lock: { ...LOCK('VEH941'), wholeTrip: true } })
    const bo = ord(B, { lock: { ...LOCK('VEH941'), wholeTrip: true } })
    const xo = ord(X)
    return { w: small([A, B, X], [ao, bo, xo], [reefer('VEH941'), reefer('VEH942')]), ao, bo, xo }
  }
  it('the planner keeps a locked trip exactly as locked and adds nothing to it', () => {
    const { w, ao, bo, xo } = setup()
    const plan = generatePlan(w, '2026-10-01')
    assert.ok(auditPlan(w, plan, '2026-10-01').ok)
    const locked = byId(plan.trips, plan.assigned[ao.id])!
    assert.equal(locked.vehicleId, 'VEH941')
    assert.deepEqual([...locked.stops].sort(), [ao.id, bo.id].sort())
    assert.notEqual(plan.assigned[xo.id], locked.id)
  })
  it('validate and the audit refuse adding a stop to a locked trip', () => {
    const { w, ao, bo, xo } = setup()
    const v = reefer('VEH941')
    const trip = { id: 'T-LOCK', vehicleId: v.id, number: 1 as const, brand: 'Fresh' as const, district: 'Colombo', departure: hm(4, 36), stops: [ao.id, bo.id], status: 'DRAFT' as const }
    const r = validate(xo, v, { ...w, trips: [trip] }, { joinTrip: trip.id })
    assert.equal(r.checks.find((c) => c.key === 'locked')!.ok, false)
    const bad = { trips: [{ ...trip, stops: [ao.id, bo.id, xo.id] }], assigned: { [ao.id]: 'T-LOCK', [bo.id]: 'T-LOCK', [xo.id]: 'T-LOCK' }, deferred: {} }
    assert.match(auditPlan(w, bad, '2026-10-01').problems.join(' | '), /is locked/)
  })
  it('lockTrip and unlockTrip are dispatcher commands, and unassigning a stop clears its lock', () => {
    const d = demoDay()
    commands.generatePlan(d)
    const t = d.trips.find((x) => x.status === 'DRAFT' && x.stops.length > 1 && !isTripLocked(x, d))!
    assert.equal(commands.lockTrip(d, t.id).ok, true)
    assert.ok(isTripLocked(t, d))
    const stops = [...t.stops]
    commands.generatePlan(d)
    const again = d.trips.find((x) => x.stops.includes(stops[0]))!
    assert.deepEqual([...again.stops].sort(), [...stops].sort(), 're-planning keeps exactly the locked stops')
    commands.unassign(d, stops[0])
    assert.equal(byId(d.orders, stops[0])!.lock, undefined)
    assert.equal(commands.unlockTrip(d, again.id).ok, true)
    assert.ok(stops.slice(1).every((id) => !byId(d.orders, id)!.lock))
  })
})

// --- Fallback --------------------------------------------------------------------------------------

describe('greedy fallback', () => {
  /** A candidate that serves more than any honest plan by putting a chilled order on a dry truck. */
  const cheat = (w: World, date: string): PlanConstruction => {
    const g = greedyPlan(w, date)
    const trips = g.trips.map((t) => ({ ...t, stops: [...t.stops] }))
    const dry = trips.find((t) => byId(w.vehicles, t.vehicleId)!.temp === 'ambient')!
    const victims = Object.keys(g.deferred).filter((id) => byId(w.orders, id)!.temp === 'CHILLED')
    for (const id of victims) dry.stops.push(id)
    return { trips, assigned: { ...g.assigned, ...Object.fromEntries(victims.map((id) => [id, dry.id])) }, deferred: Object.keys(g.deferred).filter((id) => !victims.includes(id)) }
  }
  it('a candidate that fails the audit is never kept, even when it scores best without the audit', () => {
    const w = demoDay()
    const bad = cheat(w, w.deliveryDate)
    const draft = { trips: bad.trips, assigned: bad.assigned, deferred: Object.fromEntries(bad.deferred.map((id) => [id, {} as never])) }
    assert.equal(auditPlan(w, draft, w.deliveryDate).ok, false)
    const honest = { trips: greedyPlan(w, w.deliveryDate).trips, assigned: greedyPlan(w, w.deliveryDate).assigned, deferred: greedyPlan(w, w.deliveryDate).deferred }
    assert.ok(comparePlans({ ...scorePlan(w, draft), violations: 0 }, scorePlan(w, honest)) < 0, 'the cheat would win if the audit were skipped')
    const plan = selectPlan(w, w.deliveryDate, [{ start: 'injected', construction: bad }])
    assert.equal(JSON.stringify(plan), JSON.stringify(greedyPlan(w, w.deliveryDate)), 'falls back to the original greedy plan')
    assert.ok(auditPlan(w, plan, w.deliveryDate).ok)
  })
  it('with honest candidates alongside, the failing one still loses', () => {
    const w = demoDay()
    const plan = selectPlan(w, w.deliveryDate, [
      { start: 'injected', construction: cheat(w, w.deliveryDate) },
      ...planStarts(w, w.deliveryDate).map((r) => ({ start: r.start, construction: r.construction })),
    ])
    assert.equal(JSON.stringify(plan), JSON.stringify(generatePlan(w, w.deliveryDate)))
  })
  it('with no candidates at all, the original greedy plan is built', () => {
    const w = demoDay()
    assert.equal(JSON.stringify(selectPlan(w, w.deliveryDate, [])), JSON.stringify(greedyPlan(w, w.deliveryDate)))
    assert.ok(planQueue(w, w.deliveryDate).length > 0)
  })
})
