import { mkdirSync,writeFileSync,chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { config } from '../src/config'
import { supabaseAdmin } from '../src/supabase'

const output=process.argv[2]
if(!output || !output.startsWith('artifacts/')) throw new Error('Use an ignored artifacts/ output path from repository root')
const db=supabaseAdmin(), tables:Record<string,unknown[]>={}
for(const table of ['kairon_state','kairon_events','kairon_media','kairon_contacts','kairon_push_devices','kairon_notification_outbox','kairon_notification_deliveries','kairon_security_audit','kairon_operational_audit']) {
  const rows=[]
  const order=table==='kairon_contacts'?'user_id':'id'
  for(let offset=0;;offset+=500) {
    const {data,error}=await db.from(table).select('*').order(order).range(offset,offset+499)
    if(error) {if(error.code==='PGRST205' && offset===0 && !['kairon_state','kairon_events','kairon_media'].includes(table))break;throw new Error('Export failed for '+table)}
    rows.push(...data);if(data.length<500)break
  }
  tables[table]=rows
}
const users=[]
for(let page=1;;page++) {
  const {data,error}=await db.auth.admin.listUsers({page,perPage:100});if(error)throw new Error('Identity export failed')
  for(const u of data.users) {
    const { profile }=await import('../src/auth')
    if(!profile(u.email,u.app_metadata))continue
    users.push({id:u.id,email:u.email!.toLowerCase(),app_metadata:u.app_metadata,password_hash:'reset-required',disabled:!!u.banned_until && Date.parse(u.banned_until)>Date.now(),email_verified:!!u.email_confirmed_at})
  }
  if(data.users.length<100)break
}
tables.kairon_users=users
const {data:latest,error:latestError}=await db.from('kairon_state').select('version').eq('id',1).maybeSingle()
if(latestError || latest?.version!==(tables.kairon_state[0] as {version?:number}|undefined)?.version) throw new Error('Source operation changed during export; pause source writes and retry')
if(!tables.kairon_operational_audit.length){const state=tables.kairon_state[0] as {data?:{audit?:{id:string}[]}}|undefined;tables.kairon_operational_audit=state?.data?.audit?.map(row=>({id:row.id,data:row}))??[]}

mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true})
writeFileSync(output,JSON.stringify({format:'kairon-supabase-export-v1',tables,notificationKeyFingerprint:config.notificationEncryptionKey?createHash('sha256').update(config.notificationEncryptionKey).digest('hex'):null}),{mode:0o600});chmodSync(output,0o600)
console.log('Export saved to ignored file. Imported users require new RDS passwords; no sessions are exported.')
