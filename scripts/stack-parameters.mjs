// Prints the deployed stack's current parameters as a deploy-rds.mjs parameter file, so CI
// can release a new image without the ignored local infra/aws/parameters.json.
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
const [stack]=process.argv.slice(2)
if(!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(stack??''))throw new Error('Usage: stack-parameters.mjs <stack>')
const region=process.env.AWS_REGION||'ap-southeast-2'
const r=spawnSync('aws',['cloudformation','describe-stacks','--stack-name',stack,'--region',region,'--output','json'],{encoding:'utf8'})
if(r.status!==0)throw new Error(r.stderr||r.error?.message)
const known=JSON.parse(readFileSync('infra/aws/rds.json','utf8')).Parameters
const parameters=Object.fromEntries(JSON.parse(r.stdout).Stacks[0].Parameters.filter(p=>p.ParameterKey!=='ImageTag'&&p.ParameterKey in known).map(p=>[p.ParameterKey,p.ParameterValue]))
console.log(JSON.stringify(parameters,null,2))
