/**
 * Captures every screen listed in src/pages/figma/frames.json into public/figma/<id>.png,
 * so the /figma board pages (imported into Figma with html.to.design) always show the current app.
 *
 *   npm run dev                      (in another terminal)
 *   npm run figma:capture            (optional: BASE_URL=http://127.0.0.1:5174 CHROME_PATH=...)
 *   npm run figma:capture -- R6-reconcile D3-planning     (only some frames)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { frames } = JSON.parse(fs.readFileSync(path.join(root, 'src/pages/figma/frames.json'), 'utf8'))
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5174'
// Every screenshot uses the same ordering day (Sun 27 Sept, deliveries Mon 28 Sept) whatever day it is taken.
const DAY = process.env.FIGMA_DAY ?? '2026-09-27'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = path.join(root, 'public/figma')
const only = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
let failed = 0
for (const f of frames.filter((x) => !only.length || only.includes(x.id))) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewport({ width: f.w, height: f.h, deviceScaleFactor: 2 })
  const url = `${BASE}${f.url}${f.url.includes('?') ? '&' : '?'}frame=1&day=${DAY}`
  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })
    await new Promise((r) => setTimeout(r, 800))
    await page.screenshot({ path: path.join(OUT, `${f.id}.png`) })
    console.log(`${errors.length ? '!' : '✓'} ${f.id}${errors.length ? `  ${errors[0]}` : ''}`)
    if (errors.length) failed++
  } catch (e) {
    failed++
    console.log(`✗ ${f.id}  ${e.message}`)
  }
  await page.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
