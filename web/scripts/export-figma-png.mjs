/**
 * Saves every part of the /figma pages as PNGs to drag into Figma (no public link needed).
 * Each part marked data-export becomes one image, scaled so no side exceeds 4096 px (Figma's image limit).
 *
 *   npm run dev                  (in another terminal)
 *   npm run figma:export         -> figma-export/<page>/NN-name.png
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5174'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = path.join(root, 'figma-export')
const MAX = 4096
const pages = [
  ['1-document', '/figma/doc'],
  ['2-dispatcher', '/figma/board/dispatcher'],
  ['3-loader', '/figma/board/loader'],
  ['4-driver', '/figma/board/driver'],
  ['5-store', '/figma/board/store'],
  ['6-degradation', '/figma/degradation'],
]
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

fs.rmSync(OUT, { recursive: true, force: true })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
for (const [name, url] of pages) {
  const dir = path.join(OUT, name)
  fs.mkdirSync(dir, { recursive: true })
  const probe = await browser.newPage()
  await probe.setViewport({ width: 1920, height: 1000 })
  await probe.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 60_000 })
  const parts = await probe.$$eval('[data-export]', (els) =>
    els.map((e) => ({ name: e.dataset.export, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })),
  )
  await probe.close()
  // One page per scale, so each part renders at its own sharpest allowed size.
  for (const [i, p] of parts.entries()) {
    const scale = Math.min(2, MAX / Math.max(p.w, p.h))
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1000, deviceScaleFactor: scale })
    await page.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 60_000 })
    await page.evaluate(() => document.fonts.ready)
    const el = (await page.$$('[data-export]'))[i]
    const file = `${String(i + 1).padStart(2, '0')}-${slug(p.name)}.png`
    await el.screenshot({ path: path.join(dir, file) })
    console.log(`${name}/${file}  ${Math.round(p.w * scale)}×${Math.round(p.h * scale)}`)
    await page.close()
  }
}
await browser.close()
