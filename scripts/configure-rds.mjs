import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
const [networkStack,usersFile]=process.argv.slice(2)
if(!networkStack||!usersFile)throw new Error('Usage: configure-rds.mjs <existing-network-stack> <uploaded-users-secret.json>')
const region=process.env.AWS_REGION||'ap-southeast-2'
const aws=args=>{const r=spawnSync('aws',[...args,'--region',region,'--output','json'],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||r.error?.message);return JSON.parse(r.stdout)}
const stack=aws(['cloudformation','describe-stacks','--stack-name',networkStack]).Stacks[0]
if(!['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(stack.StackStatus))throw new Error('Network stack is not ready')
const outputs=Object.fromEntries(stack.Outputs.map(o=>[o.OutputKey,o.OutputValue]))
for(const key of ['VpcId','PrivateSubnets','PublicSubnets'])if(!outputs[key])throw new Error('Network output missing: '+key)
const secret=aws(['secretsmanager','create-secret','--name','kairon/rds-staging/users','--secret-string','file://'+usersFile])
const params=JSON.parse(readFileSync('infra/aws/parameters.rds.example.json','utf8'))
Object.assign(params,{VpcId:outputs.VpcId,PrivateSubnets:outputs.PrivateSubnets,PublicSubnets:outputs.PublicSubnets,InitialUsersSecretArn:secret.ARN})
writeFileSync('infra/aws/parameters.json',JSON.stringify(params,null,2)+'\n')
unlinkSync(usersFile)
console.log('Created initial-users secret and configured infra/aws/parameters.json. Uploaded plaintext secret file removed; keep your protected Mac copy for initial sign-in.')
