/** The demo delivery day: the story cast has the roles the walkthrough needs, and a reset rebuilds the same network. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RECOVERY_RESERVE, seedDemoOps, STORY, STORY_OUTLETS, storedReference } from '@core/demo'
import { applyEvent, commands, opNow } from '@core/ops'
import { byId } from '@core/rules'
import { colomboDate, colomboTs, hm } from '@core/time'
import type { FieldEvent, OpsData } from '@core/types'

describe('demo delivery day', () => {
  const d = seedDemoOps({ today: '2026-09-27' })
  it('casts the story on vehicles and outlets with the roles the walkthrough needs', () => {
    const v = byId(d.vehicles, STORY.vehicle)!
    assert.deepEqual([v.kind, v.temp, v.depot, v.status], ['truck', 'reefer', 'Peliyagoda', 'AVAILABLE'])
    const van = byId(d.vehicles, STORY.reserveVan)!
    assert.deepEqual([van.kind, van.temp, van.depot, !!van.reserve], ['van', 'reefer', 'Peliyagoda', true])
    for (const id of RECOVERY_RESERVE) assert.equal(byId(d.vehicles, id)?.temp, 'reefer', `${id} is a reefer`)
    for (const id of Object.keys(STORY_OUTLETS).filter((id) => id !== STORY.skipped)) {
      const o = byId(d.outlets, id)!
      assert.deepEqual([o.brand, o.district, o.parking], ['Fresh', 'Colombo', 'normal'], id)
    }
    assert.equal(byId(d.outlets, STORY.store)?.manager, 'Dilini')
    assert.ok(byId(d.outlets, STORY.skipped)?.deferredYesterday)
  })
  it('a reset without the CSVs rebuilds the same network and fleet from the stored rows', () => {
    const ref = storedReference(d)
    assert.ok(ref)
    const again = seedDemoOps({ today: '2026-10-05', reference: ref })
    assert.deepEqual(again.outlets.map((o) => [o.id, o.brand, o.district, o.parking]), d.outlets.map((o) => [o.id, o.brand, o.district, o.parking]))
    assert.deepEqual(again.vehicles.map((v) => [v.id, v.kind, v.temp, v.status]), d.vehicles.map((v) => [v.id, v.kind, v.temp, v.status]))
    assert.notEqual(again.deliveryDate, d.deliveryDate)
    assert.ok(again.orders.length > 100)
  })
  it('the hero story runs to receipt: road blocked, Borella moved to the reserve van, delivered, confirmed', () => {
    const w = seedDemoOps({ today: '2026-09-27' })
    const at = (min: number) => commands.setClock(w, colomboTs(w.deliveryDate, min))
    const ev = (actor: 'LOADER' | 'DRIVER', event: FieldEvent) => applyEvent(w, { actor, event, at: opNow(w) })
    commands.closeOrders(w)
    commands.setClock(w, colomboTs(colomboDate(opNow(w)), hm(16, 5)))
    commands.generatePlan(w)
    commands.publishPlan(w)
    const trip = byId(w.trips, STORY.trip)!
    at(hm(3, 40))
    ev('LOADER', { type: 'LOAD_START', tripId: trip.id })
    for (const id of trip.stops) for (const i of byId(w.orders, id)!.items) ev('LOADER', { type: 'LOAD_COUNT', orderId: id, item: i.name, count: i.qty })
    ev('LOADER', { type: 'LOAD_COMPLETE', tripId: trip.id })
    at(hm(4, 40))
    ev('DRIVER', { type: 'START_ROUTE', tripId: trip.id })
    const borella = trip.stops.find((id) => byId(w.orders, id)!.outletId === STORY.store)!
    ev('DRIVER', { type: 'VEHICLE_ISSUE', vehicleId: STORY.vehicle, tripId: trip.id, kind: 'Road blocked', delayOrderId: borella, delayMin: 90 })
    at(hm(5, 40))
    const moved = commands.moveStop(w, borella, STORY.reserveVan, 'Road to Borella blocked')
    assert.ok(moved.ok, JSON.stringify(moved))
    assert.equal(byId(w.trips, byId(w.orders, borella)!.tripId)?.vehicleId, STORY.reserveVan)
    const run = commands.simulateRun(w, STORY.reserveVan)
    assert.ok(run.ok && run.delivered === 1, JSON.stringify(run))
    const o = byId(w.orders, borella)!
    assert.equal(o.status, 'DELIVERED')
    const window = byId(w.outlets, STORY.store)!.window
    assert.ok(o.delivery!.completedAt! <= colomboTs(w.deliveryDate, window[1]), 'delivered inside the window')
    commands.confirmReceipt(w, borella, { received: o.units, condition: 'GOOD', receiver: 'Dilini' })
    assert.equal((byId(w.orders, borella) as OpsData['orders'][number]).status, 'RECEIVED')
    assert.equal(commands.simulateRun(w, STORY.reserveVan).ok, false, 'nothing left to deliver')
  })
})
