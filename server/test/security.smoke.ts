import assert from 'node:assert/strict'
import { DEMO_USERS, DEMO_PASSWORD } from '@core/demo'

// Requires the disposable local Compose stack. Never run this login-rate test against production.
const root = process.env.API_URL ?? 'http://localhost:18089'
const origin = new URL(root).origin
assert.ok(['localhost', '127.0.0.1'].includes(new URL(root).hostname), 'Security smoke test only runs against a local stack')
const headers = { 'content-type': 'application/json', origin, 'x-session-mode': 'cookie' }
const login = await fetch(`${root}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email: DEMO_USERS.STORE_MANAGER.email, password: DEMO_PASSWORD }) })
assert.equal(login.status, 200)
const cookie = login.headers.get('set-cookie')!
assert.match(cookie, /HttpOnly/i)
assert.match(cookie, /SameSite=Strict/i)
const store = await login.json() as { token: string; refreshToken: null; user: { assignedOutlet: string } }
assert.equal(store.refreshToken, null)
const stored = await fetch(`${root}/api/state`, { headers: { authorization: `Bearer ${store.token}` } })
const state = await stored.json() as { data: { orders: { outletId: string }[]; outlets: { id: string }[] } }
assert.ok(state.data.orders.every((o) => o.outletId === store.user.assignedOutlet))
assert.deepEqual(state.data.outlets.map((o) => o.id), [store.user.assignedOutlet])
assert.equal(stored.headers.get('cache-control'), 'no-store')
const refresh = await fetch(`${root}/api/auth/refresh`, { method: 'POST', headers: { ...headers, cookie: cookie.split(';')[0] }, body: '{}' })
assert.equal(refresh.status, 200)
assert.equal((await refresh.json() as { refreshToken: null }).refreshToken, null)
const untrusted = await fetch(`${root}/api/auth/refresh`, { method: 'POST', headers: { ...headers, origin: 'https://attacker.example', cookie: cookie.split(';')[0] }, body: '{}' })
assert.equal(untrusted.status, 403)
const query = await fetch(`${root}/api/stream?token=${encodeURIComponent(store.token)}`)
assert.equal(query.status, 401, 'Even a valid access token must not work in a URL')
const controller = new AbortController()
const stream = await fetch(`${root}/api/stream`, { headers: { authorization: `Bearer ${store.token}` }, signal: controller.signal })
assert.equal(stream.status, 200)
assert.equal(stream.headers.get('cache-control'), 'no-store, no-transform')
const reader = stream.body!.getReader()
assert.match(new TextDecoder().decode((await reader.read()).value), /event: version/)
controller.abort()
await reader.cancel().catch(() => undefined)
const unsigned = await fetch(`${root}/api/media/${'a'.repeat(32)}`)
assert.equal(unsigned.status, 403)
let last = 0
for (let i = 0; i < 12; i++) {
  last = (await fetch(`${root}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status
}
assert.equal(last, 429, 'Login brute-force limiting did not engage')
console.log('HTTP security smoke passed: cookie sessions, CSRF guard, store isolation, header-only SSE, proof links and login throttling.')
