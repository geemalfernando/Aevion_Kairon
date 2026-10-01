import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const env = process.env

function required(name: string, fallback?: string) {
  const v = env[name] ?? fallback
  if (!v) throw new Error(`Missing required environment variable ${name}`)
  return v
}

export const config = {
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? '0.0.0.0',
  databaseUrl: required('DATABASE_URL', 'postgres://kairon:kairon@localhost:5432/kairon'),
  /** HMAC secret for session tokens. Always set it in production. */
  authSecret: required('AUTH_SECRET', env.NODE_ENV === 'production' ? undefined : 'dev-only-insecure-secret'),
  tokenTtlHours: Number(env.TOKEN_TTL_HOURS ?? 12),
  /** Demo controls (reset, operation clock, fleet simulation) for judges. */
  demoMode: (env.DEMO_MODE ?? 'true') === 'true',
  /** Folder with the competition CSVs (outlets.csv, vehicles.csv, …). Missing files fall back to placeholders. */
  dataDir: env.DATA_DIR ?? path.resolve(here, '../../data'),
  /** Built web app to serve (so one container runs the whole product). */
  webDist: env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
  /** Reseed on every boot (useful for demos). Otherwise the stored operation is kept. */
  reseedOnBoot: env.RESEED_ON_BOOT === 'true',
  logLevel: env.LOG_LEVEL ?? 'info',
}
