import crypto from 'node:crypto'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import type { OpsData } from '@core/types'
import type { Tx } from './db-supabase'
import { rdsPool } from './rds'
import { config } from './config'

const s3 = new S3Client({maxAttempts:2})
export interface ProofPort {
  put: (key:string,data:Buffer,contentType:string) => Promise<void>
  get: (key:string) => Promise<Buffer>
}
const proofStorage:ProofPort = {
  put: async (key,data,contentType) => { await s3.send(new PutObjectCommand({Bucket:config.mediaBucket,Key:key,Body:data,ContentType:contentType,ServerSideEncryption:'AES256'})) },
  get: async key => { const response=await s3.send(new GetObjectCommand({Bucket:config.mediaBucket,Key:key}));if(!response.Body)throw new Error('Proof body missing');return Buffer.from(await response.Body.transformToByteArray()) },
}
export async function loadOps(): Promise<OpsData | null> {
  const r=await rdsPool().query('select data from public.kairon_state where id=1')
  return r.rows[0]?.data ?? null
}
export async function persistState(before:OpsData|null,after:OpsData,tx:Tx,storage:ProofPort=proofStorage) {
  after.version=(before?.version??0)+1
  const media=[]
  // Unique immutable objects prevent a failed state transaction from overwriting committed proof.
  // Failed uploads/commits may leave unreferenced objects; remove only after a DB-reference reconciliation.
  for(const m of tx.media) {
    if(!config.mediaBucket) throw new Error('RDS proof storage requires MEDIA_BUCKET')
    const object_key=`proof/${m.id}/${crypto.randomUUID()}`
    await storage.put(object_key,Buffer.from(m.data,'base64'),m.content_type)
    media.push({id:m.id,content_type:m.content_type,object_key,data:null})
  }
  try { await rdsPool().query('select public.kairon_commit($1,$2,$3,$4)',[before?.version??0,JSON.stringify(after),JSON.stringify(tx.events),JSON.stringify(media)]) }
  catch(error) { throw Object.assign(new Error('Operation was not saved'),{statusCode:(error as {code?:string}).code==='40001'?409:503}) }
}
export async function seenEvents(ids:string[]) {
  if(!ids.length) return new Set<string>()
  const r=await rdsPool().query('select id from public.kairon_events where id=any($1)',[ids])
  return new Set<string>(r.rows.map(x=>x.id))
}
export async function loadMedia(id:string,storage:ProofPort=proofStorage) {
  const r=await rdsPool().query('select content_type,data,object_key from public.kairon_media where id=$1',[id]); const row=r.rows[0]
  if(!row) return undefined
  if(row.data) return {content_type:row.content_type as string,data:Buffer.from(row.data,'base64')}
  return {content_type:row.content_type as string,data:Buffer.from(await storage.get(row.object_key))}
}
