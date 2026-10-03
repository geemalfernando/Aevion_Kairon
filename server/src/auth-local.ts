/**
 * Sign-in without Supabase (the local backend, `docker compose up`): seeded role and store-type demo accounts,
 * with HMAC-signed session tokens. Same response shapes as the Supabase sign-in so the web app can't tell them apart.
 */
import crypto from 'node:crypto'
import { DEMO_PASSWORD, DEMO_USERS, STORE_DEMO_EMAILS, storeDemoUsers } from '@core/demo'
import type { User } from '@core/types'
import { config } from './config'
import { loadOps } from './db-postgres'

async function findUser(email: string) {
  const existing = Object.values(DEMO_USERS).find(u => u.email === email)
  if (existing) return existing
  if (!Object.values(STORE_DEMO_EMAILS).includes(email as typeof STORE_DEMO_EMAILS[keyof typeof STORE_DEMO_EMAILS])) return undefined
  const data = await loadOps()
  return data ? storeDemoUsers(data.outlets).find(u => u.email === email) : undefined
}

type Kind = 'access' | 'refresh'
interface Claims { sub: string; typ: Kind; exp: number }

let generated: string | undefined
function secret() {
  if (config.authSecret) return config.authSecret
  if (!generated) {
    generated = crypto.randomBytes(32).toString('hex')
    console.warn('AUTH_SECRET is not set: using a random one, so sessions end when the server restarts')
  }
  return generated
}

const sign = (body: string) => crypto.createHmac('sha256', secret()).update(body).digest('base64url')
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function issue(email: string, typ: Kind, ttlSeconds: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const body = Buffer.from(JSON.stringify({ sub: email, typ, exp } satisfies Claims)).toString('base64url')
  return { token: `${body}.${sign(body)}`, exp }
}

async function read(token: string | undefined, typ: Kind): Promise<{ user: User; exp: number } | null> {
  const [body, sig, extra] = (token ?? '').split('.')
  if (!body || !sig || extra !== undefined || !same(sig, sign(body))) return null
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims
    const user = await findUser(c.sub)
    return user && c.typ === typ && c.exp * 1000 > Date.now() ? { user, exp: c.exp } : null
  } catch {
    return null
  }
}

function session(user: User) {
  const access = issue(user.email, 'access', config.tokenTtlHours * 3600)
  return { user, token: access.token, refreshToken: issue(user.email, 'refresh', 30 * 86400).token, expiresAt: access.exp }
}

export async function login(email: string, password: string) {
  const user = await findUser(email.trim().toLowerCase())
  const ok = same(crypto.createHash('sha256').update(password).digest('hex'), crypto.createHash('sha256').update(DEMO_PASSWORD).digest('hex'))
  return user && ok ? session(user) : null
}

export async function refreshSession(refreshToken: string) {
  const r = await read(refreshToken, 'refresh')
  return r ? session(r.user) : null
}

export async function verifyToken(token: string | undefined) {
  const r = await read(token, 'access')
  return r ? { ...r.user, id: r.user.email, exp: r.exp * 1000 } : null
}
