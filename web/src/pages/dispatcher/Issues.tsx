import { AlertTriangle, ArrowLeft, Check, Clock, Snowflake, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { RouteMap } from '../../components/RouteMap'
import { Badge, Button, Callout, Card, CardHeader, cn, EmptyState, PageHeader, Segmented, SeverityBadge, severityTone, toast, toneBorder } from '../../components/ui'
import { recoveryPlan } from '@core/rules'
import { isReefer, vehicleLabel } from '@core/rules'
import { fmtClock, fmtMin, timeAgo } from '@core/time'
import type { Issue } from '@core/types'
import { orderOf, outletOf, scheduleOf, tripOf, vehicleOf } from '../../lib/select'
import { opMinutes } from '@core/ops'
import { ops, useNow, useOps } from '../../store'
import { severityRank } from '@core/ops'
import { DeferModal } from './shared'

export function Issues() {
  const d = useOps((s) => s.data)
  const now = useNow()
  const [show, setShow] = useState<'open' | 'resolved'>('open')
  const list = d.issues.filter((i) => (show === 'open' ? !i.resolved : i.resolved)).sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.createdAt - a.createdAt)
  return (
    <>
      <PageHeader
        eyebrow="Monitoring"
        title="Issue center"
        subtitle="Every exception, in one severity language — info, warning, high, critical."
        actions={<Segmented value={show} onChange={setShow} options={[{ value: 'open', label: `Active (${d.issues.filter((i) => !i.resolved).length})` }, { value: 'resolved', label: 'Resolved' }]} />}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<Check className="size-5" />} title={show === 'open' ? 'No active issues' : 'Nothing resolved yet'} body="Vehicle breakdowns, loading shortfalls, late risks and store reports land here." />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((i) => (
            <Link key={i.id} to={`/dispatcher/issues/${i.id}`} className="block">
              <Card className={cn('flex flex-wrap items-center gap-4 border-l-4 p-4 transition hover:shadow-pop', toneBorder[severityTone[i.severity]])}>
                <SeverityBadge s={i.severity} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{i.title}</div>
                  <div className="text-sm text-muted">{i.resolved ? i.resolved.decision : i.detail}</div>
                </div>
                <span className="text-xs text-faint">{timeAgo(i.createdAt, now)}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

export function IssueDetail() {
  const { id } = useParams()
  const d = useOps((s) => s.data)
  const now = useNow()
  // /dispatcher/issues/breakdown opens the latest open breakdown (stable link for previews).
  const i = d.issues.find((x) => x.id === id) ?? (id === 'breakdown' ? d.issues.find((x) => x.kind === 'BREAKDOWN' || x.kind === 'REEFER_FAILURE') : undefined)
  if (!i) return <EmptyState icon={<AlertTriangle className="size-5" />} title="Issue not found" />
  return (
    <>
      <Link to="/dispatcher/issues" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Issue center
      </Link>
      {i.resolved && (
        <Callout tone="success" icon={<Check className="size-5" />} title="Resolved" className="mb-6">
          {i.resolved.decision} · {timeAgo(i.resolved.at, now)}
        </Callout>
      )}
      {i.kind === 'BREAKDOWN' || i.kind === 'REEFER_FAILURE' ? <Incident i={i} /> : i.kind === 'SHORTFALL' ? <Shortfall i={i} /> : i.kind === 'LATE_RISK' ? <LateRisk i={i} /> : <Generic i={i} />}
    </>
  )
}

function Incident({ i }: { i: Issue }) {
  const d = useOps((s) => s.data)
  const navigate = useNavigate()
  const trip = tripOf(d, i.tripId)
  const v = vehicleOf(d, i.vehicleId)!
  const plan = trip && !i.resolved ? recoveryPlan(trip.id, d, opMinutes(d)) : null
  const affected = i.orderIds ?? []
  const chilled = affected.some((id) => orderOf(d, id)?.temp === 'CHILLED')
  return (
    <>
      <PageHeader eyebrow={<span className="text-critical-ink">Critical incident · {fmtClock(i.createdAt)}</span>} title={<span><span className="id">{v.id}</span> {i.kind === 'REEFER_FAILURE' ? 'refrigeration failure' : 'vehicle breakdown'}</span>} subtitle={`${vehicleLabel(v.type)} · ${v.driver} · ${affected.length} stops affected${chilled ? ' · chilled goods onboard' : ''}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        <Card className="self-start">
          <CardHeader title="Affected stops" eyebrow={trip ? `${trip.id}` : undefined} />
          {trip && (
            <div className="border-b border-line p-4">
              <RouteMap
                className="h-64"
                routes={[
                  {
                    id: trip.id,
                    depot: v.depot,
                    color: 'var(--critical)',
                    stops: trip.stops
                      .concat(affected.filter((x) => !trip.stops.includes(x)))
                      .map((id) => {
                        const o = orderOf(d, id)!
                        return { outlet: d.outlets.find((x) => x.id === o.outletId)!, state: affected.includes(id) ? 'problem' : 'done' }
                      }),
                    vehicle: { label: `${v.id} · stopped`, at: Math.max(0, trip.stops.length - affected.length) },
                  },
                ]}
              />
            </div>
          )}
          <ul className="divide-y divide-line">
            {affected.map((oid) => {
              const o = orderOf(d, oid)!
              const now = tripOf(d, o.tripId)
              return (
                <li key={oid} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>
                    <span className="id">{o.outletId}</span>
                    {o.temp === 'CHILLED' && <Snowflake className="ml-1.5 inline size-3.5 text-info" />}
                  </span>
                  <span className="text-xs text-muted">{now && now.vehicleId !== v.id ? `→ ${now.vehicleId}` : o.status === 'DEFERRED' ? 'Deferred' : 'Awaiting'}</span>
                </li>
              )
            })}
          </ul>
        </Card>
        <div className="space-y-4">
          {plan && (
            <>
              <div className="eyebrow">Recovery options</div>
              {plan.options.map((opt) => {
                const rv = vehicleOf(d, opt.vehicleId)!
                return (
                  <Card key={opt.vehicleId} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Truck className="size-4 text-brand-ink" />
                          <span className="id text-lg">{rv.id}</span>
                          {rv.reserve && <Badge tone="info">Recovery reserve</Badge>}
                        </div>
                        <div className="text-sm text-muted">
                          {vehicleLabel(rv.type)} · {rv.driver}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-2xl font-semibold text-attention-ink">+{opt.delayMin} min</div>
                        <div className="text-xs text-muted">estimated recovery</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {opt.checks.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 text-success-ink">
                          <Check className="size-3.5" strokeWidth={3} /> {c}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 text-sm">
                      <span className="text-muted">Can absorb </span>
                      {opt.orderIds.map((oid) => (
                        <span key={oid} className="id mr-2">
                          {orderOf(d, oid)!.outletId}
                        </span>
                      ))}
                    </div>
                  </Card>
                )
              })}
              {plan.defer.map((oid) => (
                <Callout key={oid} tone="attention" icon={<Clock className="size-5" />} title={`${orderOf(d, oid)!.outletId} — no feasible replacement before window close`}>
                  Recommendation: <b>DEFER</b>. The store will be told why and given high priority for the next run.
                </Callout>
              ))}
              {plan.options.length === 0 && plan.defer.length === 0 && <Callout tone="success" title="All stops already delivered">Nothing to recover.</Callout>}
              <Button
                size="lg"
                block
                onClick={() => {
                  ops('applyRecovery', i.id)
                  toast('Recovery plan applied', { body: 'Drivers, loaders and stores have been notified.' })
                  navigate('/dispatcher/live')
                }}
              >
                Apply recovery plan
              </Button>
            </>
          )}
          {!trip && <Callout tone="info" title="No active trip">This vehicle had no trip in progress when the issue was reported.</Callout>}
        </div>
      </div>
      {isReefer(v.type) && i.kind === 'REEFER_FAILURE' && <p className="mt-4 text-sm text-muted">Chilled goods should not continue until a reefer takes over — rescue options only include refrigerated vehicles.</p>}
    </>
  )
}

function Shortfall({ i }: { i: Issue }) {
  const d = useOps((s) => s.data)
  const o = orderOf(d, i.orderIds?.[0])!
  const decide = (decision: string) => {
    ops('resolveIssue', i.id, decision)
    toast(`Decision sent: ${decision}`, { body: 'Loader and store have been notified.' })
  }
  return (
    <>
      <PageHeader eyebrow={<span className="text-attention-ink">High · loading shortfall</span>} title={<span className="id">{o.outletId}</span>} subtitle={`${outletOf(d, o.outletId)?.name} · ${o.id} · ${tripOf(d, o.tripId)?.vehicleId ?? ''}`} />
      <Card className="max-w-2xl p-6">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Metric label="Expected" value={o.items.find((x) => x.name === o.shortfall?.item)?.qty ?? 0} sub={o.shortfall?.item} />
          <Metric label="Available" value={(o.items.find((x) => x.name === o.shortfall?.item)?.qty ?? 0) - (o.shortfall?.missing ?? 0)} />
          <Metric label="Shortfall" value={o.shortfall?.missing ?? 0} tone="text-attention-ink" />
        </div>
        <p className="mt-4 text-sm">
          <span className="text-muted">Reason: </span>
          {o.shortfall?.reason}
        </p>
        {!i.resolved && (
          <>
            <div className="eyebrow mb-2 mt-6">Decision</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => decide('Continue delivery')}>Continue delivery</Button>
              <Button variant="secondary" onClick={() => decide('Modify order')}>
                Modify order
              </Button>
              <Button variant="secondary" onClick={() => decide('Replace stock')}>
                Replace stock
              </Button>
              <Button variant="attention" onClick={() => decide('Defer order')}>
                Defer order
              </Button>
            </div>
          </>
        )}
      </Card>
    </>
  )
}

function LateRisk({ i }: { i: Issue }) {
  const d = useOps((s) => s.data)
  const [deferring, setDeferring] = useState(false)
  const o = orderOf(d, i.orderIds?.[0])!
  const t = tripOf(d, o.tripId)
  const st = t ? scheduleOf(d, t).stops.find((x) => x.orderId === o.id) : undefined
  return (
    <>
      <PageHeader eyebrow={<span className="text-attention-ink">High · missed window risk</span>} title={<span className="id">{o.outletId}</span>} subtitle={i.detail} />
      <Card className="max-w-2xl p-6">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Metric label="Window closes" value={st ? fmtMin(st.window[1]) : '—'} />
          <Metric label="Projected arrival" value={st ? fmtMin(st.eta + 18) : '—'} />
          <Metric label="Past close" value={st ? `${Math.max(0, Math.round(st.eta + 18 - st.window[1]))} min` : '—'} tone="text-attention-ink" />
        </div>
        {!i.resolved && (
          <>
            <Callout tone="info" title="Recommended: contact outlet" className="mt-6">
              Ask whether the receiving team can accept a late delivery. Alternative: defer or reschedule.
            </Callout>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => (ops('resolveIssue', i.id, 'Outlet contacted — late delivery accepted'), toast('Marked as handled'))}>Outlet agreed to receive</Button>
              <Button variant="secondary" onClick={() => setDeferring(true)}>
                Defer / reschedule
              </Button>
            </div>
          </>
        )}
      </Card>
      <DeferModal
        order={o}
        open={deferring}
        onClose={() => {
          setDeferring(false)
          if (orderOf(useOps.getState().data, o.id)?.status === 'DEFERRED') ops('resolveIssue', i.id, 'Order deferred')
        }}
      />
    </>
  )
}

function Generic({ i }: { i: Issue }) {
  return (
    <>
      <PageHeader eyebrow={<SeverityBadge s={i.severity} />} title={i.title} subtitle={i.detail} />
      {!i.resolved && (
        <Card className="max-w-xl p-6">
          <div className="eyebrow mb-3">Resolve</div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => (ops('resolveIssue', i.id, 'Acknowledged'), toast('Issue resolved'))}>Acknowledge</Button>
            {i.kind === 'STORE_ISSUE' && (
              <Button variant="secondary" onClick={() => (ops('resolveIssue', i.id, 'Credit note raised'), toast('Credit note raised'))}>
                Raise credit note
              </Button>
            )}
            {i.kind === 'DELIVERY_FAILED' && (
              <Button variant="secondary" onClick={() => (ops('resolveIssue', i.id, 'Rescheduled for next run'), toast('Rescheduled'))}>
                Reschedule next run
              </Button>
            )}
          </div>
        </Card>
      )}
    </>
  )
}

function Metric({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('font-display text-2xl font-semibold tabular-nums', tone)}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  )
}
