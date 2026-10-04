import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
const [mode,stack,parameterFile,tag]=process.argv.slice(2)
if(!['plan','bootstrap','image','migrate','activate','release'].includes(mode)||!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(stack??'')||!parameterFile) throw new Error('Usage: deploy-rds.mjs <plan|bootstrap|image|migrate|activate|release> <stack> <parameters.json> [unique-image-tag]')
const region=process.env.AWS_REGION||'ap-southeast-2'
const template=JSON.parse(readFileSync('infra/aws/rds.json','utf8')),parameters=JSON.parse(readFileSync(parameterFile,'utf8'))
for(const [k,v] of Object.entries(parameters))if(!(k in template.Parameters)||!['string','number'].includes(typeof v))throw new Error('Invalid parameter: '+k)
if(['image','activate','release'].includes(mode)){
 if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(tag??''))throw new Error('A unique image tag is required')
 parameters.ImageTag=tag
}
const schemaHash=createHash('sha256').update(['database/migrations/001_rds.sql','server/scripts/migrate-rds.ts','server/scripts/import-rds.ts','server/scripts/rds-users.ts'].map(file=>readFileSync(file)).reduce((all,part)=>Buffer.concat([all,part]),Buffer.alloc(0))).digest('hex')
const receiptFile=parameterFile+'.migration.json'
const run=(bin,args,options={})=>{const r=spawnSync(bin,args,{stdio:options.capture?'pipe':'inherit',...options});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${bin} failed (${r.status})${options.capture?': '+r.stderr?.toString().slice(0,1500):''}`);return r.stdout?.toString().trim()}
const aws=(args,options)=>run('aws',[...args,'--region',region],options)
const json=args=>JSON.parse(aws([...args,'--output','json'],{capture:true}))
if(mode==='plan'){console.log(JSON.stringify({region,stack,parameters,templateBytes:JSON.stringify(template).length,steps:['bootstrap','image','migrate','activate']},null,2));process.exit(0)}
aws(['sts','get-caller-identity'])
const check=spawnSync('aws',['cloudformation','describe-stacks','--stack-name',stack,'--region',region,'--output','json'],{encoding:'utf8'})
if(mode==='bootstrap'&&(check.status===0||!check.stderr?.includes('does not exist')))throw new Error('Bootstrap requires confirmed stack absence; never reuse the deployed network stack name')
if(mode!=='bootstrap'&&check.status!==0)throw new Error('Bootstrap this RDS stack first')
const existing=check.status===0?JSON.parse(check.stdout).Stacks[0]:undefined
const outputs=Object.fromEntries((existing?.Outputs??[]).map(o=>[o.OutputKey,o.OutputValue]))
const saved=Object.fromEntries((existing?.Parameters??[]).map(p=>[p.ParameterKey,p.ParameterValue]))
const deploymentEnv=parameters.DeploymentEnv??saved.DeploymentEnv??'staging'
parameters.DemoControlsEnabled??=saved.DemoControlsEnabled??(deploymentEnv==='staging'?'true':'false')
if(parameters.DemoControlsEnabled==='true'&&deploymentEnv!=='staging')throw new Error('Demo controls are only available in staging')
const demo=deploymentEnv==='staging'&&parameters.DemoControlsEnabled==='true'
for(const k of ['RdsEngineVersion','RdsParameterFamily'])if(!parameters[k]&&saved[k])parameters[k]=saved[k]
if(!parameters.RdsEngineVersion||!parameters.RdsParameterFamily){const engine=json(['rds','describe-db-engine-versions','--engine','postgres','--default-only']).DBEngineVersions[0];if(!engine)throw new Error('No default PostgreSQL engine found');parameters.RdsEngineVersion??=engine.EngineVersion;parameters.RdsParameterFamily??=engine.DBParameterGroupFamily}
if(parameters.UseCloudFront==='true'&&!parameters.CloudFrontPrefixListId){parameters.CloudFrontPrefixListId=json(['ec2','describe-managed-prefix-lists','--filters','Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing']).PrefixLists[0]?.PrefixListId;if(!parameters.CloudFrontPrefixListId)throw new Error('CloudFront managed prefix list unavailable')}
if(['bootstrap','image'].includes(mode)){
 if(mode==='image'&&['DesiredCount','PublisherCount','WorkerCount'].some(k=>Number(saved[k])>0))throw new Error('image is only for zero-task bootstrap; use release for an existing deployment')
 Object.assign(parameters,{DesiredCount:0,PublisherCount:0,WorkerCount:0})
}
if(mode==='release'&&saved.DesiredCount==='0')throw new Error('For first deployment use image, migrate and activate, so application tasks cannot start before database migration')
if(['image','release'].includes(mode)){
 const repository=outputs.RepositoryUri;if(!repository)throw new Error('ECR output missing')
 const password=aws(['ecr','get-login-password'],{capture:true})
 run('docker',['login','--username','AWS','--password-stdin',repository.split('/')[0]],{input:password+'\n',stdio:['pipe','inherit','inherit']})
 run('docker',['buildx','build','--platform','linux/amd64','--target','production','--build-arg',`VITE_DEMO_MODE=${demo}`,'--build-arg',`VITE_HOSTED_DEMO=${demo}`,'--tag',`${repository}:${tag}`,'--push','.'])
}
if(mode==='migrate'){
 if(['DesiredCount','PublisherCount','WorkerCount'].some(k=>Number(saved[k])>0))throw new Error('Stop application and notification tasks before initial data migration')
 const environment=[]
 if(process.env.KAIRON_IMPORT_FILE){const key=`migration/import-${Date.now()}.json`;aws(['s3','cp',process.env.KAIRON_IMPORT_FILE,`s3://${outputs.ProofBucketName}/${key}`,'--sse','AES256']);environment.push({name:'RDS_IMPORT_KEY',value:key})}
 if(process.env.KAIRON_UPDATE_USERS==='true')environment.push({name:'RDS_UPDATE_USERS',value:'true'})
 const result=json(['ecs','run-task','--cluster',outputs.ClusterName,'--task-definition',outputs.MigrationTaskDefinition,'--launch-type','FARGATE','--network-configuration',JSON.stringify({awsvpcConfiguration:{subnets:parameters.PrivateSubnets.split(','),securityGroups:[outputs.AppSecurityGroupId],assignPublicIp:'DISABLED'}}),'--overrides',JSON.stringify({containerOverrides:[{name:'migration',environment}]})])
 if(result.failures?.length||!result.tasks?.[0])throw new Error('Migration task could not start: '+JSON.stringify(result.failures))
 const taskArn=result.tasks[0].taskArn;console.log('Migration task: '+taskArn)
 aws(['ecs','wait','tasks-stopped','--cluster',outputs.ClusterName,'--tasks',taskArn])
 const task=json(['ecs','describe-tasks','--cluster',outputs.ClusterName,'--tasks',taskArn]).tasks[0]
 if(!task||task.containers?.[0]?.exitCode!==0)throw new Error('Migration failed; inspect CloudWatch migration logs. App tasks remain stopped.')
 writeFileSync(receiptFile,JSON.stringify({region,stackId:existing.StackId,imageTag:saved.ImageTag,schemaHash,taskArn})+'\n')
 console.log('Migration succeeded. Next: activate with image tag '+saved.ImageTag);process.exit(0)
}
if(mode==='activate'){
 const receipt=JSON.parse(readFileSync(receiptFile,'utf8'))
 if(receipt.region!==region||receipt.stackId!==existing.StackId||receipt.imageTag!==tag||receipt.schemaHash!==schemaHash)throw new Error('Successful migration receipt must match this stack, image and schema')
 const task=json(['ecs','describe-tasks','--cluster',outputs.ClusterName,'--tasks',receipt.taskArn]).tasks?.[0]
 if(task?.containers?.[0]?.exitCode!==0)throw new Error('Migration task success could not be verified; rerun migrate')
}
// Image builds take minutes; wait for any release that started meanwhile, and with KAIRON_EXPECT_IMAGE_TAG
// refuse (exit 75) to overwrite a different image that went live, so the caller can decide.
if(mode!=='bootstrap')for(let i=0;;i++){
 const s=json(['cloudformation','describe-stacks','--stack-name',stack]).Stacks[0]
 if(!s.StackStatus.endsWith('_IN_PROGRESS')){
  const live=s.Parameters?.find(p=>p.ParameterKey==='ImageTag')?.ParameterValue
  if(process.env.KAIRON_EXPECT_IMAGE_TAG&&live!==process.env.KAIRON_EXPECT_IMAGE_TAG){console.error(`${stack} now runs ${live}, not ${process.env.KAIRON_EXPECT_IMAGE_TAG}; not releasing.`);process.exit(75)}
  break
 }
 if(i>=160)throw new Error(`${stack} stayed ${s.StackStatus} for 40 minutes`)
 if(i===0)console.log(`Waiting for ${stack} (${s.StackStatus})…`)
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)
}
const temp=mkdtempSync(join(tmpdir(),'kairon-rds-'))
try{
 const file=join(temp,'rds.json');writeFileSync(file,JSON.stringify(template))
 aws(['cloudformation','deploy','--stack-name',stack,'--template-file',file,'--capabilities','CAPABILITY_IAM','--parameter-overrides',...Object.entries(parameters).map(([k,v])=>`${k}=${v}`),'--no-fail-on-empty-changeset',...(process.env.KAIRON_CFN_ROLE_ARN?['--role-arn',process.env.KAIRON_CFN_ROLE_ARN]:[])])
 aws(['cloudformation','describe-stacks','--stack-name',stack,'--query','Stacks[0].Outputs','--output','table'])
}finally{rmSync(temp,{recursive:true,force:true})}
