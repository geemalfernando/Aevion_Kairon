// Turns the JUnit report from `npm run test:ci` into a Markdown table, one row per test, grouped by suite.
// CI appends it to the job summary: node scripts/test-summary.mjs test-results.xml >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from 'node:fs'

const xml = readFileSync(process.argv[2] ?? 'test-results.xml', 'utf8')
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attr = (tag, name) => unescape(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '')
const cell = (s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

const TESTCASE = /(<testcase\b[^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g
const SUITE = /(<testsuite\b[^>]*>)([\s\S]*?)<\/testsuite>/g
// Top-level test() calls sit outside any <testsuite>; group them by file.
const groups = [...xml.matchAll(SUITE)].map(([, open, body]) => ({ name: attr(open, 'name'), body }))
const byFile = {}
for (const [whole, tag] of xml.replace(SUITE, '').matchAll(TESTCASE)) (byFile[attr(tag, 'file').split('/').pop()] ??= []).push(whole)
for (const [file, cases] of Object.entries(byFile)) groups.push({ name: file, body: cases.join('') })

let total = 0, failed = 0, skipped = 0
const sections = []
for (const { name, body } of groups) {
  const rows = []
  let groupFailed = false
  for (const [, tag, inner = ''] of body.matchAll(TESTCASE)) {
    total++
    const fail = /<(failure|error)\b/.test(inner)
    const skip = /<skipped\b/.test(inner)
    if (fail) {
      failed++
      groupFailed = true
    }
    if (skip) skipped++
    const reason = fail ? cell(unescape(inner.match(/<(?:failure|error)\b[^>]*message="([^"]*)"/)?.[1] ?? 'failed')) : ''
    rows.push(`| ${fail ? '❌' : skip ? '⏭️' : '✅'} | ${cell(attr(tag, 'name'))} | ${Math.round(Number(attr(tag, 'time')) * 1000)} ms | ${reason} |`)
  }
  sections.push(`<details${groupFailed ? ' open' : ''}><summary><b>${cell(name)}</b> (${rows.length})</summary>\n\n| | Test | Time | Failure |\n|---|---|---|---|\n${rows.join('\n')}\n\n</details>`)
}

console.log(`## API tests: ${total - failed - skipped}/${total} passed${failed ? ` · ❌ ${failed} failed` : ''}${skipped ? ` · ${skipped} skipped` : ''}\n`)
console.log(sections.join('\n\n'))
