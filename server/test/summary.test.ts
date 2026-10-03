/**
 * The public landing-page summary (core/src/summary.ts): real figures from the operation,
 * aggregates only, and no outlet rows once the network comes from the competition datasets.
 *   npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { seedDemoOps } from '@core/demo'
import { commands } from '@core/ops'
import { isPlaceholderNetwork, publicSummary } from '@core/summary'

describe('public landing summary', () => {
  it('counts the open ordering day before planning', () => {
    const d = seedDemoOps({ today: '2026-10-02' })
    const s = publicSummary(d)
    assert.equal(s.deliveryDate, d.deliveryDate)
    assert.equal(s.counts.outlets, d.outlets.length)
    assert.equal(s.counts.vehicles, d.vehicles.length)
    assert.equal(s.counts.orders, d.orders.filter((o) => o.deliveryDate === d.deliveryDate).length)
    assert.equal(s.counts.trips, 0)
    assert.equal(s.featuredTrip, undefined)
    assert.equal(s.districts.reduce((n, r) => n + r.total, 0), d.outlets.length)
    assert.equal(s.brands.Fresh + s.brands.Style + s.brands.Tech, d.outlets.length)
  })

  it('reports the real plan: served, deferred, a featured trip and the top deferral', () => {
    const d = seedDemoOps({ today: '2026-10-02' })
    commands.closeOrders(d)
    commands.generatePlan(d)
    const s = publicSummary(d)
    const today = d.orders.filter((o) => o.deliveryDate === d.deliveryDate)
    assert.equal(s.counts.planned, today.filter((o) => o.tripId).length)
    assert.equal(s.counts.deferred, today.filter((o) => o.status === 'DEFERRED').length)
    assert.ok(s.counts.trips > 0)
    const t = s.featuredTrip!
    const trip = d.trips.find((x) => x.vehicleId === t.vehicleId && x.district === t.district)!
    assert.deepEqual(t.stops.map((x) => x.outletId), trip.stops.map((id) => d.orders.find((o) => o.id === id)!.outletId))
    assert.ok(t.stops.every((x) => /^\d\d:\d\d$/.test(x.eta)))
    if (s.counts.deferred) {
      const top = today.filter((o) => o.status === 'DEFERRED').sort((a, b) => b.priority - a.priority)[0]
      assert.equal(s.topDeferral?.outletId, top.outletId)
    }
  })

  it('never exposes managers, delivery windows or order contents', () => {
    const d = seedDemoOps({ today: '2026-10-02' })
    const json = JSON.stringify(publicSummary(d))
    for (const o of d.outlets.slice(0, 5)) if (o.manager) assert.ok(!json.includes(`"${o.manager}"`), 'manager leaked')
    for (const key of ['"manager"', '"window"', '"requestedWindow"', '"lines"', '"items"', '"email"']) assert.ok(!json.includes(key), `${key} leaked`)
  })

  it('withholds outlet map points when the network is not the built-in placeholder one', () => {
    const d = seedDemoOps({ today: '2026-10-02' })
    assert.ok(isPlaceholderNetwork(d))
    assert.equal(publicSummary(d).outlets?.length, d.outlets.length)
    d.outlets[0].name = 'Imported outlet'
    assert.ok(!isPlaceholderNetwork(d))
    const s = publicSummary(d)
    assert.equal(s.outlets, undefined)
    assert.equal(s.counts.outlets, d.outlets.length)
  })
})
