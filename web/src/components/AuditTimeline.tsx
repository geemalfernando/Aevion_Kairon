import { fmtClock, fmtDate } from '@core/time'
import type { AuditEvent } from '@core/types'
import { ROLE_LABEL } from './shell/nav'

export function AuditTimeline({ events, empty = 'No recorded events yet.' }: { events: AuditEvent[]; empty?: string }) {
  if (!events.length) return <p className="text-sm text-muted">{empty}</p>
  const days = events.map((e) => fmtDate(new Date(e.at), { day: 'numeric', month: 'short' }))
  return (
    <ol className="relative border-l-2 border-line pl-5">
      {events.map((e, i) => {
        const day = days[i]
        const showDay = i === 0 || day !== days[i - 1]
        return (
          <li key={e.id} className="relative pb-4 last:pb-0">
            {showDay && <div className="eyebrow -ml-5 mb-2 bg-surface pl-5 !text-[10px]">{day}</div>}
            <span className="absolute -left-[27px] top-1.5 size-3 rounded-full border-2 border-surface bg-brand" />
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono text-xs font-semibold tabular-nums text-muted">{fmtClock(e.at)}</span>
              <span className="text-sm">{e.text}</span>
            </div>
            <div className="text-[11px] text-faint">{e.actor === 'SYSTEM' ? 'System' : ROLE_LABEL[e.actor]}</div>
          </li>
        )
      })}
    </ol>
  )
}
