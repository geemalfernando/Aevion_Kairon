import { readFileSync } from 'node:fs'
import { profile } from '../src/auth'
import { config } from '../src/config'
import { supabaseAdmin } from '../src/supabase'
import { contacts, encrypt, securityAudit } from '../src/notifications/store'

// The operator must independently verify ownership and consent. Read the number from stdin, never command history.
const [id, confirmation] = process.argv.slice(2)
if (!id || confirmation !== '--verified' || !/^[a-f0-9-]{36}$/i.test(id) || !/^[a-f0-9]{64}$/i.test(config.notificationEncryptionKey)) throw new Error('Usage: set-notification-phone <user-uuid> --verified (E.164 phone on stdin; configure NOTIFICATION_ENCRYPTION_KEY)')
const phone = readFileSync(0, 'utf8').trim()
if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Use an E.164 phone number')
const db = supabaseAdmin()
const { data, error } = await db.auth.admin.getUserById(id)
if (error) throw new Error('User lookup failed')
const user = profile(data.user.email, data.user.app_metadata)
if (!user) throw new Error('User needs an administrator-managed Kairon profile')
await contacts({ ...user, id, exp: Date.now() + 60000 })
const { error: saveError } = await db.from('kairon_contacts').update({ encrypted_phone: encrypt(phone) }).eq('user_id', id)
if (saveError) throw new Error('Verified phone could not be saved')
await securityAudit('phone_verified', id)
console.log(`Verified phone stored for ${id}. The user must enable SMS in Profile before any SMS is sent.`)
