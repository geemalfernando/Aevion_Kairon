import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { PoolClient } from 'pg'
import { profile } from '../src/auth'
import { hashPassword } from '../src/auth-rds'
import { rdsTransaction, closeRds } from '../src/rds'

interface Account { email:string; password:string; name:string; role:string; depot:string; assignedVehicle?:string; assignedOutlet?:string; emailVerified?:boolean; disabled?:boolean }
export async function provisionUsers(db:PoolClient,accounts:Account[],update=false) {
  if (!Array.isArray(accounts) || !accounts.length) throw new Error('Provide a nonempty account array')
  const validated=await Promise.all(accounts.map(async account=>{
    const email=account.email?.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !profile(email,{...account}) || typeof account.password!=='string' || account.password.length<10 || account.password.length>1024) throw new Error('Invalid account profile or password (minimum 10 characters)')
    if (account.emailVerified !== undefined && typeof account.emailVerified !== 'boolean' || account.disabled !== undefined && typeof account.disabled !== 'boolean') throw new Error('Invalid account verification/disable flags')
    const metadata={name:account.name,role:account.role,depot:account.depot,assignedVehicle:account.assignedVehicle,assignedOutlet:account.assignedOutlet}
    return {email,passwordHash:await hashPassword(account.password),metadata,verified:account.emailVerified===true,disabled:account.disabled===true}
  }))
  if(new Set(validated.map(a=>a.email)).size!==validated.length) throw new Error('Duplicate account email')
  for(const a of validated) {
    const result=await db.query(`insert into public.kairon_users(id,email,password_hash,app_metadata,email_verified,disabled) values ($1,$2,$3,$4,$5,$6)
      on conflict(email) ${update?'do update set password_hash=excluded.password_hash,app_metadata=excluded.app_metadata,email_verified=excluded.email_verified,disabled=excluded.disabled':'do nothing'} returning id`,[crypto.randomUUID(),a.email,a.passwordHash,JSON.stringify(a.metadata),a.verified,a.disabled])
    if(update && result.rows[0]) await db.query('update public.kairon_sessions set revoked_at=now() where user_id=$1',[result.rows[0].id])
  }
}
// Explicit update resets passwords and revokes all sessions; default creation leaves existing users unchanged.
if (process.argv[1]?.endsWith('rds-users.ts')) {
  await rdsTransaction(db=>provisionUsers(db,JSON.parse(readFileSync(0,'utf8')),process.argv.includes('--update')))
  await closeRds()
  console.log('Administrator-managed users saved. No passwords were displayed.')
}
