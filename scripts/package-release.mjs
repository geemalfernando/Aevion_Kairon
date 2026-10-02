import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
const run = (...args) => { const r = spawnSync('git', args, { maxBuffer: 200 * 1024 * 1024 }); if (r.status !== 0) throw new Error(r.stderr.toString()); return r.stdout }
if (run('status', '--porcelain').toString().trim()) throw new Error('Commit changes before packaging the release')
const version = readFileSync('VERSION', 'utf8').trim()
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version)) throw new Error('Invalid VERSION')
const commit = run('rev-parse', 'HEAD').toString().trim()
const folder = `artifacts/v${version}`
mkdirSync(folder, { recursive: true })
const files = []
const save = (name, data) => { writeFileSync(`${folder}/${name}`, data); files.push(name) }
save(`kairon-v${version}-source.tar.gz`, gzipSync(run('archive', '--format=tar', `--prefix=kairon-v${version}/`, 'HEAD'), { level: 9 }))
for (const [from, to] of [['infra/aws/release.json', 'cloudformation-release.json'], ['infra/aws/network.json', 'cloudformation-network.json'], ['docs/deployment.md', 'DEPLOYMENT.md']]) {
 copyFileSync(from, `${folder}/${to}`); files.push(to)
}
const digests = Object.fromEntries(files.map(name => [name, createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')]))
save('manifest.json', JSON.stringify({ version, commit, artifacts: digests }, null, 2) + '\n')
writeFileSync(`${folder}/SHA256SUMS`, files.map(name => `${createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')}  ${name}`).join('\n') + '\n')
console.log(`Release ${version} at ${commit}: ${folder}`)
