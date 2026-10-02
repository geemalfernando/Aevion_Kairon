import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seedOps as emptyOps, opNow } from '@core/ops'
import { buildReference } from '@core/reference'
import { demandForecast, tripPredictions } from '@core/predict'
import type { OpsData, FieldEvent, QueuedEvent, User } from '@core/types'
import { profile, verifyToken, type Session } from '../src/auth'
import { Operation } from '../src/operation'
import { transaction, type Tx } from '../src/db'
import { seedOps } from './fixtures/operation'

const user = (role: User['role'], extra: Partial<Session> = {}): Session => ({ id: role, email: `${role.toLowerCase()}@example.test`, name: role, role, depot: 'Peliyagoda', exp: Date.now() + 3600000, ...extra })
function memoryRepository(initial: OpsData | null) {
  let saved = structuredClone(initial)
  const receipts = new Set<string>()
  let fail = false
  return {
    loadOps: async () => structuredClone(saved),
    persistState: async (before: OpsData | null, after: OpsData, tx: Tx) => {
      if (fail) throw new Error('Database unavailable')
      assert.equal(before?.version ?? 0, saved?.version ?? 0)
      after.version = (before?.version ?? 0) + 1
      saved = structuredClone(after)
      tx.events.forEach((e) => receipts.add(e.id))
    },
    transaction,
    seenEvents: async (ids: string[]) => new Set(ids.filter((id) => receipts.has(id))),
    loadMedia: async () => undefined,
    failWrites: () => { fail = true },
  }
}
const log = { info: () => {}, warn: () => {} }

test('production initialization has no sample records, clock offsets or forecasts', async () => {
  const d = emptyOps()
  for (const key of ['orders', 'outlets', 'vehicles', 'trips', 'audit', 'issues'] as const) assert.equal(d[key].length, 0)
  assert.deepEqual(d.catalog, {})
  assert.ok(Math.abs(opNow(d) - Date.now()) < 1000)
  assert.deepEqual(demandForecast(d, '2026-09-30'), [])
  assert.deepEqual(tripPredictions(d, 'missing'), {})
  assert.equal(buildReference().sources.outlets, 'missing')
  const op = new Operation(log, memoryRepository(null))
  await op.init()
  assert.equal(op.data.orders.length, 0)
})

test('profiles require administrator-controlled role, name and depot; malformed tokens fail closed', async () => {
  assert.equal(profile('a@example.test', {}), null)
  assert.equal(profile('a@example.test', { role: 'ADMIN', name: 'A', depot: 'Peliyagoda' }), null)
  assert.equal(profile('a@example.test', { role: 'DRIVER', name: 'A', depot: 'Unknown' }), null)
  assert.equal(profile('a@example.test', { role: 'DRIVER', name: 'A', depot: 'Kandy', assignedVehicle: 'REAL-ID' })?.assignedVehicle, 'REAL-ID')
  assert.equal(await verifyToken(undefined), null)
  assert.equal(await verifyToken('forged.demo.token'), null)
})

test('roles and assignments are enforced even if the client bypasses its UI', async () => {
  const op = new Operation(log, memoryRepository(seedOps()))
  await op.init()
  await assert.rejects(op.command(user('STORE_MANAGER'), 'generatePlan', []), /may not run/)
  await assert.rejects(op.command(user('STORE_MANAGER', { assignedOutlet: 'OUT005' }), 'createOrder', ['OUT001', [], '']), /own outlet/)
  await assert.rejects(op.command(user('DISPATCHER'), 'simulateFleet', ['VEH002']), /may not run/)
  const event: QueuedEvent = { id: 'unassigned', at: Date.now(), actor: 'DRIVER', status: 'pending', event: { type: 'START_ROUTE', tripId: 'missing' } }
  assert.equal((await op.events(user('DRIVER'), [event]))[0].status, 'rejected')
})

test('failed persistence does not publish the draft or notify connected devices', async () => {
  const repo = memoryRepository(seedOps())
  const op = new Operation(log, repo)
  await op.init()
  const before = structuredClone(op.data)
  let emitted = false
  op.subscribe(() => { emitted = true })
  repo.failWrites()
  await assert.rejects(op.command(user('DISPATCHER'), 'closeOrders', []), /Database unavailable/)
  assert.deepEqual(op.data, before)
  assert.equal(emitted, false)
})

test('order, plan, loading, delivery and store receipt survive reload; offline retries are idempotent', async () => {
  const initial = seedOps()
  initial.orders = []
  const repo = memoryRepository(initial)
  const op = new Operation(log, repo)
  await op.init()
  const outlet = initial.outlets.find((o) => o.brand === 'Fresh' && o.depot === 'Peliyagoda')!
  const store = user('STORE_MANAGER', { assignedOutlet: outlet.id })
  const created = await op.command(store, 'createOrder', [outlet.id, [{ name: 'Dairy', unit: 'crates', qty: 1 }], '']) as { ids: string[] }
  assert.equal(created.ids.length, 1)
  await op.command(user('DISPATCHER'), 'closeOrders', [])
  await op.command(user('DISPATCHER'), 'generatePlan', [])
  await op.command(user('DISPATCHER'), 'publishPlan', [])
  const order = op.data.orders.find((o) => o.id === created.ids[0])!
  const trip = op.data.trips.find((t) => t.id === order.tripId)!
  assert.ok(trip)
  const driver = user('DRIVER', { assignedVehicle: trip.vehicleId })
  const loader = user('LOADER')
  let n = 0
  const send = async (actor: Session, event: FieldEvent) => {
    const queued: QueuedEvent = { id: `flow-${++n}`, at: opNow(op.data), actor: actor.role, status: 'pending', event }
    const [result, duplicate] = await op.events(actor, [queued, queued])
    assert.equal(result.status, 'applied', result.message)
    assert.equal(duplicate.status, 'duplicate')
    assert.equal((await op.events(actor, [queued]))[0].status, 'duplicate')
  }
  await send(loader, { type: 'LOAD_START', tripId: trip.id })
  await send(loader, { type: 'LOAD_COUNT', orderId: order.id, item: 'Dairy', count: 1 })
  await send(loader, { type: 'LOAD_COMPLETE', tripId: trip.id })
  await send(driver, { type: 'START_ROUTE', tripId: trip.id })
  await send(driver, { type: 'ARRIVE', orderId: order.id, tripId: trip.id })
  await send(driver, { type: 'DELIVER', orderId: order.id, tripId: trip.id, record: { outcome: 'DELIVERED', receiver: 'Receiving staff', completedAt: opNow(op.data) } })
  await op.command(store, 'confirmReceipt', [order.id, { received: 1, condition: 'GOOD', receiver: 'Receiving staff' }])
  const restarted = new Operation(log, repo)
  await restarted.init()
  assert.equal(restarted.data.orders.find((o) => o.id === order.id)?.status, 'RECEIVED')
})
