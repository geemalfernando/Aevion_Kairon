/** Preserve credentials, flags and extra metadata while aligning the hosted judge accounts with STORY. */
import type { PoolClient } from 'pg'
import { DEMO_USERS, STORY } from '@core/demo'
import { config } from '../src/config'
import { closeRds, rdsTransaction } from '../src/rds'

export async function repairJudgeAccounts(db: PoolClient, apply = false) {
  const patches = [
    { email: 'driver@kairon.example', role: 'DRIVER', metadata: { assignedVehicle: STORY.vehicle, name: DEMO_USERS.DRIVER.name } },
    { email: 'store@kairon.example', role: 'STORE_MANAGER', metadata: { assignedOutlet: STORY.store, name: DEMO_USERS.STORE_MANAGER.name } },
    { email: 'dispatcher@kairon.example', role: 'DISPATCHER', metadata: { name: DEMO_USERS.DISPATCHER.name } },
    { email: 'loader@kairon.example', role: 'LOADER', metadata: { name: DEMO_USERS.LOADER.name } },
  ]
  await db.query('select pg_advisory_xact_lock(781493)')
  const { rows: before } = await db.query('select email,app_metadata,email_verified,disabled from public.kairon_users where email=any($1) order by email for update', [patches.map(p => p.email)])
  if (before.length !== patches.length) throw new Error('All four existing judge accounts must be present')
  for (const patch of patches) {
    const row = before.find(r => r.email === patch.email)
    if (row.app_metadata.role !== patch.role || row.app_metadata.depot !== 'Peliyagoda') throw new Error(`Unexpected role or depot: ${patch.email}`)
  }
  if (!apply) return { before }
  const data = (await db.query('select data from public.kairon_state where id=1')).rows[0]?.data
  if (!data?.vehicles?.some((v: { id: string; depot: string }) => v.id === STORY.vehicle && v.depot === 'Peliyagoda') || !data?.outlets?.some((o: { id: string; brand: string; depot: string }) => o.id === STORY.store && o.brand === 'Fresh' && o.depot === 'Peliyagoda')) throw new Error('Story vehicle/outlet is missing or in the wrong depot')
  for (const patch of patches) {
    const current = before.find(r => r.email === patch.email).app_metadata
    if (Object.entries(patch.metadata).every(([key, value]) => current[key] === value)) continue
    await db.query('update public.kairon_users set app_metadata=app_metadata || $2::jsonb where email=$1', [patch.email, JSON.stringify(patch.metadata)])
    await db.query('update public.kairon_sessions set revoked_at=now() where user_id=(select id from public.kairon_users where email=$1)', [patch.email])
  }
  const { rows: after } = await db.query('select email,app_metadata,email_verified,disabled from public.kairon_users where email=any($1) order by email', [patches.map(p => p.email)])
  return { before, after }
}

if (process.argv[1]?.endsWith('repair-judge-accounts.ts')) {
  if (config.backend !== 'rds' || config.deploymentEnv !== 'staging') throw new Error('Judge account repair requires RDS staging')
  try { console.log(JSON.stringify(await rdsTransaction(db => repairJudgeAccounts(db, process.argv.includes('--apply'))), null, 2)) }
  finally { await closeRds() }
}
