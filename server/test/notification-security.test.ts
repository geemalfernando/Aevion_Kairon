import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notificationVisible, projectState } from '@core/access'
import { commands } from '@core/ops'
import { scheduleOfTrip } from '@core/rules'
import type { Notification, User, QueuedEvent } from '@core/types'
import { seedOps } from './fixtures/operation'
import { eligible, deliver, type DeliveryPort } from '../src/notifications/delivery'
import { defaultPreferences, validateSubscription } from '../src/notifications/store'
import { signedMedia, verifyMedia } from '../src/media-access'
import { Operation } from '../src/operation'
import { transaction, type Tx } from '../src/db'
import type { Session } from '../src/auth'

const dispatcher: Session = { id: 'dispatcher', name: 'D', email: 'd@example.test', role: 'DISPATCHER', depot: 'Peliyagoda', exp: Date.now() + 3600000 }
const notification: Notification = { id: 'n-1', depot: 'Peliyagoda', to: ['DRIVER'], vehicleId: 'vehicle-1', title: 'Update', body: 'Private operational details', severity: 'HIGH', at: Date.now(), readBy: [] }
const driver: User = { name: 'Driver', email: 'driver@example.test', role: 'DRIVER', depot: 'Peliyagoda', assignedVehicle: 'vehicle-1' }

test('recipients require matching current role, depot, resource assignment and consent level', () => {
  assert.equal(eligible(notification, driver, defaultPreferences), true)
  assert.equal(eligible(notification, { ...driver, depot: 'Kandy' }, defaultPreferences), false)
  assert.equal(eligible(notification, { ...driver, assignedVehicle: 'vehicle-2' }, defaultPreferences), false)
  assert.equal(eligible({ ...notification, vehicleId: undefined }, driver, defaultPreferences), false)
  assert.equal(eligible({ ...notification, severity: 'INFO' }, driver, { ...defaultPreferences, criticalOnly: true }), false)
})

test('stores receive only their orders while keeping the ETA calculated from the full route', () => {
  const full = seedOps()
  commands.generatePlan(full)
  const order = full.orders.find((o) => o.tripId && full.trips.find((t) => t.id === o.tripId)!.stops.indexOf(o.id) > 0)!
  const outlet = full.outlets.find((o) => o.id === order.outletId)!
  const user: User = { name: 'Store', email: 's@example.test', depot: outlet.depot, role: 'STORE_MANAGER', assignedOutlet: outlet.id }
  const expected = scheduleOfTrip(full, full.trips.find((t) => t.id === order.tripId)!).stops.find((s) => s.orderId === order.id)!.eta
  const view = projectState(full, user)
  assert.ok(view.orders.length)
  assert.ok(view.orders.every((o) => o.outletId === outlet.id))
  assert.deepEqual(view.outlets.map((o) => o.id), [outlet.id])
  assert.equal(view.orders.find((o) => o.id === order.id)!.projectedEta?.minutes, expected)
  assert.ok(view.trips.every((t) => t.stops.every((id) => view.orders.some((o) => o.id === id))))
  assert.deepEqual(view.syncLog, [])
  assert.deepEqual(view.predictions, { service: {}, demand: [] })
})

test('notification reads are isolated by individual user and unknown-depot broadcasts fail closed', () => {
  const d = seedOps()
  d.notifications = [{ ...notification, to: ['DISPATCHER'], vehicleId: undefined, readByUserIds: ['dispatcher'] }]
  assert.equal(projectState(d, dispatcher).notifications[0].readBy.includes('DISPATCHER'), true)
  assert.equal(projectState(d, { ...dispatcher, id: 'other-dispatcher' }).notifications[0].readBy.includes('DISPATCHER'), false)
  assert.equal(notificationVisible(d, { ...d.notifications[0], depot: undefined }, dispatcher), false)
  assert.equal(projectState(d, { ...dispatcher, depot: 'Kandy' }).notifications.length, 0)
})

test('signed proof links reject expiration, tampering and a different order', () => {
  const now = Date.now()
  const id = 'a'.repeat(32)
  const url = new URL(signedMedia(id, 'order-1', now), 'https://example.test')
  const expires = url.searchParams.get('expires')!, signature = url.searchParams.get('signature')!
  assert.equal(verifyMedia(id, 'order-1', expires, signature, now), true)
  assert.equal(verifyMedia(id, 'order-2', expires, signature, now), false)
  assert.equal(verifyMedia('b'.repeat(32), 'order-1', expires, signature, now), false)
  assert.equal(verifyMedia(id, 'order-1', expires, signature, now + 601000), false)
  assert.equal(verifyMedia(id, 'order-1', expires, 'forged', now), false)
})

test('push endpoint validation blocks SSRF destinations and malformed credentials', () => {
  const keys = { p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') }
  assert.doesNotThrow(() => validateSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/valid', keys }))
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/', 'https://169.254.169.254/latest/meta-data/', 'https://fcm.googleapis.com.evil.test/', 'https://user:password@fcm.googleapis.com/']) assert.throws(() => validateSubscription({ endpoint, keys }), /provider/)
  assert.throws(() => validateSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...keys, auth: 'invalid' } }), /keys/)
})

function deliveryRepository() {
  let state: string | null = null
  const records: string[] = []
  const repo: DeliveryPort = {
    claim: async () => { if (['sending','sent','skipped'].includes(state ?? '')) return false; state = 'sending'; return true },
    status: async () => state,
    finish: async (_id, status) => { state = status; records.push(status) },
  }
  return { repo, records }
}
test('duplicate queue messages do not resend completed deliveries', async () => {
  const { repo } = deliveryRepository()
  let sent = 0
  const send = async () => { sent++; return 'provider-id' }
  await deliver('delivery-1', 'email', send, repo)
  await deliver('delivery-1', 'email', send, repo)
  assert.equal(sent, 1)
})
test('provider outage records failure and retry succeeds without hiding a concurrent lease', async () => {
  const { repo, records } = deliveryRepository()
  await assert.rejects(deliver('delivery-1', 'sms', async () => { throw new Error('ProviderUnavailable') }, repo), /DeliveryFailed/)
  await deliver('delivery-1', 'sms', async () => 'provider-id', repo)
  assert.deepEqual(records, ['failed','sent'])
  const busy = { ...repo, claim: async () => false, status: async () => 'sending' }
  await assert.rejects(deliver('delivery-2', 'sms', async () => 'never', busy), /LeaseBusy/)
})
test('expired push registrations are removed and marked skipped', async () => {
  const { repo, records } = deliveryRepository()
  let removed = false
  await deliver('delivery-1', 'push', async () => { throw { statusCode: 410 } }, repo, async () => { removed = true })
  assert.equal(removed, true)
  assert.deepEqual(records, ['skipped'])
})

test('dispatcher planning and mutation guards preserve the other depot', async () => {
  let saved = seedOps()
  const repo = { loadOps: async () => structuredClone(saved), persistState: async (before: typeof saved | null, next: typeof saved, _tx: Tx) => { next.version = (before?.version ?? 0) + 1; saved = structuredClone(next) }, transaction, seenEvents: async () => new Set<string>(), loadMedia: async () => undefined }
  const op = new Operation({ info: () => {}, warn: () => {} }, repo)
  await op.init()
  const kandyOutlets = new Set(saved.outlets.filter((o) => o.depot === 'Kandy').map((o) => o.id))
  const foreign = saved.orders.filter((o) => kandyOutlets.has(o.outletId))
  const previousPlan = saved.plan
  await assert.rejects(op.command(dispatcher, 'unassign', [foreign[0].id]), /another depot/)
  await op.command(dispatcher, 'generatePlan', [])
  assert.deepEqual(op.data.orders.filter((o) => kandyOutlets.has(o.outletId)), foreign)
  assert.equal(projectState(op.data, { ...dispatcher, depot: 'Kandy' }).plan, previousPlan)
  const own = op.data.orders.find((o) => !kandyOutlets.has(o.outletId) && o.tripId)!
  const trip = op.data.trips.find((t) => t.id === own.tripId)!
  const attacker = { ...dispatcher, role: 'DRIVER' as const, assignedVehicle: trip.vehicleId }
  const q: QueuedEvent = { id: 'cross-depot', at: Date.now(), actor: 'DRIVER', status: 'pending', event: { type: 'ARRIVE', tripId: trip.id, orderId: foreign[0].id } }
  assert.equal((await op.events(attacker, [q]))[0].status, 'rejected')
})
