import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { rdsPool, rdsTransaction, closeRds } from '../src/rds'
import { provisionUsers } from './rds-users'
import { importSnapshot, type Snapshot } from './import-rds'
import { config } from '../src/config'

const runtimePassword=process.env.RDS_RUNTIME_PASSWORD
if(!runtimePassword || !/^[A-Za-z0-9]{32,128}$/.test(runtimePassword)) throw new Error('Migration needs the generated runtime password')
await rdsPool().query(readFileSync(fileURLToPath(new URL('../../database/migrations/001_rds.sql',import.meta.url)),'utf8'))
await rdsTransaction(async db=>{
  await db.query("select pg_advisory_xact_lock(781493)")
  await db.query("do $$ begin if not exists(select 1 from pg_roles where rolname='kairon_runtime') then create role kairon_runtime login; end if; end $$")
  // Password is restricted to alphanumerics before interpolation (ALTER ROLE does not accept bind parameters).
  // No NOSUPERUSER: RDS has no superuser, so the role cannot be one, and only a superuser may name that attribute.
  await db.query(`alter role kairon_runtime password '${runtimePassword}' nocreatedb nocreaterole noinherit`)
  await db.query('revoke create on schema public from public; grant usage on schema public to kairon_runtime')
  await db.query('grant select on public.kairon_users,public.kairon_schema_migrations to kairon_runtime')
  await db.query('revoke all on public.kairon_sessions,public.kairon_refresh_tokens,public.kairon_state,public.kairon_events,public.kairon_media,public.kairon_contacts,public.kairon_push_devices,public.kairon_notification_outbox,public.kairon_notification_deliveries,public.kairon_security_audit,public.kairon_operational_audit from kairon_runtime')
  await db.query('grant select,insert,update on public.kairon_sessions,public.kairon_refresh_tokens,public.kairon_state,public.kairon_contacts,public.kairon_notification_outbox,public.kairon_notification_deliveries to kairon_runtime')
  await db.query('grant select,insert,update,delete on public.kairon_push_devices to kairon_runtime')
  await db.query('grant select,insert on public.kairon_events,public.kairon_media,public.kairon_security_audit,public.kairon_operational_audit to kairon_runtime')
  await db.query('grant usage,select on sequence public.kairon_security_audit_id_seq to kairon_runtime')
  for(const signature of ['kairon_commit(bigint,jsonb,jsonb,jsonb)','kairon_commit_state(bigint,jsonb,jsonb,jsonb)','kairon_claim_outbox(text,integer)','kairon_claim_delivery(text,text,text,text,text)']) {
    await db.query(`revoke all on function public.${signature} from public; grant execute on function public.${signature} to kairon_runtime`)
  }
})
if(process.env.RDS_IMPORT_KEY) {
  if(!process.env.RDS_IMPORT_KEY.startsWith('migration/')) throw new Error('Import object must be under migration/')
  const object=await new S3Client({}).send(new GetObjectCommand({Bucket:config.mediaBucket,Key:process.env.RDS_IMPORT_KEY}))
  const data=JSON.parse(await object.Body!.transformToString()) as Snapshot
  await rdsTransaction(db=>importSnapshot(db,data))
}
if(process.env.RDS_INITIAL_USERS) await rdsTransaction(db=>provisionUsers(db,JSON.parse(process.env.RDS_INITIAL_USERS!),process.env.RDS_UPDATE_USERS==='true'))
await closeRds()
console.log('RDS schema, runtime grants and optional user/import setup completed.')
