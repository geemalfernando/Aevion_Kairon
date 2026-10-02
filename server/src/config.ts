import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'

const here = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(path.resolve(here, '../..'), process.env.ENV_FILE ?? '.env')
// On Vercel, settings come from project environment variables; never read (or bundle) a local .env.
if (!process.env.VERCEL && existsSync(envPath)) loadEnvFile(envPath)
const env = process.env
export const config = {
  deploymentEnv: env.DEPLOYMENT_ENV ?? 'development',
  sessionCookieName: 'kairon_refresh',
  mediaSigningKey: env.MEDIA_SIGNING_KEY ?? '',
  redisUrl: env.REDIS_URL ?? '',
  notificationQueueUrl: env.NOTIFICATION_QUEUE_URL ?? '',
  notificationEncryptionKey: env.NOTIFICATION_ENCRYPTION_KEY ?? '',
  webPushEnabled: env.WEB_PUSH_ENABLED === 'true',
  fcmEnabled: env.FCM_ENABLED === 'true',
  firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT ?? '',
  emailEnabled: env.EMAIL_ENABLED === 'true',
  smsEnabled: env.SMS_ENABLED === 'true',
  vapidPublicKey: env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: env.VAPID_SUBJECT ?? '',
  sesFromEmail: env.SES_FROM_EMAIL ?? '',
  sesConfigurationSet: env.SES_CONFIGURATION_SET ?? '',
  sesFeedbackTopicArn: env.SES_FEEDBACK_TOPIC_ARN ?? '',
  smsSenderId: env.SMS_SENDER_ID ?? '',
  notificationPollMs: Number(env.NOTIFICATION_POLL_MS ?? 5000),
  // Set the exact proxy hop count for a private API behind a load balancer. Direct connections trust none.
  trustProxy: Number(env.TRUST_PROXY_HOPS ?? 0),
  port: Number(env.PORT ?? 8080), host: env.HOST ?? '0.0.0.0',
  supabaseUrl: env.SUPABASE_URL ?? '',
  supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? '',
  supabaseSecretKey: env.SUPABASE_SECRET_KEY ?? '',
  supabaseJwksUrl: env.SUPABASE_JWKS_URL ?? `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  /**
   * Storage and sign-in. With SUPABASE_URL set: Supabase (the hosted deployment). Without it: a local PostgreSQL at
   * DATABASE_URL and the four local demo accounts, which is how `docker compose up` runs with no external service.
   */
  backend: (env.SUPABASE_URL ? 'supabase' : 'postgres') as 'supabase' | 'postgres',
  databaseUrl: env.DATABASE_URL ?? '',
  /** Signs local session tokens (local backend only). Use a long random value outside local demos. */
  authSecret: env.AUTH_SECRET ?? '',
  tokenTtlHours: Number(env.TOKEN_TTL_HOURS ?? 12),
  /** Demo controls for judges: operation clock, fleet simulation and demo reset. Off unless DEMO_MODE=true. */
  demoMode: env.DEMO_MODE === 'true',
  /** Seed one realistic delivery day (demo network or DATA_DIR CSVs) when the store is empty or reset. */
  seedDemoDay: env.SEED_DEMO_DAY === 'true',
  webOrigins: (env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  publicApiUrl: (env.PUBLIC_API_URL ?? '').replace(/\/$/, ''),
  dataDir: env.DATA_DIR ?? path.resolve(here, '../../data'),
  webDist: env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
  logLevel: env.LOG_LEVEL ?? 'info',
  // On Vercel, SSE streams close before the function time limit (300 s) and the client reconnects.
  streamMaxMs: Number(env.STREAM_MAX_MS ?? (env.VERCEL ? 280_000 : 0)),
}

/** Fail closed before a hosted service can expose the local demo authenticator. */
export function validateDeployment(c = config) {
  if (!Number.isInteger(c.trustProxy) || c.trustProxy < 0) throw new Error('TRUST_PROXY_HOPS must be a non-negative integer')
  if (!['staging', 'production'].includes(c.deploymentEnv)) return
  if (c.demoMode || c.seedDemoDay) throw new Error('Hosted deployments must disable DEMO_MODE and SEED_DEMO_DAY')
  if (c.backend !== 'supabase') throw new Error('Hosted deployments require Supabase Auth; PostgreSQL-only authentication is demo-only')
  if (!c.supabasePublishableKey || !c.supabaseSecretKey) throw new Error('Hosted deployments require Supabase keys')
  if (c.mediaSigningKey.length < 32) throw new Error('Hosted deployments require MEDIA_SIGNING_KEY of at least 32 characters')
  const secure = (value: string) => { try { return new URL(value).protocol === 'https:' } catch { return false } }
  if (!secure(c.supabaseUrl) || !secure(c.supabaseJwksUrl)) throw new Error('Supabase URLs must use HTTPS')
  if (!c.webOrigins.length || c.webOrigins.some((origin) => origin !== 'capacitor://localhost' && (!secure(origin) || new URL(origin).origin !== origin))) throw new Error('WEB_ORIGIN must contain explicit HTTPS origins (or capacitor://localhost for iOS)')
  if (c.publicApiUrl && !secure(c.publicApiUrl)) throw new Error('PUBLIC_API_URL must use HTTPS')
  if (c.deploymentEnv === 'production' && !c.redisUrl.startsWith('rediss://')) throw new Error('Production requires a TLS Redis URL for distributed rate limiting')
  if (c.webPushEnabled || c.fcmEnabled || c.emailEnabled || c.smsEnabled) {
    if (!/^[a-f0-9]{64}$/i.test(c.notificationEncryptionKey)) throw new Error('Notifications require a 32-byte hex encryption key')
    if (!c.notificationQueueUrl || !c.publicApiUrl) throw new Error('Notifications require a queue and PUBLIC_API_URL')
    if (c.webPushEnabled && (!c.vapidPublicKey || !c.vapidPrivateKey || !c.vapidSubject)) throw new Error('Web push requires VAPID credentials')
    if (c.fcmEnabled && !c.firebaseServiceAccount) throw new Error('Native push requires a Firebase service account')
    if (c.emailEnabled && (!c.sesFromEmail || !c.sesConfigurationSet || !c.sesFeedbackTopicArn)) throw new Error('Email requires a verified SES sender, configuration set and feedback topic')
  }
}
