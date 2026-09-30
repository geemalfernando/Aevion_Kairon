/**
 * Unit tests for the booklet's hard constraints and the trip-time formula (core/src/rules.ts).
 * Uses a small synthetic world built from the booklet's worked examples, so it needs no database,
 * no CSVs and no running API.
 *   npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { effectiveWindow } from '@core/adapter'
import { commands, seedOps } from '@core/ops'
import { BUDGET, byId, generatePlan, scheduleTrip, TRIPS_PER_VEHICLE, validate, vehicleDay, type Check, type CheckKey, type World } from '@core/rules'
import type { Brand, DistrictInfo, Order, Outlet, Trip, Vehicle } from '@core/types'
import { hm } from '@core/time'

// --- Fixtures ---------------------------------------------------------------------------------

// Booklet examples: Colombo 24 min + 8 min between stops, Gampaha 37 + 9; Fresh rear_dock 15, Fresh street 16.
const district = (name: string, depot: 'Peliyagoda' | 'Kandy', outbound: number, inter: number): DistrictInfo => ({
  district: name, depot, road_class: 'urban', free_flow_kmh: 30, depot_to_district_km: 10, depot_to_district_freeflow_min: outbound, inter_stop_km: 3, inter_stop_freeflow_min: inter, x: 0, y: 0,
})
const DISTRICTS = [district('Colombo', 'Peliyagoda', 24, 8), district('Gampaha', 'Peliyagoda', 37, 9), district('Galle', 'Peliyagoda', 95, 12), district('Kandy', 'Kandy', 15, 9)]
const ALLOWANCES = [
  { brand: 'Fresh', dock_type: 'rear_dock', service_allowance_min: 15 },
  { brand: 'Fresh', dock_type: 'street', service_allowance_min: 16 },
  { brand: 'Fresh', dock_type: 'mall_bay', service_allowance_min: 18 },
  { brand: 'Style', dock_type: 'rear_dock', service_allowance_min: 18 },
  { brand: 'Style', dock_type: 'street', service_allowance_min: 22 },
  { brand: 'Style', dock_type: 'mall_bay', service_allowance_min: 25 },
  { brand: 'Tech', dock_type: 'rear_dock', service_allowance_min: 20 },
  { brand: 'Tech', dock_type: 'street', service_allowance_min: 24 },
  { brand: 'Tech', dock_type: 'mall_bay', service_allowance_min: 26 },
] as World['allowances']

const WIDE: [number, number] = [hm(3, 30), hm(23)]
let seq = 0
const outlet = (o: Partial<Outlet> = {}): Outlet => {
  const id = o.id ?? `OUT${String(++seq).padStart(3, '0')}`
  return {
    id, name: id, brand: 'Fresh', district: 'Colombo', depot: 'Peliyagoda', dock: 'street', parking: 'normal', requestedWindow: WIDE, window: WIDE, vanOnly: false, mall: false,
    x: 0, y: 0, lastServedDaysAgo: 1, deferralsThisWeek: 0, deferredYesterday: false, manager: 'Test', ...o,
  }
}
const order = (out: Outlet, o: Partial<Order> = {}): Order => ({
  id: `ORD${String(++seq).padStart(4, '0')}`, outletId: out.id, brand: out.brand, temp: 'AMBIENT', items: [], units: 1, volumeM3: 1, weightKg: 100, deliveryDate: '2026-10-01', status: 'CONFIRMED', priority: 50, createdAt: 0, ...o,
})
const vehicle = (v: Partial<Vehicle> = {}): Vehicle => ({
  id: 'VEH900', kind: 'truck', temp: 'ambient', type: 'TRUCK', depot: 'Peliyagoda', capacityKg: 5000, capacityM3: 30, fuelType: 'diesel', kmPerL: 5, fuelQuotaL: 1000, fuelUsedL: 0, status: 'AVAILABLE', driver: 'Test', ...v,
})
const REEFER: Partial<Vehicle> = { temp: 'reefer', type: 'REEFER_TRUCK' }
const VAN: Partial<Vehicle> = { kind: 'van', type: 'VAN', capacityKg: 1200, capacityM3: 8 }
const trip = (v: Vehicle, brand: Brand, dist: string, stops: Order[], t: Partial<Trip> = {}): Trip => ({
  id: `T-${++seq}`, vehicleId: v.id, number: 1, brand, district: dist, departure: hm(3, 30), stops: stops.map((s) => s.id), status: 'DRAFT', ...t,
})
const world = (outlets: Outlet[], orders: Order[], vehicles: Vehicle[], trips: Trip[] = []): World => ({ outlets, orders, vehicles, trips, districts: DISTRICTS, allowances: ALLOWANCES })

const check = (r: { checks: Check[] }, key: CheckKey) => r.checks.find((c) => c.key === key)!
/** The rule fails, and no other rule is to blame for the rejection. */
const rejectedOnlyBy = (r: { ok: boolean; checks: Check[] }, key: CheckKey) => {
  assert.equal(check(r, key).ok, false, `${key} should fail`)
  assert.equal(r.ok, false)
  assert.deepEqual(r.checks.filter((c) => !c.ok && c.blocking).map((c) => c.key), [key])
}
const passes = (r: { ok: boolean; checks: Check[] }) => assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)))

// --- Trip-time formula (booklet Task 2B) --------------------------------------------------------

describe('trip time: booklet formula, no return leg', () => {
  it('Gampaha Fresh, 3 stops (rear_dock, rear_dock, street) = 37 + 18 + 15 + 15 + 16 = 101', () => {
    const v = vehicle()
    const outs = [outlet({ district: 'Gampaha', dock: 'rear_dock' }), outlet({ district: 'Gampaha', dock: 'rear_dock' }), outlet({ district: 'Gampaha', dock: 'street' })]
    const ords = outs.map((o) => order(o))
    const w = world(outs, ords, [v])
    const s = scheduleTrip(trip(v, 'Fresh', 'Gampaha', ords), v, w)
    assert.equal(s.outbound, 37)
    assert.equal(s.interStop, 18)
    assert.equal(s.handling, 46)
    assert.equal(s.minutes, 101)
  })

  it('Colombo Fresh, 4 street stops = 24 + 24 + 64 = 112', () => {
    const v = vehicle()
    const outs = [1, 2, 3, 4].map(() => outlet({ district: 'Colombo', dock: 'street' }))
    const ords = outs.map((o) => order(o))
    const w = world(outs, ords, [v])
    const s = scheduleTrip(trip(v, 'Fresh', 'Colombo', ords), v, w)
    assert.equal(s.minutes, 112)
  })

  it('a single stop pays no inter-stop time', () => {
    const v = vehicle()
    const o = outlet({ district: 'Colombo' })
    const ord = order(o)
    assert.equal(scheduleTrip(trip(v, 'Fresh', 'Colombo', [ord]), v, world([o], [ord], [v])).minutes, 24 + 16)
  })

  it('the same vehicle runs both trips: 101 + 112 = 213 ≤ 270, valid', () => {
    const v = vehicle()
    const gOuts = [outlet({ district: 'Gampaha', dock: 'rear_dock' }), outlet({ district: 'Gampaha', dock: 'rear_dock' }), outlet({ district: 'Gampaha', dock: 'street' })]
    const cOuts = [1, 2, 3, 4].map(() => outlet({ district: 'Colombo', dock: 'street' }))
    const gOrds = gOuts.map((o) => order(o))
    const cOrds = cOuts.slice(0, 3).map((o) => order(o))
    const last = order(cOuts[3])
    const t1 = trip(v, 'Fresh', 'Gampaha', gOrds)
    const t2 = trip(v, 'Fresh', 'Colombo', cOrds)
    const w = world([...gOuts, ...cOuts], [...gOrds, ...cOrds, last], [v], [t1, t2])
    // Adding the fourth Colombo stop completes the 112-minute trip.
    const r = validate(last, v, w)
    passes(r)
    assert.equal(r.day.trips.length, 2)
    assert.equal(r.day.freshMin, 213)
    assert.ok(r.day.freshMin <= BUDGET.fresh)
    assert.match(check(r, 'budget').detail, /213 \/ 270/)
  })

  it('a third trip is rejected', () => {
    const v = vehicle()
    const gOut = outlet({ district: 'Gampaha' })
    const cOut = outlet({ district: 'Colombo' })
    const third = outlet({ district: 'Galle' })
    const gOrd = order(gOut)
    const cOrd = order(cOut)
    const tOrd = order(third)
    const w = world([gOut, cOut, third], [gOrd, cOrd, tOrd], [v], [trip(v, 'Fresh', 'Gampaha', [gOrd]), trip(v, 'Fresh', 'Colombo', [cOrd])])
    rejectedOnlyBy(validate(tOrd, v, w), 'trips')
  })
})

// --- One test pair per hard constraint --------------------------------------------------------

describe('hard constraint 1: one brand and one district per trip', () => {
  it('pass: same brand and district joins the existing trip', () => {
    const v = vehicle()
    const a = outlet({ district: 'Colombo' })
    const b = outlet({ district: 'Colombo' })
    const oa = order(a)
    const ob = order(b)
    const r = validate(ob, v, world([a, b], [oa, ob], [v], [trip(v, 'Fresh', 'Colombo', [oa])]))
    passes(r)
    assert.equal(r.trip.isNew, false)
    assert.deepEqual([...r.trip.stops].sort(), [oa.id, ob.id].sort())
  })

  it('fail: a different district or brand never joins the trip; it opens its own', () => {
    const v = vehicle()
    const a = outlet({ district: 'Colombo' })
    const otherDistrict = outlet({ district: 'Gampaha' })
    const otherBrand = outlet({ district: 'Colombo', brand: 'Style' })
    const oa = order(a)
    const od = order(otherDistrict)
    const ob = order(otherBrand)
    const base = trip(v, 'Fresh', 'Colombo', [oa])
    const w = world([a, otherDistrict, otherBrand], [oa, od, ob], [v], [base])
    for (const o of [od, ob]) {
      const r = validate(o, v, w)
      assert.equal(r.trip.isNew, true)
      assert.deepEqual(r.trip.stops, [o.id])
      assert.equal(r.day.trips.length, 2)
    }
  })

  it('fail: a hand-built mixed-brand trip is rejected, with a message naming the order', () => {
    const v = vehicle()
    const a = outlet({ district: 'Colombo' })
    const b = outlet({ district: 'Colombo', brand: 'Style' })
    const oa = order(a)
    const ob = order(b)
    const mixed = trip(v, 'Fresh', 'Colombo', [oa, ob]) // a Style order on a Fresh trip
    const r = validate(oa, v, world([a, b], [oa, ob], [v], [mixed]))
    rejectedOnlyBy(r, 'trip')
    assert.match(check(r, 'trip').detail, new RegExp(`${mixed.id} is Fresh · Colombo, but ${ob.id} is Style · Colombo`))
  })

  it('fail: a hand-built mixed-district trip is rejected, with a message naming the order', () => {
    const v = vehicle()
    const a = outlet({ district: 'Colombo' })
    const b = outlet({ district: 'Gampaha' })
    const oa = order(a)
    const ob = order(b)
    const mixed = trip(v, 'Fresh', 'Colombo', [oa, ob]) // a Gampaha stop on a Colombo trip
    const r = validate(oa, v, world([a, b], [oa, ob], [v], [mixed]))
    rejectedOnlyBy(r, 'trip')
    assert.match(check(r, 'trip').detail, new RegExp(`${mixed.id} is Fresh · Colombo, but ${ob.id} is Fresh · Gampaha`))
  })

  it('fail: forcing an order onto a specific trip of another brand or district (joinTrip) is rejected', () => {
    const v = vehicle()
    const a = outlet({ district: 'Colombo' })
    const style = outlet({ district: 'Colombo', brand: 'Style' })
    const gampaha = outlet({ district: 'Gampaha' })
    const oa = order(a)
    const os = order(style)
    const og = order(gampaha)
    const base = trip(v, 'Fresh', 'Colombo', [oa])
    const w = world([a, style, gampaha], [oa, os, og], [v], [base])
    for (const o of [os, og]) rejectedOnlyBy(validate(o, v, w, { joinTrip: base.id }), 'trip')
  })

  it('generatePlan never mixes brands or districts in one trip', () => {
    const v = [vehicle({ id: 'VEH901' }), vehicle({ id: 'VEH902' })]
    const outs = [outlet({ district: 'Colombo' }), outlet({ district: 'Gampaha' }), outlet({ district: 'Colombo', brand: 'Style' }), outlet({ district: 'Colombo' })]
    const ords = outs.map((o) => order(o))
    const w = world(outs, ords, v)
    const plan = generatePlan(w, '2026-10-01')
    assert.ok(plan.trips.length >= 3)
    for (const t of plan.trips) {
      for (const id of t.stops) {
        const o = ords.find((x) => x.id === id)!
        const out = outs.find((x) => x.id === o.outletId)!
        assert.equal(o.brand, t.brand)
        assert.equal(out.district, t.district)
      }
    }
  })
})

describe('hard constraint 2: refrigeration', () => {
  it('pass: chilled on a reefer; ambient on a reefer is allowed', () => {
    const reefer = vehicle(REEFER)
    const o = outlet()
    passes(validate(order(o, { temp: 'CHILLED' }), reefer, world([o], [], [reefer])))
    passes(validate(order(o, { temp: 'AMBIENT' }), reefer, world([o], [], [reefer])))
  })
  it('fail: chilled on a dry vehicle', () => {
    const dry = vehicle()
    const o = outlet()
    rejectedOnlyBy(validate(order(o, { temp: 'CHILLED' }), dry, world([o], [], [dry])), 'temperature')
  })
})

describe('hard constraint 3: van-only access', () => {
  it('pass: van_only outlet served by a van', () => {
    const van = vehicle(VAN)
    const o = outlet({ vanOnly: true, parking: 'van_only' })
    passes(validate(order(o, { weightKg: 50, volumeM3: 1 }), van, world([o], [], [van])))
  })
  it('fail: van_only outlet served by a truck', () => {
    const truck = vehicle()
    const o = outlet({ vanOnly: true, parking: 'van_only' })
    rejectedOnlyBy(validate(order(o), truck, world([o], [], [truck])), 'access')
  })
})

describe('hard constraint 4: home depot', () => {
  it('pass: Kandy vehicle serves a Kandy outlet', () => {
    const v = vehicle({ depot: 'Kandy' })
    const o = outlet({ depot: 'Kandy', district: 'Kandy' })
    passes(validate(order(o), v, world([o], [], [v])))
  })
  it('fail: Peliyagoda vehicle cannot serve a Kandy outlet', () => {
    const v = vehicle({ depot: 'Peliyagoda' })
    const o = outlet({ depot: 'Kandy', district: 'Kandy' })
    rejectedOnlyBy(validate(order(o), v, world([o], [], [v])), 'depot')
  })
})

describe('hard constraint 5: whole orders, never split', () => {
  it('pass: generatePlan puts each order on exactly one trip', () => {
    const v = [vehicle({ id: 'VEH901' }), vehicle({ id: 'VEH902' })]
    const outs = [1, 2, 3, 4, 5].map(() => outlet({ district: 'Colombo' }))
    const ords = outs.map((o) => order(o, { weightKg: 2000, volumeM3: 12 }))
    const plan = generatePlan(world(outs, ords, v), '2026-10-01')
    const seen = plan.trips.flatMap((t) => t.stops)
    assert.equal(new Set(seen).size, seen.length, 'an order appears on two trips')
    for (const id of Object.keys(plan.assigned)) assert.equal(seen.filter((s) => s === id).length, 1)
  })
  it('fail: an order too large for any vehicle is deferred whole, not split across two', () => {
    const v = [vehicle({ id: 'VEH901', capacityKg: 5000 }), vehicle({ id: 'VEH902', capacityKg: 5000 })]
    const o = outlet({ district: 'Colombo' })
    const big = order(o, { weightKg: 8000, volumeM3: 10 }) // fits on two vehicles combined, on neither alone
    const plan = generatePlan(world([o], [big], v), '2026-10-01')
    assert.equal(plan.assigned[big.id], undefined)
    assert.equal(plan.deferred[big.id]?.code, 'weight_cap')
    assert.equal(plan.trips.length, 0)
  })
})

describe('hard constraint 6: capacity per trip (weight AND volume)', () => {
  it('pass: exactly at both caps', () => {
    const v = vehicle({ capacityKg: 1000, capacityM3: 10 })
    const o = outlet()
    passes(validate(order(o, { weightKg: 1000, volumeM3: 10 }), v, world([o], [], [v])))
  })
  it('fail: over weight only', () => {
    const v = vehicle({ capacityKg: 1000, capacityM3: 10 })
    const o = outlet()
    rejectedOnlyBy(validate(order(o, { weightKg: 1001, volumeM3: 5 }), v, world([o], [], [v])), 'weight')
  })
  it('fail: over volume only', () => {
    const v = vehicle({ capacityKg: 1000, capacityM3: 10 })
    const o = outlet()
    rejectedOnlyBy(validate(order(o, { weightKg: 500, volumeM3: 10.5 }), v, world([o], [], [v])), 'volume')
  })
  it('fail: orders that fit alone but not together on one trip', () => {
    const v = vehicle({ capacityKg: 1000, capacityM3: 10 })
    const a = outlet()
    const b = outlet()
    const oa = order(a, { weightKg: 600, volumeM3: 3 })
    const ob = order(b, { weightKg: 600, volumeM3: 3 })
    rejectedOnlyBy(validate(ob, v, world([a, b], [oa, ob], [v], [trip(v, 'Fresh', 'Colombo', [oa])])), 'weight')
  })
})

describe('hard constraint 7: at most 2 trips per vehicle per day, all brands combined', () => {
  it('pass: second trip of a different brand is allowed', () => {
    const v = vehicle()
    const a = outlet({ district: 'Colombo' })
    const b = outlet({ district: 'Colombo', brand: 'Style' })
    const oa = order(a)
    const ob = order(b)
    const r = validate(ob, v, world([a, b], [oa, ob], [v], [trip(v, 'Fresh', 'Colombo', [oa])]))
    passes(r)
    assert.equal(r.day.trips.length, TRIPS_PER_VEHICLE)
  })
  it('fail: Fresh + Style already run, a Tech trip is a third', () => {
    const v = vehicle()
    const a = outlet({ district: 'Colombo' })
    const b = outlet({ district: 'Colombo', brand: 'Style' })
    const c = outlet({ district: 'Colombo', brand: 'Tech' })
    const oa = order(a)
    const ob = order(b)
    const oc = order(c)
    const w = world([a, b, c], [oa, ob, oc], [v], [trip(v, 'Fresh', 'Colombo', [oa]), trip(v, 'Style', 'Colombo', [ob], { departure: hm(6, 30) })])
    rejectedOnlyBy(validate(oc, v, w), 'trips')
  })
})

describe('hard constraint 8: separate time budgets (Fresh 270, Style+Tech 480)', () => {
  it('budget constants match the booklet', () => {
    assert.equal(BUDGET.fresh, 270)
    assert.equal(BUDGET.styleTech, 480)
  })
  it('pass: Fresh trip at exactly 270 minutes', () => {
    // Galle outbound 95 + street 16 = 111 per single-stop trip; build a 270-min trip with 12-min hops: 95 + 12(n-1) + 16n = 270 → n = 6.25, so use a custom district.
    const custom = [...DISTRICTS, district('Exact', 'Peliyagoda', 254, 0)]
    const v = vehicle()
    const o = outlet({ district: 'Exact' })
    const ord = order(o)
    const w = { ...world([o], [ord], [v]), districts: custom }
    const r = validate(ord, v, w)
    assert.equal(r.day.freshMin, 270)
    assert.equal(check(r, 'budget').ok, true)
  })
  it('fail: Fresh trip at 271 minutes', () => {
    const custom = [...DISTRICTS, district('Over', 'Peliyagoda', 255, 0)]
    const v = vehicle()
    const o = outlet({ district: 'Over' })
    const ord = order(o)
    const r = validate(ord, v, { ...world([o], [ord], [v]), districts: custom })
    assert.equal(r.day.freshMin, 271)
    assert.equal(check(r, 'budget').ok, false)
  })
  it('fail: a second Fresh trip that pushes the day over 270', () => {
    // Galle 95 + 16 = 111; two of them = 222 fits, so use a heavier first trip.
    const custom = [...DISTRICTS, district('Long', 'Peliyagoda', 200, 0)]
    const v = vehicle()
    const a = outlet({ district: 'Long' })
    const b = outlet({ district: 'Galle' })
    const oa = order(a)
    const ob = order(b)
    const w = { ...world([a, b], [oa, ob], [v], [trip(v, 'Fresh', 'Long', [oa])]), districts: custom }
    rejectedOnlyBy(validate(ob, v, w), 'budget') // 216 + 111 = 327 > 270
  })
  it('pass: Style + Tech may use up to 480, well past the Fresh limit', () => {
    const custom = [...DISTRICTS, district('Far', 'Peliyagoda', 300, 0)]
    const v = vehicle()
    const o = outlet({ district: 'Far', brand: 'Style' })
    const ord = order(o)
    const r = validate(ord, v, { ...world([o], [ord], [v]), districts: custom })
    assert.equal(r.day.styleTechMin, 322)
    passes(r)
  })
  it('the two budgets are separate: Fresh minutes do not count against Style + Tech', () => {
    const v = vehicle()
    const f = outlet({ district: 'Colombo' })
    const s = outlet({ district: 'Colombo', brand: 'Style' })
    const of = order(f)
    const os = order(s)
    const d = vehicleDay(v, [trip(v, 'Fresh', 'Colombo', [of]), trip(v, 'Style', 'Colombo', [os], { departure: hm(6, 30) })], world([f, s], [of, os], [v]))
    assert.equal(d.freshMin, 24 + 16)
    assert.equal(d.styleTechMin, 24 + 22)
  })
})

describe('hard constraint 9: delivery windows', () => {
  it('pass: arrival inside the window, early vehicle waits for the window to open', () => {
    const v = vehicle()
    const o = outlet({ window: [hm(6), hm(8)], requestedWindow: [hm(6), hm(8)] })
    const ord = order(o)
    const w = world([o], [ord], [v])
    const r = validate(ord, v, w)
    passes(r)
    const stop = r.schedule.stops[0]
    assert.ok(stop.start >= hm(6))
    assert.equal(stop.late, false)
    // An explicitly early departure waits rather than arriving before the window opens.
    const early = scheduleTrip(trip(v, 'Fresh', 'Colombo', [ord], { departure: hm(3, 30) }), v, w).stops[0]
    assert.equal(early.eta, hm(3, 30) + 24)
    assert.equal(early.start, hm(6))
    assert.equal(early.wait, hm(6) - early.eta)
  })
  it('fail: arrival after the window closes', () => {
    const v = vehicle()
    // Window shut before the earliest possible arrival (03:30 + 24 min = 03:54).
    const o = outlet({ window: [hm(3), hm(3, 45)], requestedWindow: [hm(3), hm(3, 45)] })
    const ord = order(o)
    rejectedOnlyBy(validate(ord, v, world([o], [ord], [v])), 'window')
  })
})

describe('hard constraint 10: mall access windows', () => {
  it('effectiveWindow narrows the requested window to the mall window', () => {
    assert.deepEqual(effectiveWindow([hm(6), hm(12)], [hm(10), hm(14)]), [hm(10), hm(12)])
    assert.deepEqual(effectiveWindow([hm(6), hm(12)]), [hm(6), hm(12)])
  })
  it('effectiveWindow: when the two never overlap the mall window wins (team assumption)', () => {
    assert.deepEqual(effectiveWindow([hm(6), hm(8)], [hm(10), hm(12)]), [hm(10), hm(12)])
  })
  it('pass: mall delivery inside the mall window (vehicle waits until it opens)', () => {
    const v = vehicle()
    const mall = [hm(10), hm(12)] as [number, number]
    const o = outlet({ brand: 'Style', dock: 'mall_bay', mall: true, parking: 'mall_dock', mallWindow: mall, requestedWindow: [hm(6), hm(18)], window: effectiveWindow([hm(6), hm(18)], mall) })
    const ord = order(o)
    const r = validate(ord, v, world([o], [ord], [v]))
    passes(r)
    assert.equal(r.schedule.stops[0].start, hm(10))
  })
  it('fail: mall delivery before the mall opens, even when the outlet window was never narrowed', () => {
    const v = vehicle()
    // Requested window is wide open; only mallWindow says 10:00–12:00. Style leaves at 06:30, so the vehicle would serve it at ~06:54.
    const o = outlet({ brand: 'Style', dock: 'mall_bay', mall: true, parking: 'mall_dock', mallWindow: [hm(10), hm(12)] })
    const ord = order(o)
    const r = validate(ord, v, world([o], [ord], [v]))
    rejectedOnlyBy(r, 'mall')
    assert.match(check(r, 'mall').detail, /mall bay only open 10:00–12:00/)
  })
  it('fail: mall delivery after the mall window closes is rejected by the mall check as well', () => {
    const v = vehicle()
    const mall = [hm(7), hm(8)] as [number, number]
    const o = outlet({ brand: 'Style', district: 'Galle', dock: 'mall_bay', mall: true, parking: 'mall_dock', mallWindow: mall, requestedWindow: [hm(6), hm(18)], window: effectiveWindow([hm(6), hm(18)], mall) })
    const other = outlet({ brand: 'Style', district: 'Colombo' })
    const ord = order(o)
    const oo = order(other)
    const busy = trip(v, 'Style', 'Colombo', [oo], { departure: hm(7, 30), status: 'IN_PROGRESS' })
    const r = validate(ord, v, world([o, other], [ord, oo], [v], [busy]))
    assert.equal(check(r, 'mall').ok, false)
    assert.equal(check(r, 'window').ok, false)
  })
  it('fail: mall delivery that can only arrive after the mall window closes', () => {
    const v = vehicle()
    const mall = [hm(7), hm(8)] as [number, number]
    const o = outlet({ brand: 'Style', district: 'Galle', dock: 'mall_bay', mall: true, parking: 'mall_dock', mallWindow: mall, requestedWindow: [hm(6), hm(18)], window: effectiveWindow([hm(6), hm(18)], mall) })
    const ord = order(o)
    // A vehicle already committed elsewhere until after 08:00 cannot reach the mall in time.
    const other = outlet({ brand: 'Style', district: 'Colombo' })
    const oo = order(other)
    const busy = trip(v, 'Style', 'Colombo', [oo], { departure: hm(7, 30), status: 'IN_PROGRESS' })
    const r = validate(ord, v, world([o, other], [ord, oo], [v], [busy]))
    assert.equal(check(r, 'window').ok, false)
    assert.equal(r.ok, false)
  })
})

describe('hard constraint 11: weekly fuel quota', () => {
  it('pass: projected use stays within the quota', () => {
    const v = vehicle({ fuelQuotaL: 100, fuelUsedL: 50 })
    const o = outlet()
    const r = validate(order(o), v, world([o], [], [v]))
    passes(r)
    assert.ok(r.fuelProjected > 50 && r.fuelProjected <= 100)
  })
  it('fail: today’s litres push the week over the quota', () => {
    const v = vehicle({ fuelQuotaL: 100, fuelUsedL: 99 })
    const o = outlet()
    rejectedOnlyBy(validate(order(o), v, world([o], [], [v])), 'fuel')
  })
  it('fuel model (team policy): trip_km = 2 × depot_to_district_km + inter_stop_km × (stops − 1); litres = km / km_per_l', () => {
    const v = vehicle({ kmPerL: 5 })
    const outs = [outlet({ district: 'Colombo' }), outlet({ district: 'Colombo' })]
    const ords = outs.map((o) => order(o))
    const s = scheduleTrip(trip(v, 'Fresh', 'Colombo', ords), v, world(outs, ords, [v]))
    assert.equal(s.distanceKm, 2 * 10 + 3)
    assert.equal(s.fuelL, 4.6)
  })
})

describe('unknown order ids are reported, never silently skipped', () => {
  it('scheduleTrip lists stop ids whose order or outlet is missing', () => {
    const v = vehicle()
    const o = outlet({ district: 'Colombo' })
    const ord = order(o)
    const orphan = order(outlet({ district: 'Colombo' })) // its outlet is not in the world
    const s = scheduleTrip(trip(v, 'Fresh', 'Colombo', [ord, orphan]), v, world([o], [ord, orphan], [v]))
    assert.deepEqual(s.unknownOrders, [orphan.id])
    const s2 = scheduleTrip(trip(v, 'Fresh', 'Colombo', [ord, { id: 'ORD-GHOST' } as Order]), v, world([o], [ord], [v]))
    assert.deepEqual(s2.unknownOrders, ['ORD-GHOST'])
    assert.equal(s2.minutes, 24 + 16, 'unknown stops add no time')
  })
  it('validate rejects a vehicle whose trip carries an unknown order', () => {
    const v = vehicle()
    const a = outlet({ district: 'Colombo' })
    const b = outlet({ district: 'Colombo' })
    const oa = order(a)
    const ob = order(b)
    const dangling = trip(v, 'Fresh', 'Colombo', [oa, { id: 'ORD-GHOST' } as Order])
    const r = validate(ob, v, world([a, b], [oa, ob], [v], [dangling]))
    assert.equal(check(r, 'orders').ok, false)
    assert.match(check(r, 'orders').detail, /ORD-GHOST/)
    assert.equal(r.ok, false)
  })
  it('validate accepts the order under test even when the snapshot does not list it yet', () => {
    const v = vehicle()
    const o = outlet()
    const ord = order(o, { weightKg: 6000 }) // over the 5000 kg cap: must be measured, not skipped
    rejectedOnlyBy(validate(ord, v, world([o], [], [v])), 'weight')
  })
})

describe('manual dispatcher edits go through the same validator', () => {
  const fresh = () => {
    const d = seedOps({ today: '2026-09-30' })
    commands.generatePlan(d)
    return d
  }
  it('assign() refuses an invalid target and leaves the plan untouched', () => {
    const d = fresh()
    const o = d.orders.find((x) => x.temp === 'CHILLED' && x.tripId)!
    const before = JSON.stringify(d.trips.map((t) => [t.id, t.stops]))
    const dry = d.vehicles.find((v) => v.temp === 'ambient' && v.status === 'AVAILABLE' && v.depot === byId(d.outlets, o.outletId)!.depot)!
    const r = commands.assign(d, o.id, dry.id)
    assert.equal(r.ok, false)
    assert.equal(check(r, 'temperature').ok, false)
    assert.equal(JSON.stringify(d.trips.map((t) => [t.id, t.stops])), before)
  })
  it('assign() never produces a trip that mixes brands or districts', () => {
    const d = fresh()
    // Try orders against many vehicles, as a dispatcher dragging around would; whatever is accepted must stay valid.
    for (const o of d.orders.filter((x) => x.tripId).slice(0, 25)) {
      for (const v of d.vehicles.filter((x) => x.depot === byId(d.outlets, o.outletId)!.depot).slice(0, 12)) commands.assign(d, o.id, v.id)
    }
    for (const t of d.trips) {
      for (const id of t.stops) {
        const o = byId(d.orders, id)!
        assert.equal(o.brand, t.brand, `${t.id} mixes brands`)
        assert.equal(byId(d.outlets, o.outletId)!.district, t.district, `${t.id} mixes districts`)
      }
    }
  })
})

describe('hard constraint 12: vehicle availability', () => {
  it('pass: available vehicle', () => {
    const v = vehicle()
    const o = outlet()
    passes(validate(order(o), v, world([o], [], [v])))
  })
  it('fail: vehicle in the workshop or broken down', () => {
    const o = outlet()
    for (const status of ['IN_WORKSHOP', 'BREAKDOWN'] as const) {
      const v = vehicle({ status })
      rejectedOnlyBy(validate(order(o), v, world([o], [], [v])), 'status')
    }
  })
  it('generatePlan never allocates an unavailable vehicle', () => {
    const down = vehicle({ id: 'VEH901', status: 'IN_WORKSHOP' })
    const o = outlet()
    const ord = order(o)
    const plan = generatePlan(world([o], [ord], [down]), '2026-10-01')
    assert.equal(plan.assigned[ord.id], undefined)
    assert.equal(plan.deferred[ord.id]?.code, 'vehicle_unavailable')
  })
})
