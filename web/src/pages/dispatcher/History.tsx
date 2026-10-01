import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AuditTimeline } from '../../components/AuditTimeline'
import { Card, CardHeader, PageHeader } from '../../components/ui'
import { useOps } from '../../store'

export function History() {
  const d = useOps((s) => s.data)
  const [q, setQ] = useState('ORD')
  const [entity, setEntity] = useState<string | null>(null)
  const entities = useMemo(() => {
    const s = q.trim().toUpperCase()
    const set = new Map<string, number>()
    for (const e of d.audit) if (!s || e.entity.includes(s)) set.set(e.entity, Math.max(set.get(e.entity) ?? 0, e.at))
    return [...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)
  }, [d, q])
  const chosen = entity ?? entities[0]?.[0]
  const events = d.audit.filter((e) => e.entity === chosen).sort((a, b) => a.at - b.at)
  return (
    <>
      <PageHeader eyebrow="Records" title="History & audit trail" subtitle="Every order, vehicle and decision has a timeline — no handwritten notes." />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="self-start">
          <div className="border-b border-line p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => (setQ(e.target.value), setEntity(null))} placeholder="ORD1456, VEH014…" className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm focus:border-brand focus:outline-none" />
            </div>
          </div>
          <ul className="scroll-thin max-h-[60dvh] overflow-y-auto p-2">
            {entities.map(([id]) => (
              <li key={id}>
                <button onClick={() => setEntity(id)} className={`id w-full rounded-md px-3 py-2 text-left text-sm ${id === chosen ? 'bg-brand-soft text-brand-ink' : 'hover:bg-surface-2'}`}>
                  {id}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={<span className="id">{chosen ?? '—'}</span>} eyebrow="Timeline" />
          <div className="p-5">
            <AuditTimeline events={events} />
          </div>
        </Card>
      </div>
    </>
  )
}
