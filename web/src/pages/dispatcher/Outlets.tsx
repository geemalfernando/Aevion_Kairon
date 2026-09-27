import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Card, PageHeader, StatusBadge } from '../../components/ui'
import { fmtWindow } from '@core/time'
import { useOps } from '../../store'

export function Outlets() {
  const d = useOps((s) => s.data)
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return d.outlets.filter((o) => !s || [o.id, o.name, o.district, o.brand].some((x) => x.toLowerCase().includes(s)))
  }, [d, q])
  return (
    <>
      <PageHeader eyebrow="Operations" title="Outlets" subtitle={`${d.outlets.length} outlets across ${new Set(d.outlets.map((o) => o.district)).size} districts`} />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search outlet, brand, district…" className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm focus:border-brand focus:outline-none" />
      </div>
      <Card className="overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                {['Outlet', 'Brand', 'District · Depot', 'Window', 'Access', 'Last served', 'Deferrals', "Today's order"].map((h) => (
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
                  <tr key={o.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <span className="id">{o.id}</span>
                      <span className="block text-xs text-muted">{o.name}</span>
                    </td>
                    <td className="px-4 py-3">{o.brand}</td>
                    <td className="px-4 py-3">
                      {o.district} <span className="text-muted">· {o.depot}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{fmtWindow(o.window)}</td>
                    <td className="px-4 py-3">{o.vanOnly ? <Badge tone="warning">Van only</Badge> : o.mall ? <Badge tone="info">Mall bay</Badge> : <span className="text-muted">Any</span>}</td>
                    <td className="px-4 py-3">{o.lastServedDaysAgo} d ago</td>
                    <td className="px-4 py-3">{o.deferralsThisWeek ? <Badge tone="attention">{o.deferralsThisWeek}</Badge> : <span className="text-muted">0</span>}</td>
                    <td className="px-4 py-3">{order ? <StatusBadge s={order.status} /> : <span className="text-faint">No order</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
