import type { Notification } from '@core/types'
import type { Preferences } from './store'
import type { Channel } from './store'
import { config } from '../config'
import { rdsIdentity, rdsPool } from '../rds'
import { supabaseAdmin } from '../supabase'

const hosted = () => supabaseAdmin()
const rds = () => config.backend === 'rds'
export interface Contact { user_id:string; preferences:Preferences; encrypted_phone:string|null; suppressed_email:boolean }
export interface Device { id:string; kind:'web'|'fcm'; encrypted_subscription:string }
export async function readOutbox(id:string):Promise<{payload:Notification;expires_at:string}|null> {
  if(rds()) { const q=await rdsPool().query('select payload,expires_at::text from public.kairon_notification_outbox where id=$1',[id]);return q.rows[0]??null }
  const {data,error}=await hosted().from('kairon_notification_outbox').select('payload,expires_at').eq('id',id).maybeSingle(); if(error) throw error; return data
}
export async function recipients(depot:string,roles:string[],offset:number):Promise<Contact[]> {
  if(rds()) return (await rdsPool().query('select user_id,preferences,encrypted_phone,suppressed_email from public.kairon_contacts where depot=$1 and role=any($2) order by user_id offset $3 limit 100',[depot,roles,offset])).rows
  const {data,error}=await hosted().from('kairon_contacts').select('*').eq('depot',depot).in('role',roles).order('user_id').range(offset,offset+99);if(error) throw error;return data??[]
}
export async function identity(id:string) {
  if(rds()) { const u=await rdsIdentity(id);return u && !u.disabled ? {email:u.email,app_metadata:u.app_metadata,email_confirmed_at:u.email_verified?'verified':null}:null }
  const {data,error}=await hosted().auth.admin.getUserById(id);if(error) {if(error.status===404)return null;throw error}
  return data.user && !(data.user.banned_until && Date.parse(data.user.banned_until)>Date.now()) ? data.user : null
}
export async function claimDelivery(id:string,notification:string,recipient:string,channel:Channel,owner:string) {
  if(rds()) return (await rdsPool().query('select public.kairon_claim_delivery($1,$2,$3,$4,$5) claimed',[id,notification,recipient,channel,owner])).rows[0].claimed===true
  const {data,error}=await hosted().rpc('kairon_claim_delivery',{delivery_id:id,notification,recipient,delivery_channel:channel,owner});if(error)throw error;return data===true
}
export async function deliveryStatus(id:string):Promise<string|null> {
  if(rds()) return (await rdsPool().query('select status from public.kairon_notification_deliveries where id=$1',[id])).rows[0]?.status??null
  const {data,error}=await hosted().from('kairon_notification_deliveries').select('status').eq('id',id).maybeSingle();if(error)throw error;return data?.status??null
}
export async function finishDelivery(id:string,owner:string,status:string,code?:string) {
  if(rds()) { const r=await rdsPool().query('update public.kairon_notification_deliveries set status=$1,provider_id=$2,error_code=$3,lease_until=null,lease_owner=null,updated_at=now() where id=$4 and lease_owner=$5 returning id',[status,status==='sent'?code:null,status!=='sent'?code:null,id,owner]);if(!r.rowCount)throw new Error('DeliveryAcknowledgementFailed');return }
  const {data,error}=await hosted().from('kairon_notification_deliveries').update({status,provider_id:status==='sent'?code:null,error_code:status!=='sent'?code:null,lease_until:null,lease_owner:null,updated_at:new Date().toISOString()}).eq('id',id).eq('lease_owner',owner).select('id');if(error||!data?.length)throw new Error('DeliveryAcknowledgementFailed')
}
export async function devices(userId:string):Promise<Device[]> {
  if(rds()) return (await rdsPool().query('select id,kind,encrypted_subscription from public.kairon_push_devices where user_id=$1',[userId])).rows
  const {data,error}=await hosted().from('kairon_push_devices').select('*').eq('user_id',userId);if(error)throw error;return data??[]
}
export async function removeDevice(userId:string,id?:string) {
  if(rds()) {await rdsPool().query('delete from public.kairon_push_devices where user_id=$1'+(id?' and id=$2':''),id?[userId,id]:[userId]);return}
  let q=hosted().from('kairon_push_devices').delete().eq('user_id',userId);if(id)q=q.eq('id',id);const {error}=await q;if(error)throw error
}
export async function suppressEmail(email:string) {
  if(rds()) {await rdsPool().query('update public.kairon_contacts set suppressed_email=true where lower(email)=lower($1)',[email]);return}
  const {error}=await hosted().from('kairon_contacts').update({suppressed_email:true}).ilike('email',email.replace(/[%_]/g,'\\$&'));if(error)throw error
}
export async function claimOutbox(owner:string):Promise<{id:string}[]> {
  if(rds()) return (await rdsPool().query('select id from public.kairon_claim_outbox($1,$2)',[owner,10])).rows
  const {data,error}=await hosted().rpc('kairon_claim_outbox',{owner,batch_size:10});if(error)throw error;return data??[]
}
export async function ackOutbox(id:string,owner:string) {
  if(rds()) {await rdsPool().query('update public.kairon_notification_outbox set published_at=now(),lease_until=null,lease_owner=null where id=$1 and lease_owner=$2',[id,owner]);return}
  const {error}=await hosted().from('kairon_notification_outbox').update({published_at:new Date().toISOString(),lease_until:null,lease_owner:null}).eq('id',id).eq('lease_owner',owner);if(error)throw error
}
export async function hasVerifiedPhone(id:string) {
  if(rds()) return !!(await rdsPool().query('select encrypted_phone from public.kairon_contacts where user_id=$1',[id])).rows[0]?.encrypted_phone
  const {data,error}=await hosted().from('kairon_contacts').select('encrypted_phone').eq('user_id',id).maybeSingle();if(error)throw error;return !!data?.encrypted_phone
}
export async function setVerifiedPhone(id:string,encrypted:string) {
  if(rds()) {await rdsPool().query('update public.kairon_contacts set encrypted_phone=$1 where user_id=$2',[encrypted,id]);return}
  const {error}=await hosted().from('kairon_contacts').update({encrypted_phone:encrypted}).eq('user_id',id);if(error)throw error
}
