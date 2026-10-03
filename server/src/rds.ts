import pg from 'pg'
import { readFileSync } from 'node:fs'
import { config } from './config'

let pool: pg.Pool | undefined
export function rdsPool() {
  if (!pool) pool = new pg.Pool({
    ...(config.databaseUrl ? { connectionString: config.databaseUrl } : { host: config.rdsHost, port: 5432, database: config.rdsDatabase, user: config.rdsUser, password: config.rdsPassword }),
    // RDS requires CA and hostname verification. Test-only local PostgreSQL can explicitly disable TLS.
    ssl: config.rdsTls ? { rejectUnauthorized: true, ca: readFileSync(config.rdsCaFile, 'utf8') } : false,
    max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
  })
  return pool
}
export async function closeRds() { await pool?.end(); pool = undefined }
export async function rdsTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await rdsPool().connect()
  try { await client.query('begin'); const result = await fn(client); await client.query('commit'); return result }
  catch (error) { await client.query('rollback'); throw error }
  finally { client.release() }
}
export interface Identity { id: string; email: string; app_metadata: Record<string, unknown>; disabled: boolean; email_verified: boolean }
export async function rdsIdentity(id: string): Promise<Identity | undefined> {
  const r = await rdsPool().query<Identity>('select id,email,app_metadata,disabled,email_verified from public.kairon_users where id=$1', [id])
  return r.rows[0]
}
