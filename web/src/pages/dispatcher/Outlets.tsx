import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { OutletMap } from '../../components/RouteMap'
import { Badge, Card, cn, PageHeader, Segmented, Select, StatusBadge } from '../../components/ui'
import { fmtWindow } from '@core/time'
import type { Brand } from '@core/types'
import { useOps } from '../../store'

export function Outlets() {
  const d = useOps((s) => s.data)
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [brand, setBrand] = useState<'all' | Brand>('all')
  const [district, setDistrict] = useState('')
  const [selected, setSelected] = useState<string | undefined>(params.get('q') ?? undefined)
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return d.outlets.filter((o) => (!s || [o.id, o.name, o.district, o.brand].some((x) => x.toLowerCase().includes(s))) && (brand === 'all' || o.brand === brand) && (!district || o.district === district))
  }, [d, q, brand, district])

  const flagged = useMemo(() => new Set(d.orders.filter((o) => o.status === 'DEFERRED' || o.status === 'FAILED').map((o) => o.outletId)), [d])
  const districts = [...new Set(d.outlets.map((o) => o.district))]

  useEffect(() => {
    if (selected) rowRefs.current[selected]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  return (
    <>
      <PageHeader eyebrow="Operations" title="Outlets" subtitle={`${d.outlets.length} outlets across ${districts.length} districts · served from Peliyagoda and Kandy`} />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search outlet, district…" className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm focus:border-brand focus:outline-none" />
        </div>
        <Segmented value={brand} onChange={setBrand} options={(['all', 'Fresh', 'Style', 'Tech'] as const).map((b) => ({ value: b, label: b === 'all' ? 'All brands' : b }))} />
        <Select value={district} onChange={(e) => setDistrict(e.target.value)} className="w-auto" aria-label="District">
          <option value="">All districts</option>
          {districts.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <OutletMap
          outlets={rows}
          selected={selected}
          onSelect={setSelected}
          flagged={flagged}
          flaggedLabel="Deferred or failed today"
          className="h-[420px] xl:sticky xl:top-24 xl:h-[calc(100dvh-220px)]"
          describe={(o) => `${o.district} · ${fmtWindow(o.window)}${o.vanOnly ? ' · van only' : ''}`}
        />

        <Card className="overflow-hidden">
          <div className="scroll-thin max-h-[calc(100dvh-220px)] overflow-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 text-left text-xs text-muted">
                <tr>
                  {['Outlet', 'Brand', 'District', 'Window', 'Access', "Today's order"].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((o) => {
                  const order = d.orders.find((x) => x.outletId === o.id)
                  return (
                    <tr
                      key={o.id}
                      ref={(el) => {
                        rowRefs.current[o.id] = el
                      }}
                      onClick={() => setSelected(o.id)}
                      className={cn('cursor-pointer transition', selected === o.id ? 'bg-brand-soft' : 'hover:bg-surface-2')}
                    >
                      <td className="px-4 py-3">
                        <span className="id">{o.id}</span>
                        <span className="block text-xs text-muted">{o.name}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`km-outlet km-${o.brand.toLowerCase()} km-shape-${o.brand === 'Fresh' ? 'circle' : o.brand === 'Style' ? 'square' : 'diamond'}`} style={{ ['--s' as string]: '9px', margin: 0 }} />
                          {o.brand}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {o.district} <span className="block text-xs text-muted">{o.depot}</span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{fmtWindow(o.window)}</td>
                      <td className="px-4 py-3">{o.vanOnly ? <Badge tone="warning">Van only</Badge> : o.mall ? <Badge tone="info">Mall bay</Badge> : <span className="text-muted">Any</span>}</td>
                      <td className="px-4 py-3">{order ? <StatusBadge s={order.status} /> : <span className="text-faint">No order</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="p-10 text-center text-sm text-muted">No outlets match.</p>}
          </div>
        </Card>
      </div>
    </>
  )
}
