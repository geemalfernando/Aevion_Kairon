/**
 * Time helpers. All operational times are Sri Lanka time (Asia/Colombo, UTC+05:30, no DST),
 * so we convert with a fixed offset instead of relying on the device's time zone.
 */

/** Minutes since midnight, Colombo time. */
export type Minutes = number

export const TZ = 'Asia/Colombo'
const OFFSET_MS = 330 * 60_000

export const hm = (h: number, m = 0): Minutes => h * 60 + m

/** "05:30" → 330. Accepts "5:30" too. Empty or malformed input returns NaN. */
export function parseHM(s: string | undefined | null): Minutes {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/** "07:00-09:30" → [420, 570]; blank → undefined. */
export function parseWindow(s: string | undefined | null): [Minutes, Minutes] | undefined {
  const parts = (s ?? '').split('-').map((x) => parseHM(x))
  return parts.length === 2 && parts.every((n) => Number.isFinite(n)) ? [parts[0], parts[1]] : undefined
}

export function fmtMin(min: Minutes): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const fmtWindow = ([a, b]: [Minutes, Minutes]) => `${fmtMin(a)}–${fmtMin(b)}`

/** YYYY-MM-DD in Colombo for a timestamp. */
export const colomboDate = (ts: number) => new Date(ts + OFFSET_MS).toISOString().slice(0, 10)

/** Minutes since Colombo midnight for a timestamp. */
export function colomboMinutes(ts: number): Minutes {
  const d = new Date(ts + OFFSET_MS)
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60
}

/** Timestamp for a Colombo date and minute of day. */
export const colomboTs = (date: string, min: Minutes) => Date.parse(`${date}T00:00:00Z`) - OFFSET_MS + min * 60_000

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Day of week with Monday = 0, matching calendar.csv. */
export const dowOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

export function isoWeekOf(date: string): { iso_year: number; iso_week: number } {
  const t = new Date(`${date}T00:00:00Z`)
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const year = t.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  return { iso_year: year, iso_week: Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7) }
}

/** Date or timestamp, shown in Colombo time. Plain YYYY-MM-DD strings are treated as calendar dates. */
export function fmtDate(d: Date | string | number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T06:00:00Z`) : new Date(d)
  return date.toLocaleDateString('en-GB', { ...opts, timeZone: TZ })
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

export function timeAgo(ts: number, now: number): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function greeting(now: number): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const h = colomboMinutes(now) / 60
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
