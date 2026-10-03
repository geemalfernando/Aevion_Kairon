import crypto from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { config } from './config'
import { profile, type Session } from './auth'
import { rdsPool, rdsTransaction } from './rds'
import type { Identity } from './rds'

const scrypt = (password:string,salt:string) => new Promise<Buffer>((resolve,reject)=>crypto.scrypt(password,salt,64,options,(error,key)=>error?reject(error):resolve(key)))
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
const key = () => new TextEncoder().encode(config.authSecret)
export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(32).toString('hex')
  const derived = await scrypt(password, salt)
  return `scrypt-v1$${salt}$${derived.toString('hex')}`
}
export async function checkPassword(password: string, encoded: string) {
  const [version, salt, hash, extra] = encoded.split('$')
  if (version !== 'scrypt-v1' || !/^[a-f0-9]{64}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(hash ?? '') || extra) { await scrypt(password,'0'.repeat(64)); return false }
  const derived = await scrypt(password, salt)
  return crypto.timingSafeEqual(derived, Buffer.from(hash, 'hex'))
}
const dummyHash = `scrypt-v1$${'0'.repeat(64)}$${'0'.repeat(128)}`
async function issue(user: Identity, sessionId: string, refreshToken: string) {
  const current = profile(user.email, user.app_metadata)
  if (!current || user.disabled) throw new Error('Invalid administrator-managed identity')
  const exp = Math.floor(Date.now() / 1000) + 900
  const token = await new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(user.id).setIssuer('kairon').setAudience('kairon-api').setIssuedAt().setExpirationTime(exp).sign(key())
  return { user: current, token, refreshToken, expiresAt: exp }
}
export async function login(email: string, password: string) {
  const result = await rdsPool().query<Identity & { password_hash: string }>('select id,email,app_metadata,disabled,email_verified,password_hash from public.kairon_users where email=$1', [email.trim().toLowerCase()])
  const user = result.rows[0]
  const valid = await checkPassword(password, user?.password_hash ?? dummyHash)
  if (!valid || !user || user.disabled || !profile(user.email, user.app_metadata)) return null
  const id = crypto.randomUUID(), refreshToken = crypto.randomBytes(32).toString('base64url')
  await rdsTransaction(async db => {
    const active = await db.query('select id from public.kairon_users where id=$1 and not disabled', [user.id])
    if (!active.rows.length) throw new Error('Account disabled')
    await db.query("insert into public.kairon_sessions(id,user_id,expires_at) values ($1,$2,now()+interval '30 days')", [id,user.id])
    await db.query('insert into public.kairon_refresh_tokens(token_hash,session_id) values ($1,$2)', [hashToken(refreshToken),id])
  })
  return issue(user,id,refreshToken)
}
export async function verifyToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null
  let claims
  try { claims = (await jwtVerify(token,key(),{ algorithms:['HS256'],issuer:'kairon',audience:'kairon-api' })).payload } catch { return null }
  if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || !claims.exp || !/^[a-f0-9-]{36}$/i.test(claims.sub) || !/^[a-f0-9-]{36}$/i.test(claims.sid)) return null
  const result = await rdsPool().query<Identity>(`select u.id,u.email,u.app_metadata,u.disabled,u.email_verified from public.kairon_users u
    join public.kairon_sessions s on s.user_id=u.id where u.id=$1 and s.id=$2 and not u.disabled and s.revoked_at is null and s.expires_at>now()`, [claims.sub,claims.sid])
  const user=result.rows[0], current=user && profile(user.email,user.app_metadata)
  return current ? {...current,id:user.id,sessionId:claims.sid,exp:claims.exp*1000} : null
}
export async function refreshSession(refreshToken: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) return null
  const next = crypto.randomBytes(32).toString('base64url')
  const result = await rdsTransaction(async db => {
    const found = await db.query<Identity & { session_id:string; used_at:Date|null; revoked_at:Date|null; expires_at:Date }>(`select u.id,u.email,u.app_metadata,u.disabled,u.email_verified,t.used_at,s.id session_id,s.revoked_at,s.expires_at
      from public.kairon_refresh_tokens t join public.kairon_sessions s on s.id=t.session_id join public.kairon_users u on u.id=s.user_id
      where t.token_hash=$1 for update of s,t`,[hashToken(refreshToken)])
    const row=found.rows[0]
    if (!row) return null
    if (row.used_at) { await db.query('update public.kairon_sessions set revoked_at=now() where id=$1',[row.session_id]); return null }
    if (row.revoked_at || row.expires_at.getTime()<=Date.now() || row.disabled || !profile(row.email,row.app_metadata)) return null
    await db.query('update public.kairon_refresh_tokens set used_at=now() where token_hash=$1',[hashToken(refreshToken)])
    await db.query('insert into public.kairon_refresh_tokens(token_hash,session_id) values ($1,$2)',[hashToken(next),row.session_id])
    return row
  })
  return result ? issue(result,result.session_id,next) : null
}
export async function logout(token: string) {
  const session=await verifyToken(token)
  if (session?.sessionId) await rdsPool().query('update public.kairon_sessions set revoked_at=now() where id=$1',[session.sessionId])
}
