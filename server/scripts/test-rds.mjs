import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const container=`kairon-rds-test-${process.pid}`
const docker=args=>spawnSync('docker',args,{encoding:'utf8',timeout:120000})
const start=docker(['run','--rm','-d','--name',container,'-e','POSTGRES_PASSWORD=kairon-test-only','-p','127.0.0.1::5432','postgres:16-alpine'])
assert.equal(start.status,0,start.stderr)
try {
 let ready=false
 for(let i=0;i<30;i++){if(docker(['exec',container,'pg_isready','-U','postgres']).status===0){ready=true;break}await new Promise(r=>setTimeout(r,1000))}
 assert.ok(ready,'PostgreSQL did not become ready')
 const port=docker(['port',container,'5432/tcp']).stdout.trim().split(':').at(-1)
 const admin=`postgres://postgres:kairon-test-only@127.0.0.1:${port}/postgres`
 const password='RdsTestRuntimePassword12345678901234567890'
 const env={...process.env,ENV_FILE:'.rds-test-no-env',BACKEND:'rds',DEPLOYMENT_ENV:'development',SUPABASE_URL:'',DATABASE_URL:admin,RDS_TLS:'false',MEDIA_BUCKET:'rds-test-proof',RDS_RUNTIME_PASSWORD:password,AUTH_SECRET:'rds-test-only-signing-key-long-enough-for-hs256',NOTIFICATION_ENCRYPTION_KEY:'a'.repeat(64)}
 const migrate=spawnSync(process.execPath,['--import','tsx','scripts/migrate-rds.ts'],{env,encoding:'utf8',timeout:120000});assert.equal(migrate.status,0,migrate.stderr)
 const again=spawnSync(process.execPath,['--import','tsx','scripts/migrate-rds.ts'],{env,encoding:'utf8',timeout:120000});assert.equal(again.status,0,again.stderr)
 const test=spawnSync(process.execPath,['--import','tsx','--test','test/rds.integration.ts'],{env:{...env,DATABASE_URL:`postgres://kairon_runtime:${password}@127.0.0.1:${port}/postgres`,KAIRON_TEST_ADMIN_URL:admin},stdio:'inherit',timeout:120000});assert.equal(test.status,0,'RDS integration tests failed')
}finally{docker(['rm','-f',container])}
