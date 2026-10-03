import {spawnSync} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,lstatSync} from 'node:fs'
import {createHash} from 'node:crypto'
const output='artifacts/cloudshell/kairon-rds-cloudshell.tar.gz'
mkdirSync('artifacts/cloudshell',{recursive:true})
const list=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'})
if(list.status!==0)throw new Error('Could not enumerate source files')
const prefixes=['core/','server/','web/','docker/','infra/','scripts/','database/','supabase/','docs/']
const files=[...new Set(list.stdout.split('\0').filter(name=>name && (prefixes.some(p=>name.startsWith(p))||['Dockerfile','.dockerignore','VERSION','README.md'].includes(name))&&!['web/android/','web/ios/','web/api/_server.mjs'].some(p=>name.startsWith(p))))]
for(const file of files){const basename=file.split('/').at(-1);if(basename.startsWith('.env')||basename==='parameters.json'||basename.includes('service-account')||file.endsWith('.p8')||lstatSync(file).isSymbolicLink())throw new Error('Refusing possible secret/symlink: '+file)}
const archive=spawnSync('tar',['-czf',output,'--null','-T','-'],{input:files.join('\0')+'\0',encoding:'utf8'})
if(archive.status!==0)throw new Error(archive.stderr)
const hash=createHash('sha256').update(readFileSync(output)).digest('hex')
writeFileSync('artifacts/cloudshell/kairon-rds-cloudshell.sha256',hash+'  kairon-rds-cloudshell.tar.gz\n')
console.log('Prepared '+output+' ('+files.length+' source files). No environment files, local parameters or data exports included.')
