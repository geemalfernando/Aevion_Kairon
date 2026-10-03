import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import crypto from 'node:crypto'
import {login,refreshSession,verifyToken,logout,hashPassword} from '../src/auth-rds'
import {rdsPool,closeRds} from '../src/rds'
import {persistState,loadOps,loadMedia} from '../src/db-rds'
import {contacts,securityAudit} from '../src/notifications/store'
import {claimOutbox,claimDelivery,finishDelivery} from '../src/notifications/repository'
import {importSnapshot,type Snapshot} from '../scripts/import-rds'
import {provisionUsers} from '../scripts/rds-users'
import {buildApp} from '../src/app'
import {seedOps} from '@core/ops'
const admin=new pg.Pool({connectionString:process.env.KAIRON_TEST_ADMIN_URL})
after(async()=>{await closeRds();await admin.end()})
const metadata={name:'Test driver',role:'DRIVER',depot:'Peliyagoda',assignedVehicle:'vehicle-a'}
async function user(){const id=crypto.randomUUID(),email=id+'@example.test';await admin.query('insert into kairon_users(id,email,password_hash,app_metadata) values ($1,$2,$3,$4)',[id,email,await hashPassword('test-long-password-123'),JSON.stringify(metadata)]);return {id,email}}

test('RDS authentication rotates refresh tokens; replay revokes the entire session',async()=>{
 const u=await user();assert.equal(await login(u.email,'wrong'),null)
 const first=(await login(u.email,'test-long-password-123'))!;assert.ok(await verifyToken(first.token))
 const next=(await refreshSession(first.refreshToken))!;assert.ok(next);assert.notEqual(next.refreshToken,first.refreshToken)
 assert.equal(await refreshSession(first.refreshToken),null)
 assert.equal(await verifyToken(next.token),null);assert.equal(await refreshSession(next.refreshToken),null)
})
test('fresh RDS roles/assignments, account disable and logout apply to already-issued access tokens',async()=>{
 const u=await user(),session=(await login(u.email,'test-long-password-123'))!
 await admin.query('update kairon_users set app_metadata=$1 where id=$2',[JSON.stringify({...metadata,assignedVehicle:'vehicle-b'}),u.id])
 assert.equal((await verifyToken(session.token))?.assignedVehicle,'vehicle-b')
 await admin.query('update kairon_users set disabled=true where id=$1',[u.id]);assert.equal(await verifyToken(session.token),null)
 await admin.query('update kairon_users set disabled=false where id=$1',[u.id]);await logout(session.token);assert.equal(await verifyToken(session.token),null)
})
test('runtime role cannot assign roles, change passwords, create tables or read another schema',async()=>{
 await assert.rejects(rdsPool().query("update kairon_users set password_hash='bad'"),/permission denied/)
 await assert.rejects(rdsPool().query('create table public.unapproved(id integer)'),/permission denied/)
 await assert.rejects(rdsPool().query('select rolpassword from pg_authid'),/permission denied/)
 await assert.rejects(rdsPool().query('delete from kairon_security_audit'),/permission denied/)
})
test('RDS refresh races yield at most one refresh response and revoke replayed tokens',async()=>{
 const u=await user(),session=(await login(u.email,'test-long-password-123'))!
 const results=await Promise.all([refreshSession(session.refreshToken),refreshSession(session.refreshToken)])
 assert.equal(results.filter(Boolean).length,1)
 assert.equal(await verifyToken(results.find(Boolean)!.token),null)
})
test('state, notification outbox and audit commit atomically with durable exclusive delivery leases',async()=>{
 const state=seedOps();state.notifications=[{id:'n-atomic',depot:'Peliyagoda',to:['DRIVER']} as typeof state.notifications[number]]
 state.audit=[{id:'a-atomic'} as typeof state.audit[number]]
 await persistState(null,state,{events:[],media:[]})
 const saved=await loadOps();assert.equal(saved?.version,1)
 const invalid=structuredClone(state);invalid.notifications.push({depot:'Peliyagoda'} as typeof state.notifications[number])
 await assert.rejects(persistState(saved,invalid,{events:[],media:[]}))
 assert.equal((await loadOps())?.version,1)
 assert.equal((await claimOutbox('publisher-a')).length,1);assert.equal((await claimOutbox('publisher-b')).length,0)
 assert.equal(await claimDelivery('d-1','n-atomic','u-1','push','worker-a'),true)
 assert.equal(await claimDelivery('d-1','n-atomic','u-1','push','worker-b'),false)
 await assert.rejects(finishDelivery('d-1','worker-b','sent','provider-1'))
 await finishDelivery('d-1','worker-a','sent','provider-1')
 assert.equal(await claimDelivery('d-1','n-atomic','u-1','push','worker-b'),false)
 const u=await user(),s=await verifyToken((await login(u.email,'test-long-password-123'))!.token)
 assert.ok(s);await contacts(s,{push:true,email:false,sms:false,criticalOnly:true});await securityAudit('test',u.id)
 assert.equal((await contacts(s)).push,true)
})


test('failed proof commit cannot overwrite another transaction’s committed S3 object',async()=>{
 const objects=new Map<string,Buffer>()
 const storage={put:async(key:string,data:Buffer)=>{objects.set(key,data)},get:async(key:string)=>objects.get(key)!}
 const before=(await loadOps())!, next=structuredClone(before)
 const id='a'.repeat(32)
 await persistState(before,next,{events:[],media:[{id,content_type:'image/png',data:Buffer.from('committed-proof').toString('base64')}]},storage)
 const stale=structuredClone(before)
 await assert.rejects(persistState(before,stale,{events:[],media:[{id,content_type:'image/png',data:Buffer.from('conflicting-proof').toString('base64')}]},storage))
 assert.equal((await loadMedia(id,storage))?.data.toString(),'committed-proof')
 assert.equal(objects.size,2)
 const row=(await admin.query('select data,object_key from kairon_media where id=$1',[id])).rows[0]
 assert.equal(row.data,null);assert.ok(row.object_key.startsWith('proof/'))
})


test('source import is atomic, preserves versions/IDs and requires deliberate password re-provisioning',async()=>{
 await admin.query('truncate kairon_users,kairon_sessions,kairon_refresh_tokens,kairon_state,kairon_events,kairon_media,kairon_contacts,kairon_push_devices,kairon_notification_outbox,kairon_notification_deliveries,kairon_security_audit,kairon_operational_audit cascade')
 const id=crypto.randomUUID(),email='imported@example.test',state=seedOps();state.version=7
 const snapshot:Snapshot={format:'kairon-supabase-export-v1',tables:{kairon_users:[{id,email,password_hash:'reset-required',app_metadata:metadata,email_verified:true,disabled:false}],kairon_state:[{id:1,version:7,data:state}],kairon_media:[{id:'b'.repeat(32),content_type:'image/png',data:Buffer.from('legacy-proof').toString('base64')}],kairon_events:[{id:'event-import',user_email:email,result:'applied'},{id:'event-import',user_email:email,result:'applied'}]}}
 const atomic=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const db=await admin.connect();try{await db.query('begin');await fn(db);await db.query('commit')}catch(error){await db.query('rollback');throw error}finally{db.release()}}
 await assert.rejects(atomic(db=>importSnapshot(db,structuredClone(snapshot))),/duplicate key/)
 assert.equal((await admin.query('select count(*) from kairon_state')).rows[0].count,'0')
 assert.equal((await admin.query('select count(*) from kairon_users')).rows[0].count,'0')
 snapshot.tables.kairon_events.pop();await atomic(db=>importSnapshot(db,structuredClone(snapshot)))
 assert.equal((await loadOps())?.version,7)
 assert.equal((await loadMedia('b'.repeat(32)))?.data.toString(),'legacy-proof')
 assert.equal(await login(email,'old-password'),null)
 await atomic(db=>provisionUsers(db,[{email,password:'new-import-password-123',...metadata,emailVerified:true}],true))
 assert.equal((await verifyToken((await login(email,'new-import-password-123'))!.token))?.id,id)
 await assert.rejects(atomic(db=>importSnapshot(db,structuredClone(snapshot))),/empty target/)
 assert.equal((await loadOps())?.version,7)
})


test('RDS HTTP login uses HttpOnly browser cookies and logout invalidates the access token',async()=>{
 const {app,op}=await buildApp();await op.init()
 try {
  const headers={origin:'http://localhost:5173','x-session-mode':'cookie'}
  const signed=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email:'imported@example.test',password:'new-import-password-123'}})
  assert.equal(signed.statusCode,200);assert.equal(signed.json().refreshToken,null)
  assert.match(String(signed.headers['set-cookie']),/HttpOnly/)
  const token=signed.json().token
  const signedOut=await app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,authorization:'Bearer '+token},payload:{}})
  assert.equal(signedOut.statusCode,200)
  assert.equal((await app.inject({url:'/api/auth/me',headers:{authorization:'Bearer '+token}})).statusCode,401)
 }finally{await app.close()}
})
