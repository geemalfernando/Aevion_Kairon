import {createHash} from 'node:crypto'
import type {PoolClient} from 'pg'
import {config} from '../src/config'
export interface Snapshot {format:string;tables:Record<string,Record<string,unknown>[]>;notificationKeyFingerprint?:string}
export async function importSnapshot(db:PoolClient,data:Snapshot) {
  if(data.format!=='kairon-supabase-export-v1') throw new Error('Unsupported import format')
  if ((data.tables.kairon_push_devices?.length || data.tables.kairon_contacts?.some(row=>row.encrypted_phone)) && data.notificationKeyFingerprint!==createHash('sha256').update(config.notificationEncryptionKey).digest('hex')) throw new Error('Encrypted contacts/devices require the original notification encryption key in ContactEncryptionSecret before import')
  const tables=['kairon_users','kairon_state','kairon_events','kairon_media','kairon_contacts','kairon_push_devices','kairon_notification_outbox','kairon_notification_deliveries','kairon_security_audit','kairon_operational_audit']

    await db.query('select pg_advisory_xact_lock(781492)')
    if((await db.query('select 1 from public.kairon_state limit 1')).rowCount || (await db.query('select 1 from public.kairon_users limit 1')).rowCount) throw new Error('Import requires an empty target; refusing to merge operational databases')
    for(const table of tables) for(const row of data.tables[table]??[]) {
      if(table==='kairon_notification_outbox') { row.lease_until=null;row.lease_owner=null;if(Date.parse(String(row.expires_at))>Date.now())row.published_at=null }
      if(table==='kairon_notification_deliveries') { row.lease_until=null;row.lease_owner=null;if(row.status==='sending')row.status='failed' }
      const columns=Object.keys(row)
      if(!columns.length || columns.some(c=>!/^[a-z_]+$/.test(c))) throw new Error('Invalid import column')
      await db.query(`insert into public.${table} (${columns.map(c=>'"'+c+'"').join(',')}) values (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(c=>typeof row[c]==='object' && row[c]!==null?JSON.stringify(row[c]):row[c]))
    }
    await db.query("select setval(pg_get_serial_sequence('public.kairon_security_audit','id'),coalesce((select max(id) from public.kairon_security_audit),1),(select count(*)>0 from public.kairon_security_audit))")
}
