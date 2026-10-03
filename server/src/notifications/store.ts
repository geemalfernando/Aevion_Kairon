import crypto from 'node:crypto'
import { config } from '../config'
import { rdsPool } from '../rds'
import { supabaseAdmin } from '../supabase'
import type { Session } from '../auth'

export type Channel = 'push' | 'email' | 'sms'
export interface Preferences { push: boolean; email: boolean; sms: boolean; criticalOnly: boolean }
export const defaultPreferences: Preferences = { push: false, email: false, sms: false, criticalOnly: false }
export function encrypt(value: unknown): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(config.notificationEncryptionKey, 'hex'), iv)
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64')
}
export function decrypt<T>(value: string): T {
  const bytes = Buffer.from(value, 'base64')
  const cipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.notificationEncryptionKey, 'hex'), bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as T
}
export async function contacts(user: Session, changes?: Partial<Preferences>) {
  if (config.backend === 'rds') {
    await rdsPool().query(`insert into public.kairon_contacts(user_id,email,role,depot,assigned_vehicle,assigned_outlet) values ($1,$2,$3,$4,$5,$6)
      on conflict(user_id) do update set email=excluded.email,role=excluded.role,depot=excluded.depot,assigned_vehicle=excluded.assigned_vehicle,assigned_outlet=excluded.assigned_outlet`,[user.id,user.email,user.role,user.depot,user.assignedVehicle??null,user.assignedOutlet??null])
    if (changes) await rdsPool().query('update public.kairon_contacts set preferences=$1 where user_id=$2',[JSON.stringify(changes),user.id])
    return (await rdsPool().query('select preferences from public.kairon_contacts where user_id=$1',[user.id])).rows[0].preferences as Preferences
  }
  if (config.backend !== 'supabase') return defaultPreferences
  const db = supabaseAdmin()
  const { error: identityError } = await db.from('kairon_contacts').upsert({ user_id: user.id, email: user.email, role: user.role, depot: user.depot, assigned_vehicle: user.assignedVehicle ?? null, assigned_outlet: user.assignedOutlet ?? null }, { onConflict: 'user_id' })
  if (identityError) throw identityError
  if (changes) {
    const { error } = await db.from('kairon_contacts').update({ preferences: changes }).eq('user_id', user.id)
    if (error) throw error
  }
  const { data, error } = await db.from('kairon_contacts').select('preferences').eq('user_id', user.id).single()
  if (error) throw error
  return data.preferences as Preferences
}
export interface Subscription { endpoint: string; keys: { p256dh: string; auth: string } }
export function validateSubscription(value: unknown): Subscription {
  const s = value as Subscription
  if (!s || typeof s.endpoint !== 'string' || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') throw Object.assign(new Error('Invalid push subscription'), { statusCode: 400 })
  let url: URL
  try { url = new URL(s.endpoint) } catch { throw Object.assign(new Error('Invalid push endpoint'), { statusCode: 400 }) }
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || (!allowed.includes(url.hostname) && !/^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)) || s.endpoint.length > 2048) throw Object.assign(new Error('Unsupported push provider'), { statusCode: 400 })
  if (!/^[A-Za-z0-9_-]+$/.test(s.keys.p256dh) || Buffer.from(s.keys.p256dh, 'base64url').length !== 65 || !/^[A-Za-z0-9_-]+$/.test(s.keys.auth) || Buffer.from(s.keys.auth, 'base64url').length !== 16) throw Object.assign(new Error('Invalid push keys'), { statusCode: 400 })
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }
}
export const subscriptionId = (endpoint: string) => crypto.createHash('sha256').update(endpoint).digest('hex')
export async function registerPush(user: Session, value: unknown) {
  const subscription = validateSubscription(value)
  await contacts(user)
  if (config.backend === 'rds') { await saveRdsDevice(user.id,subscriptionId(subscription.endpoint),'web',encrypt(subscription)); return }
  const { error } = await supabaseAdmin().from('kairon_push_devices').upsert({ id: subscriptionId(subscription.endpoint), user_id: user.id, kind: 'web', encrypted_subscription: encrypt(subscription), updated_at: new Date().toISOString() })
  if (error) throw error
}
export async function registerNativePush(user: Session, token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_:.-]{20,4096}$/.test(token)) throw Object.assign(new Error('Invalid FCM token'), { statusCode: 400 })
  await contacts(user)
  if (config.backend === 'rds') { await saveRdsDevice(user.id,subscriptionId(`fcm:${token}`),'fcm',encrypt({token})); return }
  const { error } = await supabaseAdmin().from('kairon_push_devices').upsert({ id: subscriptionId(`fcm:${token}`), user_id: user.id, kind: 'fcm', encrypted_subscription: encrypt({ token }), updated_at: new Date().toISOString() })
  if (error) throw error
}
export async function securityAudit(action: string, userId?: string, outcome = 'success') {
  if (config.backend === 'rds') { await rdsPool().query('insert into public.kairon_security_audit(action,user_id,outcome) values ($1,$2,$3)',[action,userId??null,outcome]); return }
  if (config.backend !== 'supabase') return
  const { error } = await supabaseAdmin().from('kairon_security_audit').insert({ action, user_id: userId ?? null, outcome })
  if (error) throw new Error('Security audit could not be saved')
}

async function saveRdsDevice(userId:string,id:string,kind:string,encrypted:string) {
  await rdsPool().query(`insert into public.kairon_push_devices(id,user_id,kind,encrypted_subscription) values ($1,$2,$3,$4)
    on conflict(id) do update set user_id=excluded.user_id,kind=excluded.kind,encrypted_subscription=excluded.encrypted_subscription,updated_at=now()`,[id,userId,kind,encrypted])
}
