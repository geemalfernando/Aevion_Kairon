/**
 * Four-role walkthrough against a running demo stack (DEMO_MODE=true, SEED_DEMO_DAY=true, local accounts), for example
 * `docker compose up`, then:
 *   npm run test:walkthrough          (API_URL defaults to http://localhost:8080)
 * Walks the delivery story across all four roles and checks the rules the API must enforce. It resets the demo first.
 * For a read-only check of a deployed instance with real accounts, use test/api.smoke.ts instead.
 */
import assert from 'node:assert/strict'

const API = process.env.API_URL ?? 'http://localhost:8080'
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(path: string, token?: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<{ status: number; json: Json }> {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Json }
}
const login = async (email: string) => (await call('/api/auth/login', undefined, { email, password: 'kairon-demo' })).json.token as string
const cmd = (token: string, name: string, ...args: unknown[]) => call(`/api/commands/${name}`, token, { args })
let n = 0
const ev = (event: Json, at = Date.now()) => ({ id: `smoke-${Date.now()}-${n++}`, at, actor: 'X', event, status: 'pending' })
const step = (s: string) => console.log(`✓ ${s}`)

const health = await call('/api/health')
assert.equal(health.status, 200, `health: ${JSON.stringify(health.json)}`)
step(`health · data sources ${JSON.stringify(health.json.dataSources)}`)

assert.equal((await call('/api/auth/login', undefined, { email: 'dispatcher@kairon.demo', password: 'wrong' })).status, 401, 'wrong password must be refused')
assert.equal((await call('/api/state')).status, 401, 'anonymous state must be refused')
step('bad password and anonymous access are refused')

const D = await login('dispatcher@kairon.demo')
const L = await login('loader@kairon.demo')
const R = await login('driver@kairon.demo')
const S = await login('store@kairon.demo')
await call('/api/demo/reset', D, {})
step('four seeded accounts sign in; demo reset')

assert.equal((await cmd(S, 'generatePlan')).status, 403, 'store must not plan')
assert.equal((await cmd(S, 'createOrder', 'OUT001', [{ name: 'Dairy', unit: 'crates', qty: 2 }], '')).status, 403, 'store must not order for another outlet')
step('role and outlet scoping enforced (store cannot plan, cannot order for another outlet)')

let r = await cmd(S, 'createOrder', 'OUT032', [{ name: 'Dairy', unit: 'crates', qty: 3 }, { name: 'Produce', unit: 'crates', qty: 2 }], 'extra for weekend')
assert.equal(r.status, 200, `createOrder: ${JSON.stringify(r.json)}`)
assert.equal(r.json.result.ids.length, 2, 'Fresh basket splits into chilled + dry orders')
step(`store order split into ${r.json.result.ids.join(' + ')} for ${r.json.result.deliveryDate}`)

await cmd(D, 'closeOrders')
r = await cmd(D, 'generatePlan')
assert.equal(r.status, 200, `generatePlan: ${JSON.stringify(r.json).slice(0, 300)}`)
const plan = r.json.result
assert.ok(plan.deferred > 0, 'a normal day defers something')
step(`plan: ${plan.served} served, ${plan.deferred} deferred, binding resource ${plan.binding}`)
let d = r.json.data
const veh014 = d.trips.find((t: Json) => t.vehicleId === 'VEH014')
assert.ok(veh014, 'VEH014 story trip exists')
await cmd(D, 'publishPlan')
step(`published · VEH014 ${veh014.id} ${veh014.stops.length} stops`)

// Loader: start, count, complete. Duplicate replays are ignored.
const start = ev({ type: 'LOAD_START', tripId: veh014.id })
r = await call('/api/events', L, { events: [start] })
assert.equal(r.json.results[0].status, 'applied', `LOAD_START: ${JSON.stringify(r.json.results)}`)
r = await call('/api/events', L, { events: [start] })
assert.equal(r.json.results[0].status, 'duplicate', `LOAD_START replay: ${JSON.stringify(r.json.results)}`)
step('LOAD_START applied, replay of the same event is a no-op')

d = r.json.data
const counts = veh014.stops.flatMap((id: string) => d.orders.find((o: Json) => o.id === id).items.map((i: Json) => ev({ type: 'LOAD_COUNT', orderId: id, item: i.name, count: i.qty })))
r = await call('/api/events', L, { events: [...counts, ev({ type: 'LOAD_COMPLETE', tripId: veh014.id })] })
assert.equal(r.json.results.at(-1)?.status, 'applied', `LOAD_COMPLETE: ${JSON.stringify(r.json.results?.at(-1))}`)

// Driver may not act on another vehicle; loader may not deliver.
r = await call('/api/events', L, { events: [ev({ type: 'START_ROUTE', tripId: veh014.id })] })
assert.equal(r.json.results[0].status, 'rejected', 'loader must not start a route')
const other = d.trips.find((t: Json) => t.vehicleId !== 'VEH014')
r = await call('/api/events', R, { events: [ev({ type: 'START_ROUTE', tripId: other.id })] })
assert.equal(r.json.results[0].status, 'rejected', 'driver must not start another vehicle')
step('event permissions enforced (loader cannot drive, driver cannot start another vehicle)')

// Driver goes out; records two deliveries offline, while the dispatcher moves stop 4.
await cmd(D, 'setClockMinutes', 5 * 60)
r = await call('/api/events', R, { events: [ev({ type: 'START_ROUTE', tripId: veh014.id })] })
assert.equal(r.json.results[0].status, 'applied', `START_ROUTE: ${JSON.stringify(r.json.results)}`)
const offlineFrom = Date.now()
const [a, b, , fourth] = veh014.stops
const offline = [a, b].flatMap((id: string) => [ev({ type: 'ARRIVE', orderId: id, tripId: veh014.id }), ev({ type: 'DELIVER', orderId: id, tripId: veh014.id, record: { outcome: 'DELIVERED', receiver: 'Staff', offline: true } })])
r = await cmd(D, 'moveStop', fourth, 'VEH031', 'Late-window risk')
assert.equal(r.status, 200, `moveStop: ${JSON.stringify(r.json).slice(0, 300)}`)
assert.equal(r.json.result.ok, true, JSON.stringify(r.json.result))
step(`dispatcher moved ${fourth} to VEH031 mid-route (arrives ~${r.json.result.eta})`)

r = await call('/api/events', R, { events: offline, sync: { offlineFrom, routeChanged: true } })
assert.ok(r.json.results.every((x: Json) => x.status === 'applied'), `offline replay: ${JSON.stringify(r.json.results)}`)
d = r.json.data
assert.equal(d.syncLog[0]?.vehicleId, 'VEH014', `sync report: ${JSON.stringify(d.syncLog[0])}`)
assert.equal(d.syncLog[0].deliveries, 2, `sync report: ${JSON.stringify(d.syncLog[0])}`)
step('offline outbox replayed; dispatcher sync report created')

const change = d.trips.find((t: Json) => t.id === veh014.id).changes.at(-1)
r = await call('/api/events', R, { events: [ev({ type: 'ROUTE_ACK', tripId: veh014.id, changeIds: [change.id] })] })
assert.equal(r.json.results[0].status, 'applied', `ROUTE_ACK: ${JSON.stringify(r.json.results)}`)
step('driver acknowledged the route change')

// Store confirms receipt of a delivered order.
const delivered = r.json.data.orders.find((o: Json) => o.id === a)
r = await cmd(S, 'confirmReceipt', a, { received: 10, condition: 'GOOD', receiver: 'Dilini' })
assert.equal(r.status, delivered.outletId === 'OUT032' ? 200 : 403, `confirmReceipt for ${delivered.outletId}: ${JSON.stringify(r.json)}`)
step(`receipt confirmation scoped to the store's outlet (${delivered.outletId} → ${r.status})`)

const csv = await fetch(`${API}/api/export/allocation.csv`, { headers: { authorization: `Bearer ${D}` } })
assert.ok((await csv.text()).startsWith('scenario,order_ref,outlet_id,decision,vehicle_id,trip_id'))
step('allocation export in the Task 2B shape')

console.log('\nAll API smoke checks passed.')
