/** Rename legacy judge emails without replacing identities, credentials or profiles. */
import type { PoolClient } from 'pg'
import { HOSTED_DEMO_USERS } from '@core/demo'
import { config } from '../src/config'
import { closeRds, rdsTransaction } from '../src/rds'

export async function renameDemoEmails(db: PoolClient, apply = false) {
  const mappings = HOSTED_DEMO_USERS.map(user => ({
    oldEmail: user.email.replace('@kairon.demo', '@kairon.example'),
    email: user.email, role: user.role, depot: user.depot,
  }))
  await db.query('select pg_advisory_xact_lock(781493)')
  const emails = mappings.flatMap(m => [m.oldEmail, m.email])
  const { rows: before } = await db.query('select id,email,app_metadata,email_verified,disabled from public.kairon_users where email=any($1) order by email for update', [emails])
  for (const mapping of mappings) {
    const matches = before.filter(row => row.email === mapping.oldEmail || row.email === mapping.email)
    if (!matches.length) throw new Error(`Missing account: ${mapping.email}`)
    for (const row of matches) {
      const profile = row.app_metadata
      if (profile.role !== mapping.role || profile.depot !== mapping.depot) throw new Error(`Unexpected role or depot: ${row.email}`)
    }
  }
  if (!apply) return { before }
  let renamed = 0
  for (const mapping of mappings) {
    // Existing canonical identities retain their own history; never merge or delete accounts.
    if (before.some(row => row.email === mapping.email)) continue
    const row = before.find(row => row.email === mapping.oldEmail)
    if (!row) continue
    await db.query('update public.kairon_users set email=$2 where id=$1', [row.id, mapping.email])
    await db.query('update public.kairon_contacts set email=$2 where user_id=$1', [row.id, mapping.email])
    await db.query('update public.kairon_sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [row.id])
    renamed++
  }
  const { rows: after } = await db.query('select id,email,app_metadata,email_verified,disabled from public.kairon_users where email=any($1) order by email', [emails])
  return { before, after, renamed, retainedLegacyEmails: after.filter(row => row.email.endsWith('@kairon.example')).map(row => row.email) }
}

if (process.argv[1]?.endsWith('rename-demo-emails.ts')) {
  if (config.backend !== 'rds' || config.deploymentEnv !== 'staging') throw new Error('Demo email maintenance requires RDS staging')
  try { console.log(JSON.stringify(await rdsTransaction(db => renameDemoEmails(db, process.argv.includes('--apply'))), null, 2)) }
  finally { await closeRds() }
}
