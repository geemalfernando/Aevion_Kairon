import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { supabaseAdmin } from '../src/supabase'
import { profile } from '../src/auth'

interface Seed { role: string; name: string; emailEnv: string; passwordEnv: string; depotEnv: string; vehicleEnv?: string; outletEnv?: string }
const seeds = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../seeds/users.json', import.meta.url)), 'utf8')) as Seed[]
const missing = seeds.flatMap((s) => [s.emailEnv, s.passwordEnv, s.depotEnv])
  .filter((key): key is string => !!key && !process.env[key]?.trim())
if (missing.length) {
  console.error('User seed configuration is incomplete. No accounts were created.')
  console.error('Fill these settings in the repository-root .env file:')
  for (const key of missing) console.error(`  ${key}=`)
  console.error('Use distinct real emails, passwords of at least 10 characters, and a depot. Vehicle/outlet assignments can be added after importing data. Then rerun npm --prefix server run seed:users.')
  process.exit(1)
}
const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Set ${key} in .env`); return value }
// Validate the entire manifest before creating any accounts.
const accounts = seeds.map((s) => {
  const email = required(s.emailEnv).trim().toLowerCase()
  const password = required(s.passwordEnv)
  const metadata = { name: s.name, role: s.role, depot: required(s.depotEnv), assignedVehicle: s.vehicleEnv ? process.env[s.vehicleEnv]?.trim() || undefined : undefined, assignedOutlet: s.outletEnv ? process.env[s.outletEnv]?.trim() || undefined : undefined }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !profile(email, metadata)) throw new Error(`Invalid user configuration for ${s.role}`)
  if (password.length < 10) throw new Error(`${s.passwordEnv} must contain at least 10 characters`)
  return { email, password, metadata }
})
if (new Set(accounts.map((a) => a.email)).size !== accounts.length) throw new Error('Each role needs a distinct email')
const admin = supabaseAdmin()
const users = new Map<string, string>()
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
  if (error) throw error
  for (const user of data.users) if (user.email) users.set(user.email.toLowerCase(), user.id)
  if (data.users.length < 100) break
}
for (const { email, password, metadata } of accounts) {
  // Existing accounts are deliberately left unchanged: re-running cannot reset a password or grant a new role.
  if (users.has(email)) { console.log(`Already exists: ${metadata.role}`); continue }
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: metadata })
  if (error) throw error
  console.log(`Created ${metadata.role}`)
}
