/** Read-only smoke check against a running API using configured seed credentials. */
import assert from 'node:assert/strict'
import '../src/config'
const root = process.env.API_URL ?? 'http://localhost:8080'
const get = async (path: string, token?: string) => fetch(root + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })
assert.equal((await get('/api/health')).status, 200)
assert.equal((await get('/api/state')).status, 401)
for (const prefix of ['DISPATCHER', 'LOADER', 'DRIVER', 'STORE']) {
  const email = process.env[`SEED_${prefix}_EMAIL`]
  const password = process.env[`SEED_${prefix}_PASSWORD`]
  assert.ok(email && password, `Configure SEED_${prefix}_EMAIL and SEED_${prefix}_PASSWORD`)
  const response = await fetch(root + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  assert.equal(response.status, 200, `${prefix} login failed`)
  const session = await response.json() as { token: string; user: { role: string } }
  assert.equal(session.user.role, prefix === 'STORE' ? 'STORE_MANAGER' : prefix)
  assert.equal((await get('/api/state', session.token)).status, 200)
  console.log(`${prefix}: authenticated and loaded state`)
}
