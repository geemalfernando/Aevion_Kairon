/** The competition CSVs and catalogue in DATA_DIR, read for the demo delivery day. Never committed (see .gitignore). */
import fs from 'node:fs'
import path from 'node:path'
import type { Catalog } from '@core/catalog'
import type { CsvName } from '@core/csv'

const CSV_NAMES: CsvName[] = ['outlets', 'vehicles', 'calendar', 'district_travel', 'service_allowance', 'fleet_status']

/** Find the CSVs anywhere under `dir` (the datasets ship in sub-folders such as "General Data/"). */
export function readCsvs(dir: string): Partial<Record<CsvName, string>> {
  const found: Partial<Record<CsvName, string>> = {}
  const walk = (d: string, depth = 0) => {
    if (depth > 3 || !fs.existsSync(d)) return
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) walk(p, depth + 1)
      const name = CSV_NAMES.find((n) => `${n}.csv` === entry.name.toLowerCase())
      if (name && !found[name]) found[name] = fs.readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return found
}

export function readCatalog(dir: string): Catalog | undefined {
  const file = path.join(dir, 'catalog.json')
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Catalog) : undefined
}
