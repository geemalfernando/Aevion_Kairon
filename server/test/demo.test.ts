/** The demo delivery day: the story cast has the roles the walkthrough needs, and a reset rebuilds the same network. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RECOVERY_RESERVE, seedDemoOps, STORY, STORY_OUTLETS, storedReference } from '@core/demo'
import { byId } from '@core/rules'

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
})
