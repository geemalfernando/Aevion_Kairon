import { CheckCircle2, CloudOff, Radar, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { tripPredictions } from '@core/predict'
import { opMinutes } from '@core/ops'
import { districtOf } from '@core/rules'
import { fmtClock, fmtMin, timeAgo } from '@core/time'
import { RouteMap } from '../../components/RouteMap'
import { Badge, Button, Card, CardHeader, cn, EmptyState, ModelChip, PageHeader, toast } from '../../components/ui'
import { isDone, orderOf, outletOf, scheduleOf, vehicleOf } from '../../lib/select'
import { ops, useNow, useOps } from '../../store'

export function Live() {
  const d = useOps((s) => s.data)
  const now = useNow()
  const nowMin = opMinutes(d, now)
  const [focus, setFocus] = useState<string | null>(null)
  const active = useMemo(() => d.trips.filter((t) => ['IN_PROGRESS', 'PAUSED'].includes(t.status)), [d])
  const dayTrips = d.trips.filter((t) => t.status !== 'DRAFT' && t.status !== 'ABORTED')
  const completed = d.orders.filter((o) => isDone(o)).length
  const remaining = dayTrips.flatMap((t) => t.stops).filter((id) => !isDone(orderOf(d, id))).length
  const issues = d.issues.filter((i) => !i.resolved).length
  const driverSeen = d.presence['driver@kairon.demo']
  const quiet = driverSeen && Date.now() - driverSeen > 90_000

  const rows = active.map((t) => {
    const s = scheduleOf(d, t)
    const nextIdx = t.stops.findIndex((id) => !isDone(orderOf(d, id)))
    return { t, s, nextIdx, next: s.stops[nextIdx], v: vehicleOf(d, t.vehicleId)!, preds: tripPredictions(d, t.id) }
  })

  return (
    <>
      <PageHeader
        eyebrow="Monitoring"
        title="Live operations"
        actions={
          d.plan === 'PUBLISHED' &&
          active.length < 2 && (
            <Button variant="secondary" onClick={() => (ops('simulateFleet', 'VEH014'), toast('Fleet dispatched', { body: 'Demo: other vehicles are now on the road' }))}>
              Simulate fleet departure
            </Button>
          )
        }
      />
      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {[
          [active.length, 'vehicles active', 'bg-info'],
          [completed, 'deliveries completed', 'bg-brand'],
          [remaining, 'remaining', 'bg-steel'],
          [issues, 'issues', issues ? 'bg-critical' : 'bg-steel'],
        ].map(([n, l, c]) => (
          <span key={l as string} className="inline-flex items-center gap-2">
            <span className={cn('size-2.5 rounded-full', c as string)} />
            <b className="font-display text-lg">{n}</b> <span className="text-muted">{l}</span>
          </span>
        ))}
      </div>

      {d.syncLog.length > 0 && (
        <Card className="mb-6">
          <CardHeader eyebrow="Field devices" title="Back online" action={<span className="text-xs text-muted">Offline records replayed in order; nothing a driver recorded is lost</span>} />
          <ul className="divide-y divide-line">
            {d.syncLog.slice(0, 4).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5 text-sm">
                <span className="grid size-9 place-items-center rounded-full bg-info-soft text-info-ink">
                  <RefreshCw className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">
                    {r.name} · <span className="id">{r.vehicleId ?? r.role}</span>
                  </span>
                  <span className="block text-muted">
                    Offline {fmtClock(r.offlineFrom)}–{fmtClock(r.syncedAt)} ({Math.max(1, Math.round((r.syncedAt - r.offlineFrom) / 60_000))} min) · {r.events} records synced · {r.deliveries} deliveries
                    {r.conflicts.length ? ` · ${r.conflicts.length} delivered before a reassignment (driver's record kept)` : ''}
                  </span>
                </span>
                {r.routeChanged &&
                  (r.ackAt ? (
                    <Badge tone="success">
                      <CheckCircle2 className="size-3" /> Driver saw the route change {fmtClock(r.ackAt)}
                    </Badge>
                  ) : (
                    <Badge tone="attention">Route change shown · awaiting driver</Badge>
                  ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {active.length === 0 ? (
        <Card>
          <EmptyState icon={<Radar className="size-5" />} title="No vehicles on the road yet" body="Vehicles appear here as soon as drivers start their routes. Publish the plan, load VEH014 as the loader, and start the route as the driver." />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <RouteMap
            className="aspect-[4/3] xl:sticky xl:top-24"
            outlets={d.outlets}
            routes={rows.map(({ t, v, nextIdx }) => ({
              id: t.id,
              depot: v.depot,
              highlight: focus ? focus === t.id : undefined,
              color: t.status === 'PAUSED' ? 'var(--critical)' : t.vehicleId === 'VEH014' ? 'var(--attention)' : 'var(--brand)',
              stops: t.stops.map((id, i) => {
                const o = orderOf(d, id)!
                return { outlet: outletOf(d, o.outletId)!, state: isDone(o) ? (o.status === 'FAILED' ? 'problem' : 'done') : i === nextIdx ? 'current' : 'todo' }
              }),
              vehicle: t.status === 'IN_PROGRESS' && nextIdx >= 0 ? { label: t.vehicleId, at: nextIdx } : undefined,
            }))}
          />
          <Card>
            <CardHeader title="Vehicles" eyebrow={`${rows.length} on the road`} action={<ModelChip />} />
            <ul className="divide-y divide-line">
              {rows.map(({ t, next, s, preds }) => {
                const done = t.stops.filter((id) => isDone(orderOf(d, id))).length
                const risk = next ? preds[next.orderId]?.lateProb : undefined
                const offline = t.vehicleId === 'VEH014' && quiet
                return (
                  <li key={t.id} onMouseEnter={() => setFocus(t.id)} onMouseLeave={() => setFocus(null)}>
                    <Link to={`/dispatcher/routes/${t.id}`} className="block px-5 py-4 hover:bg-surface-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="id">{t.vehicleId}</span>
                        {t.status === 'PAUSED' ? (
                          <Badge tone="critical" dot>
                            Stopped
                          </Badge>
                        ) : offline ? (
                          <Badge tone="neutral">
                            <CloudOff className="size-3" /> No signal · last seen {timeAgo(driverSeen, Date.now())}
                          </Badge>
                        ) : (
                          <Badge tone="info" dot>
                            In transit
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <div className="text-muted">Next</div>
                          <div className="id">{next ? next.outletId : '—'}</div>
                        </div>
                        <div>
                          <div className="text-muted">ETA</div>
                          <div className="font-semibold tabular-nums">{next ? fmtMin(t.status === 'IN_PROGRESS' ? Math.max(next.eta, Math.round(nowMin + districtOf(d, t.district).inter_stop_freeflow_min)) : next.eta) : '—'}</div>
                        </div>
                        <div>
                          <div className="text-muted">Late risk</div>
                          <div className={cn('font-semibold', risk !== undefined && risk >= 0.45 ? 'text-critical-ink' : risk !== undefined && risk >= 0.2 ? 'text-attention-ink' : '')}>{risk !== undefined ? `${Math.round(risk * 100)}%` : '—'}</div>
                        </div>
                        <div>
                          <div className="text-muted">Progress</div>
                          <div className="font-semibold">
                            {done}/{s.stops.length}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <p className="border-t border-line px-5 py-2 text-[11px] text-muted">Operation clock {fmtClock(now)}</p>
          </Card>
        </div>
      )}
    </>
  )
}
