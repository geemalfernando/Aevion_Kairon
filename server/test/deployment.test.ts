import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config, validateDeployment } from '../src/config'
import { buildApp } from '../src/app'

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
