/** Closing a delivery day: weekly fuel builds up across days, a new week resets it, deferred orders carry over. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { seedDemoOps } from '@core/demo'
import { commands } from '@core/ops'
import { byId, validate, vehicleDay } from '@core/rules'
import { colomboTs, isoWeekOf } from '@core/time'
import type { OpsData } from '@core/types'

/** Plan and publish the day, then mark every trip as driven. */
function runDay(d: OpsData) {
  commands.closeOrders(d)
  commands.generatePlan(d)
  commands.publishPlan(d)
  return commands.simulateDayEnd(d)
}
const week = (date: string) => JSON.stringify(isoWeekOf(date))

describe('closing the day', () => {
  it('the demo can finish every trip, delivering every planned stop at its scheduled time', () => {
    const d = seedDemoOps({ today: '2026-09-27' })
    const r = runDay(d)
    const planned = d.orders.filter((o) => o.tripId && o.deliveryDate === d.deliveryDate)
    assert.ok(r.trips > 0)
    assert.equal(r.delivered, planned.length)
    for (const t of d.trips) assert.equal(t.status, 'COMPLETED', t.id)
    for (const o of planned) {
      const window = byId(d.outlets, o.outletId)!.window
      assert.ok(o.delivery!.arrivedAt! <= colomboTs(d.deliveryDate, window[1]), `${o.id} arrives inside its window`)
    }
  })

  it('is refused while a trip is still loading or on the road', () => {
    const d = seedDemoOps({ today: '2026-09-27' })
    commands.closeOrders(d)
    commands.generatePlan(d)
    commands.publishPlan(d)
    d.trips[0].status = 'IN_PROGRESS'
    const r = commands.startNextDay(d)
    assert.equal(r.ok, false)
    assert.equal(d.deliveryDate, '2026-09-28')
  })

  it('adds the day’s driven fuel to each vehicle’s week and opens the next operating day', () => {
    const d = seedDemoOps({ today: '2026-09-27' })
    runDay(d)
    const before = new Map(d.vehicles.map((v) => [v.id, v.fuelUsedL + vehicleDay(v, d.trips, d).fuelL]))
    const from = d.deliveryDate
    const r = commands.startNextDay(d)
    assert.ok(r.ok)
    assert.notEqual(d.deliveryDate, from)
    assert.equal(week(d.deliveryDate), week(from), 'same week in this scenario')
    for (const v of d.vehicles) assert.ok(Math.abs(v.fuelUsedL - before.get(v.id)!) < 0.2, `${v.id} carries its fuel`)
    assert.ok(r.litres > 0)
    assert.equal(d.trips.length, 0)
    assert.equal(d.plan, 'NONE')
    assert.equal(d.ordersClosed, false)
  })

  it('carries deferred orders to the next run and marks their outlets as skipped', () => {
    const d = seedDemoOps({ today: '2026-09-27' })
    runDay(d)
    const deferred = d.orders.filter((o) => o.status === 'DEFERRED' && o.deliveryDate === d.deliveryDate)
    assert.ok(deferred.length > 0, 'the demo day defers some orders')
    commands.startNextDay(d)
    for (const o of deferred) {
      const now = byId(d.orders, o.id)!
      assert.equal(now.status, 'CONFIRMED')
      assert.equal(now.deliveryDate, d.deliveryDate)
      assert.ok(byId(d.outlets, o.outletId)!.deferredYesterday, `${o.outletId} skipped on the previous run`)
    }
  })

  it('the weekly quota fills up over the week and blocks the vehicle, then resets on a new week', () => {
    const d = seedDemoOps({ today: '2026-09-27' })
    const v = d.vehicles.find((x) => x.status === 'AVAILABLE' && !x.reserve && x.temp === 'ambient' && x.depot === 'Peliyagoda')!
    const order = d.orders.find((o) => o.temp === 'AMBIENT' && byId(d.outlets, o.outletId)!.depot === v.depot && !byId(d.outlets, o.outletId)!.vanOnly && validate(o, v, d).ok)!
    assert.ok(order, 'an order this vehicle can take')
    // Each day the vehicle drives a trip that uses a fifth of its quota.
    const startWeek = week(d.deliveryDate)
    let blocked = false
    for (let i = 0; i < 6 && week(d.deliveryDate) === startWeek; i++) {
      const check = validate(order, v, { ...d, trips: [] })
      if (!check.ok) {
        assert.ok(check.checks.some((c) => c.key === 'fuel' && !c.ok), 'blocked by the fuel quota')
        blocked = true
        break
      }
      v.fuelUsedL += v.fuelQuotaL / 5
      const next = commands.startNextDay(d)
      assert.ok(next.ok)
    }
    assert.ok(blocked, 'the fuel quota blocked the vehicle before the week ended')
    // Close days until the week changes: every vehicle starts the new week at 0.
    while (week(d.deliveryDate) === startWeek) commands.startNextDay(d)
    for (const x of d.vehicles) assert.equal(x.fuelUsedL, 0)
    assert.ok(validate(order, v, { ...d, trips: [] }).checks.find((c) => c.key === 'fuel')!.ok)
  })
})
