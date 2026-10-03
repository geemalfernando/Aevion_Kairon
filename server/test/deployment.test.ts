import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config, validateDeployment } from '../src/config'
import { buildApp } from '../src/app'

test('startup reseeding is restricted to the local PostgreSQL demo', () => {
  const local = { ...config, deploymentEnv: 'development', backend: 'postgres' as const, demoMode: true, seedDemoDay: true, seedDemoEveryStart: true }
  assert.doesNotThrow(() => validateDeployment(local))
  for (const overrides of [{ deploymentEnv: 'production' }, { backend: 'rds' as const }, { backend: 'supabase' as const }, { demoMode: false }, { seedDemoDay: false }]) {
    assert.throws(() => validateDeployment({ ...local, ...overrides }), /local PostgreSQL demo/)
  }
})

test('hosted deployments reject demo authentication, demo controls and insecure origins', () => {
  const hosted = { ...config, deploymentEnv: 'production', backend: 'supabase' as const, demoMode: false, seedDemoDay: false, supabaseUrl: 'https://example.supabase.co', supabaseJwksUrl: 'https://example.supabase.co/auth/v1/.well-known/jwks.json', supabasePublishableKey: 'test-public', supabaseSecretKey: 'test-secret', webOrigins: ['https://kairon.example'], publicApiUrl: 'https://kairon.example', trustProxy: 1, mediaSigningKey: 'test-signing-key-that-is-long-enough', redisUrl: 'rediss://example.test:6379', webPushEnabled: false, emailEnabled: false, smsEnabled: false }
  assert.doesNotThrow(() => validateDeployment(hosted))
  assert.throws(() => validateDeployment({ ...hosted, backend: 'postgres' }), /demo-only/)
  assert.throws(() => validateDeployment({ ...hosted, demoMode: true }), /disable/)
  assert.throws(() => validateDeployment({ ...hosted, seedDemoDay: true }), /disable/)
  assert.throws(() => validateDeployment({ ...hosted, supabaseSecretKey: '' }), /keys/)
  assert.throws(() => validateDeployment({ ...hosted, webOrigins: ['*'] }), /HTTPS origins/)
  assert.throws(() => validateDeployment({ ...hosted, webOrigins: ['http://localhost:5173'] }), /HTTPS origins/)
  assert.throws(() => validateDeployment({ ...hosted, webOrigins: ['https://kairon.example/path'] }), /HTTPS origins/)
  assert.throws(() => validateDeployment({ ...hosted, trustProxy: -1 }), /non-negative/)
  assert.throws(() => validateDeployment({ ...hosted, redisUrl: '' }), /TLS Redis/)
  assert.throws(() => validateDeployment({ ...hosted, mediaSigningKey: '' }), /MEDIA_SIGNING_KEY/)
})

test('API requires header authentication and prevents sensitive response caching', async () => {
  const { app } = await buildApp()
  try {
    const page = await app.inject({ url: '/login' })
    assert.equal(page.headers['referrer-policy'], 'strict-origin-when-cross-origin')
    assert.match(String(page.headers['content-security-policy']), /img-src[^;]+https:\/\/tile\.openstreetmap\.org/)
    for (const url of ['/api/state', '/api/stream?token=forged']) {
      const response = await app.inject({ url })
      assert.equal(response.statusCode, 401)
      assert.equal(response.headers['cache-control'], 'no-store')
      assert.equal(response.headers['x-content-type-options'], 'nosniff')
      assert.equal(response.headers['referrer-policy'], 'no-referrer')
    }
  } finally {
    await app.close()
  }
})


test('hosted RDS rejects demo auth, plaintext DB connections and connection-string TLS overrides', () => {
  const hosted = { ...config, backend: 'rds' as const, deploymentEnv: 'production', demoMode: false, seedDemoDay: false, databaseUrl: '', rdsHost: 'private.example.rds.amazonaws.com', rdsUser: 'kairon_runtime', rdsPassword: 'test', rdsTls: true, rdsCaFile: '/test/ca.pem', authSecret: 'a'.repeat(64), mediaSigningKey: 'b'.repeat(64), mediaBucket: 'private-test-proof', webOrigins: ['https://example.cloudfront.net'], publicApiUrl: 'https://example.cloudfront.net', redisUrl: 'rediss://example.test:6379', trustProxy: 2, webPushEnabled: false, fcmEnabled: false, emailEnabled: false, smsEnabled: false }
  assert.doesNotThrow(() => validateDeployment(hosted))
  assert.throws(() => validateDeployment({ ...hosted, rdsTls: false }), /verified TLS/)
  assert.throws(() => validateDeployment({ ...hosted, databaseUrl: 'postgres://override/?sslmode=no-verify' }), /cannot override/)
  assert.throws(() => validateDeployment({ ...hosted, authSecret: '' }), /AUTH_SECRET/)
  assert.throws(() => validateDeployment({ ...hosted, mediaBucket: '' }), /MEDIA_BUCKET/)
  const stagingDemo = { ...hosted, deploymentEnv: 'staging', demoMode: true, seedDemoDay: true, stagingDemoControls: true }
  assert.doesNotThrow(() => validateDeployment(stagingDemo))
  assert.throws(() => validateDeployment({ ...stagingDemo, deploymentEnv: 'production' }), /only allowed on RDS staging/)
  assert.throws(() => validateDeployment({ ...stagingDemo, stagingDemoControls: false }), /disable/)
  assert.throws(() => validateDeployment({ ...stagingDemo, seedDemoEveryStart: true }), /local PostgreSQL demo/)
})
