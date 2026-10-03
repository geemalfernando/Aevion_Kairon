// Releases the checked-out commit to the staging stack from CodeBuild (infra/aws/codebuild-deploy.json)
// and records it as a GitHub deployment when a GitHub token is configured.
// Overlapping builds are safe: each waits for the stack to be idle and skips itself when the live
// release is not an ancestor of its commit, so an older build can never replace a newer one.
import {spawnSync} from 'node:child_process'
import {writeFileSync,mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const env=process.env
const stack=env.STACK, region=env.AWS_REGION||'ap-southeast-2', sha=env.CODEBUILD_RESOLVED_SOURCE_VERSION
if(!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(stack??'')||!/^[0-9a-f]{40}$/.test(sha??''))throw new Error('STACK and CODEBUILD_RESOLVED_SOURCE_VERSION are required')
const schemaFiles=['database/','server/scripts/migrate-rds.ts','server/scripts/import-rds.ts','server/scripts/rds-users.ts']

const run=(bin,args,{capture=false,allowFail=false}={})=>{
  const r=spawnSync(bin,args,{encoding:'utf8',stdio:capture?'pipe':'inherit'})
  if(r.error)throw r.error
  if(r.status!==0&&!allowFail)throw new Error(`${bin} ${args[0]} failed (${r.status})${capture?': '+r.stderr.slice(0,500):''}`)
  return capture?r.stdout.trim():r.status
}
const describe=()=>JSON.parse(run('aws',['cloudformation','describe-stacks','--stack-name',stack,'--region',region,'--output','json'],{capture:true})).Stacks[0]
const sleep=ms=>new Promise(r=>setTimeout(r,ms))

// GitHub deployment records are best effort: a missing token or API error never fails the release.
const token=(env.GITHUB_TOKEN??'').trim(), repo=env.GITHUB_REPOSITORY
const reporting=/^(github_pat_|ghp_)/.test(token)&&/^[\w.-]+\/[\w.-]+$/.test(repo??'')
if(!reporting)console.log('GitHub deployment records are off (no token in the GitHub token secret).')
const [, , , , account, resource='']=(env.CODEBUILD_BUILD_ARN??'').split(':')
const logUrl=account?`https://${region}.console.aws.amazon.com/codesuite/codebuild/${account}/projects/${resource.split('/')[1]}/build/${encodeURIComponent(env.CODEBUILD_BUILD_ID??'')}/?region=${region}`:undefined
async function github(path,body){
  if(!reporting)return
  try{
    const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'},body:JSON.stringify(body)})
    if(!r.ok){console.warn(`GitHub ${path} returned ${r.status}; deployment record skipped.`);return}
    return await r.json()
  }catch(e){console.warn(`GitHub ${path} failed (${e.message}); deployment record skipped.`)}
}

// 1. Wait for any other release to finish.
let live=describe()
for(let i=0;live.StackStatus.endsWith('_IN_PROGRESS');i++){
  if(i>=160)throw new Error(`${stack} stayed ${live.StackStatus} for 40 minutes`)
  if(i===0)console.log(`Waiting for ${stack} (${live.StackStatus})…`)
  await sleep(15000); live=describe()
}
const param=k=>live.Parameters.find(p=>p.ParameterKey===k)?.ParameterValue
const output=k=>live.Outputs?.find(o=>o.OutputKey===k)?.OutputValue
const deployed=param('ImageTag')

// 2. Only move forward, and never past an unreviewed schema change.
if(deployed?.startsWith('git-')){
  const base=deployed.split('-')[1]
  if(run('git',['merge-base','--is-ancestor',base,sha],{allowFail:true})!==0){
    console.log(`Live release ${deployed} is not an ancestor of ${sha.slice(0,12)}; a newer release is already live. Nothing to do.`)
    process.exit(0)
  }
  if(run('git',['diff','--quiet',base,sha,'--',...schemaFiles],{allowFail:true})!==0)
    throw new Error(`Schema files changed since ${deployed}. Run deploy-rds.mjs migrate by hand, then start this build again.`)
}else if(env.SCHEMA_CONFIRMED!=='true'){
  throw new Error(`Live image ${deployed} was released by hand, so schema changes can't be compared. Start this build once with SCHEMA_CONFIRMED=true.`)
}

// 3. Release.
const deployment=await github('/deployments',{ref:sha,environment:'aws-staging',description:`CodeBuild #${env.CODEBUILD_BUILD_NUMBER}`,auto_merge:false,required_contexts:[],production_environment:false})
const status=(state,extra={})=>deployment?.id&&github(`/deployments/${deployment.id}/statuses`,{state,log_url:logUrl,auto_inactive:true,...extra})
await status('in_progress')
const url=output('ApplicationUrl')
try{
  const dir=mkdtempSync(join(tmpdir(),'kairon-release-')),file=join(dir,'parameters.json')
  writeFileSync(file,run('node',['scripts/stack-parameters.mjs',stack],{capture:true}))
  run('node',['scripts/deploy-rds.mjs','release',stack,file,`git-${sha.slice(0,12)}-${env.CODEBUILD_BUILD_NUMBER}`])
  // 4. Smoke test the public address.
  let ok=false
  for(let i=0;i<20&&!ok;i++){ok=await fetch(`${url}/api/health`).then(r=>r.json()).then(b=>b.ok===true).catch(()=>false);if(!ok)await sleep(15000)}
  if(!ok)throw new Error(`${url}/api/health did not report ok`)
  const guard=await fetch(`${url}/api/state`).then(r=>r.status)
  if(guard!==401)throw new Error(`${url}/api/state returned ${guard} without a sign-in, expected 401`)
}catch(e){
  await status('failure',{description:e.message.slice(0,140)})
  throw e
}
await status('success',{environment_url:url})
console.log(`Released ${sha.slice(0,12)} to ${url}`)
