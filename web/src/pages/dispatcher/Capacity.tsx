import { Snowflake, Table2, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { opNow } from '@core/ops'
import { demandForecast, weeklyReeferCapacity } from '@core/predict'
import { colomboDate } from '@core/time'
import type { Brand, Depot } from '@core/types'
import { BrandTag, Callout, Card, CardHeader, cn, ModelChip, PageHeader, Segmented, Stat } from '../../components/ui'
import { useOps } from '../../store'

const BRANDS: Brand[] = ['Fresh', 'Style', 'Tech']

export function Capacity() {
  const d = useOps((s) => s.data)
  const [depot, setDepot] = useState<Depot>('Peliyagoda')
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hover, setHover] = useState<number | null>(null)
  const rows = useMemo(() => demandForecast(d, colomboDate(opNow(d))), [d])
  const reefer = useMemo(() => weeklyReeferCapacity(d, depot), [d, depot])
  const weeks = useMemo(() => {
    const keys = [...new Set(rows.map((r) => `${r.iso_year}-${r.iso_week}`))]
    return keys.map((k) => {
      const [y, w] = k.split('-').map(Number)
      const mine = rows.filter((r) => r.depot === depot && r.iso_year === y && r.iso_week === w)
      return {
        key: k,
        week: w,
        year: y,
        total: Math.round(mine.reduce((s, r) => s + r.pred_total_volume_m3, 0)),
        chilled: Math.round(mine.reduce((s, r) => s + r.pred_chilled_volume_m3, 0)),
        byBrand: Object.fromEntries(BRANDS.map((b) => [b, mine.find((r) => r.brand === b)])) as Record<Brand, (typeof rows)[number] | undefined>,
        note: mine.find((r) => r.note)?.note,
      }
    })
  }, [rows, depot])
  const source = rows.some((r) => r.source === 'model') ? 'model' : 'placeholder'
  const short = weeks.filter((w) => w.chilled > reefer)
  const peak = weeks.reduce((a, b) => (b.total > a.total ? b : a), weeks[0])

  // SVG chart geometry
  const W = 720
  const H = 260
  const pad = { l: 44, r: 12, t: 12, b: 28 }
  const max = Math.max(...weeks.map((w) => w.total), reefer) * 1.1
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const bw = (W - pad.l - pad.r) / weeks.length

  return (
    <>
      <PageHeader
        eyebrow="Planning ahead"
        title="Capacity forecast"
        subtitle="Weekly order volume per depot and brand for the next ten weeks — to plan vehicles, drivers and refrigerated capacity ahead of paydays and festivals."
        actions={
          <Segmented
            value={depot}
            onChange={setDepot}
            options={[
              { value: 'Peliyagoda', label: 'Peliyagoda' },
              { value: 'Kandy', label: 'Kandy' },
            ]}
          />
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Next week" value={`${weeks[0]?.total ?? 0} m³`} sub={`${weeks[0]?.chilled ?? 0} m³ chilled`} />
        <Stat label="Peak week" value={`W${peak?.week}`} sub={`${peak?.total} m³${peak?.note ? ` · ${peak.note}` : ''}`} tone="brand" icon={<TrendingUp className="size-4" />} />
        <Stat label="Reefer capacity" value={`${reefer} m³`} sub="per week · usable reefers × 1.5 trips × 6 days" tone="info" icon={<Snowflake className="size-4" />} />
        <Stat label="Weeks short on reefer" value={short.length} sub={short.length ? short.map((w) => `W${w.week}`).join(', ') : 'none'} tone={short.length ? 'attention' : 'success'} />
      </div>
      {short.length > 0 && (
        <Callout tone="attention" title={`Chilled demand exceeds ${depot} reefer capacity in ${short.length} week${short.length > 1 ? 's' : ''}`} className="mb-6">
          Book rental reefers, release the recovery reserve for those weeks, or move chilled deliveries to second Fresh trips for W{short.map((w) => w.week).join(', W')}.
        </Callout>
      )}
      <Card>
        <CardHeader
          eyebrow={
            <span className="inline-flex items-center gap-2">
              Next 10 weeks · {depot} <ModelChip source={source} />
            </span>
          }
          title="Total and chilled volume (m³)"
          action={<Segmented size="sm" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: <span className="inline-flex items-center gap-1"><Table2 className="size-3.5" /> Table</span> }]} />}
        />
        {view === 'chart' ? (
          <div className="p-5">
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
              <Legend color="var(--series-ambient)" label="Ambient (total − chilled)" />
              <Legend color="var(--series-chilled)" label="Chilled" icon />
              <span className="inline-flex items-center gap-2">
                <span className="h-0 w-5 border-t-2 border-dashed border-ink" /> Reefer capacity
              </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Weekly forecast for ${depot}`} onMouseLeave={() => setHover(null)}>
              {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
                <g key={v}>
                  <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                  <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                    {v}
                  </text>
                </g>
              ))}
              {weeks.map((w, i) => {
                const x = pad.l + i * bw + bw * 0.22
                const width = bw * 0.56
                return (
                  <g key={w.key} onMouseEnter={() => setHover(i)} opacity={hover !== null && hover !== i ? 0.45 : 1}>
                    <rect x={x} y={y(w.total)} width={width} height={y(w.chilled) - y(w.total)} rx="3" fill="var(--series-ambient)" />
                    <rect x={x} y={y(w.chilled)} width={width} height={y(0) - y(w.chilled)} fill="var(--series-chilled)" />
                    <text x={x + width / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--muted)">
                      W{w.week}
                    </text>
                    {w.note && <circle cx={x + width / 2} cy={H - 2} r="2" fill="var(--attention)" />}
                    {hover === i && (
                      <text x={x + width / 2} y={y(w.total) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">
                        {w.total} · {w.chilled} chilled
                      </text>
                    )}
                  </g>
                )
              })}
              <line x1={pad.l} x2={W - pad.r} y1={y(reefer)} y2={y(reefer)} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="5 4" />
              <text x={W - pad.r} y={y(reefer) - 5} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--ink)">
                Reefer capacity {reefer}
              </text>
            </svg>
            <p className="mt-2 text-xs text-muted">Dots mark festival or payday weeks. Values are pred_total_volume_m3 and pred_chilled_volume_m3 (Datathon Task 2A); placeholder estimates until the team’s model is loaded.</p>
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">ISO week</th>
                  {BRANDS.map((b) => (
                    <th key={b} className="px-4 py-2.5 font-semibold">
                      <BrandTag brand={b} /> total · chilled
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-semibold">Depot total</th>
                  <th className="px-4 py-2.5 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {weeks.map((w) => (
                  <tr key={w.key}>
                    <td className="px-4 py-2.5 font-semibold">
                      {w.year}-W{w.week}
                    </td>
                    {BRANDS.map((b) => (
                      <td key={b} className="px-4 py-2.5">
                        {w.byBrand[b]?.pred_total_volume_m3 ?? '—'} <span className="text-muted">· {w.byBrand[b]?.pred_chilled_volume_m3 ?? 0}</span>
                      </td>
                    ))}
                    <td className={cn('px-4 py-2.5 font-semibold', w.chilled > reefer && 'text-attention-ink')}>
                      {w.total} <span className="font-normal text-muted">· {w.chilled} chilled</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{w.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function niceStep(max: number) {
  const raw = max / 5
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
}

const Legend = ({ color, label, icon }: { color: string; label: string; icon?: boolean }) => (
  <span className="inline-flex items-center gap-2">
    <span className="size-2.5 rounded-sm" style={{ background: color }} />
    {icon && <Snowflake className="size-3 text-info" />}
    {label}
  </span>
)
