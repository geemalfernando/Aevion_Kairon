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
  port: Number(env.PORT ?? 8080), host: env.HOST ?? '0.0.0.0',
  supabaseUrl: env.SUPABASE_URL ?? '',
  supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? '',
  supabaseSecretKey: env.SUPABASE_SECRET_KEY ?? '',
  // Only for the self-contained Docker stack (docker compose up); hosted Supabase uses the JWKS URL.
  supabaseJwtSecret: env.SUPABASE_JWT_SECRET ?? '',
  supabaseJwksUrl: env.SUPABASE_JWKS_URL ?? `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  demoMode: false,
  webOrigins: (env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  publicApiUrl: (env.PUBLIC_API_URL ?? '').replace(/\/$/, ''),
  dataDir: env.DATA_DIR ?? path.resolve(here, '../../data'),
  webDist: env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
  logLevel: env.LOG_LEVEL ?? 'info',
  // On Vercel, SSE streams close before the function time limit (300 s) and the client reconnects.
  streamMaxMs: Number(env.STREAM_MAX_MS ?? (env.VERCEL ? 280_000 : 0)),
}
