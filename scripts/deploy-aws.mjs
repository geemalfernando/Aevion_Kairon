// No shell interpolation and no credentials in parameters. AWS credentials come from SSO/OIDC.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const [mode, stack, parameterFile, tag] = process.argv.slice(2)
if (!['bootstrap', 'release', 'plan'].includes(mode) || !/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(stack ?? '') || !parameterFile) throw new Error('Usage: node scripts/deploy-aws.mjs <plan|bootstrap|release> <stack> <parameters.json> [unique-image-tag]')
const region = process.env.AWS_REGION || 'ap-south-1'
const template = JSON.parse(readFileSync('infra/aws/release.json', 'utf8'))
const parameters = JSON.parse(readFileSync(parameterFile, 'utf8'))
for (const [key, value] of Object.entries(parameters)) {
 if (!(key in template.Parameters) || !['string', 'number'].includes(typeof value)) throw new Error(`Invalid parameter: ${key}`)
}
if (mode !== 'release') Object.assign(parameters, { DesiredCount: 0, PublisherCount: 0, WorkerCount: 0 })
if (mode === 'release') {
 if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(tag ?? '')) throw new Error('A new immutable image tag is required')
 parameters.ImageTag = tag
 parameters.DesiredCount ??= 2
}
if (mode === 'plan') { console.log(JSON.stringify({ region, stack, parameters, templateBytes: JSON.stringify(template).length }, null, 2)); process.exit(0) }
const run = (bin, args, options = {}) => {
 const result = spawnSync(bin, args, { stdio: options.capture ? 'pipe' : 'inherit', ...options })
 if (result.error) throw result.error
 if (result.status !== 0) throw new Error(`${bin} failed (${result.status})`)
 return result.stdout?.toString().trim()
}
const aws = (args, options) => run('aws', [...args, '--region', region], options)
aws(['sts', 'get-caller-identity'])
if (parameters.UseCloudFront === 'true' && !parameters.CloudFrontPrefixListId) {
 const lists = JSON.parse(aws(['ec2', 'describe-managed-prefix-lists', '--filters', 'Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing', '--output', 'json'], { capture: true }))
 parameters.CloudFrontPrefixListId = lists.PrefixLists?.[0]?.PrefixListId
 if (!parameters.CloudFrontPrefixListId) throw new Error('CloudFront origin-facing prefix list not found in this AWS region')
}
const describe = spawnSync('aws', ['cloudformation', 'describe-stacks', '--stack-name', stack, '--region', region, '--output', 'json'], { encoding: 'utf8' })
if (mode === 'bootstrap' && describe.status === 0) throw new Error('Stack already exists; bootstrap refuses to scale down an existing deployment')
if (mode === 'bootstrap' && !describe.stderr?.includes('does not exist')) throw new Error('Could not verify stack absence; check AWS permissions')
if (mode === 'release') {
 if (describe.status !== 0) throw new Error('Bootstrap the stack first')
 const repository = JSON.parse(describe.stdout).Stacks[0].Outputs.find(o => o.OutputKey === 'RepositoryUri')?.OutputValue
 if (!repository) throw new Error('ECR repository output missing')
 const password = aws(['ecr', 'get-login-password'], { capture: true })
 run('docker', ['login', '--username', 'AWS', '--password-stdin', repository.split('/')[0]], { input: password + '\n', stdio: ['pipe', 'inherit', 'inherit'] })
 run('docker', ['buildx', 'build', '--platform', 'linux/amd64', '--target', 'production', '--build-arg', 'VITE_DEMO_MODE=false', '--tag', `${repository}:${tag}`, '--push', '.'])
}
const temporary = mkdtempSync(join(tmpdir(), 'kairon-deploy-'))
try {
 const file = join(temporary, 'release.json')
 writeFileSync(file, JSON.stringify(template)) // Formatted source exceeds the CLI inline template limit.
 aws(['cloudformation', 'deploy', '--stack-name', stack, '--template-file', file, '--capabilities', 'CAPABILITY_IAM', '--parameter-overrides', ...Object.entries(parameters).map(([k,v]) => `${k}=${v}`), '--no-fail-on-empty-changeset'])
 aws(['cloudformation', 'describe-stacks', '--stack-name', stack, '--query', 'Stacks[0].Outputs', '--output', 'table'])
} finally { rmSync(temporary, { recursive: true, force: true }) }
