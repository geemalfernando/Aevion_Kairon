import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config'

export function authClient() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env')
  return createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
}
let admin: SupabaseClient | undefined
export function supabaseAdmin() {
  if (!config.supabaseUrl || !config.supabaseSecretKey) throw new Error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY in .env')
  return admin ??= createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } })
}
