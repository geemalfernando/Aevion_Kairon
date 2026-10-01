import crypto from 'node:crypto'
import type { Role, User } from '@core/types'
import { DEMO_PASSWORD, DEMO_USERS } from '@core/users'
import { config } from './config'
import { pool, type Tx } from './db'

export interface Session extends User {
  exp: number
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split('$')
  if (!salt || !hash) return false
  const candidate = crypto.scryptSync(password, salt, 32)
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'))
}

/** Compact signed token: base64url(payload).base64url(hmac). */
export function signToken(user: User): string {
  const payload = b64(JSON.stringify({ ...user, exp: Date.now() + config.tokenTtlHours * 3_600_000 } satisfies Session))
  const sig = crypto.createHmac('sha256', config.authSecret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyToken(token: string | undefined): Session | null {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = crypto.createHmac('sha256', config.authSecret).update(payload).digest('base64url')
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session
    return s.exp > Date.now() ? s : null
  } catch {
    return null
  }
}

export async function seedUsers(c: Tx) {
  for (const u of Object.values(DEMO_USERS)) {
    await c.query(
      `insert into users (email, name, role, depot, assigned_vehicle, assigned_outlet, password_hash) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (email) do update set name = excluded.name, role = excluded.role, depot = excluded.depot, assigned_vehicle = excluded.assigned_vehicle, assigned_outlet = excluded.assigned_outlet`,
      [u.email, u.name, u.role, u.depot, u.assignedVehicle ?? null, u.assignedOutlet ?? null, hashPassword(DEMO_PASSWORD)],
    )
  }
}

export async function login(email: string, password: string): Promise<{ token: string; user: User } | null> {
  const r = await pool.query('select * from users where lower(email) = lower($1)', [email.trim()])
  const row = r.rows[0]
  if (!row || !verifyPassword(password, row.password_hash)) return null
  const user: User = { email: row.email, name: row.name, role: row.role as Role, depot: row.depot, assignedVehicle: row.assigned_vehicle ?? undefined, assignedOutlet: row.assigned_outlet ?? undefined }
  return { token: signToken(user), user }
}
