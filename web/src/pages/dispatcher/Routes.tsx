import { ArrowLeft, ArrowRightLeft, CheckCircle2, CloudOff, Fuel, LifeBuoy, Phone, Route as RouteIcon, Snowflake } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { tripPredictions } from '@core/predict'
import { BUDGET, budgetGroup, byId, isReefer, moveOptions, stayEstimate, vehicleLabel } from '@core/rules'
import { opMinutes } from '@core/ops'
import { fmtClock, fmtMin, fmtWindow, timeAgo } from '@core/time'
import type { Trip } from '@core/types'
import { AuditTimeline } from '../../components/AuditTimeline'
import { RouteMap } from '../../components/RouteMap'
import { Badge, BrandTag, Button, Callout, Card, CardHeader, cn, EmptyState, Field, Meter, ModelChip, Modal, PageHeader, Segmented, StatusBadge, Textarea, toast, type Tone } from '../../components/ui'
import { MODAL, STOP } from '../../demo/mode'
import { auditFor, isDone, orderOf, outletOf, scheduleOf, tripProgress, vehicleOf } from '../../lib/select'
import { ops, useOps } from '../../store'

export const tripTone: Record<Trip['status'], Tone> = {
  DRAFT: 'neutral',
  PLANNED: 'brand',
  LOADING: 'attention',
  LOADED: 'info',
  IN_PROGRESS: 'info',
  PAUSED: 'critical',
  COMPLETED: 'success',
  ABORTED: 'neutral',
}
export const tripLabel = (s: Trip['status']) => s.replace('_', ' ').toLowerCase()

export function RoutesPage() {
  const d = useOps((s) => s.data)
  const [brand, setBrand] = useState<'all' | 'Fresh' | 'Style' | 'Tech'>('all')
  const trips = useMemo(() => d.trips.filter((t) => t.stops.length && (brand === 'all' || t.brand === brand)).sort((a, b) => a.departure - b.departure || a.vehicleId.localeCompare(b.vehicleId)), [d, brand])
  return (
    <>
      <PageHeader eyebrow="Operations" title="Routes" subtitle={`${trips.length} trips${d.plan === 'DRAFT' ? ' · draft plan' : ''}`} actions={<Segmented value={brand} onChange={setBrand} options={['all', 'Fresh', 'Style', 'Tech'].map((b) => ({ value: b as typeof brand, label: b === 'all' ? 'All' : b }))} />} />
      {trips.length === 0 ? (
        <Card>
          <EmptyState icon={<RouteIcon className="size-5" />} title="No routes yet" body="Routes appear once orders are allocated in Planning." action={<Link to="/dispatcher/planning" className="text-sm font-semibold text-brand-ink">Open planning</Link>} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {trips.map((t) => {
            const s = scheduleOf(d, t)
            const v = vehicleOf(d, t.vehicleId)!
            const p = tripProgress(d, t)
            return (
              <Link key={t.id} to={`/dispatcher/routes/${t.id}`} className="group">
                <Card className="h-full p-5 transition group-hover:border-brand">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="id text-lg">{t.vehicleId}</span>
                        {isReefer(v.type) && <Snowflake className="size-4 text-info" />}
                        {t.rescue && <Badge tone="info">Rescue</Badge>}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-muted">
                        Trip {t.number} · <BrandTag brand={t.brand} /> · {t.district}
                      </div>
                    </div>
                    <Badge tone={t.pendingChange ? 'attention' : tripTone[t.status]} dot>
                      {t.pendingChange ? 'loader re-check' : tripLabel(t.status)}
                    </Badge>
                  </div>
                  <div className="mt-4 flex items-baseline justify-between text-sm">
                    <span>
                      <span className="font-display text-xl font-semibold">{fmtMin(t.departure)}</span> <span className="text-muted">departure</span>
                    </span>
                    <span className="text-muted">
                      {s.minutes} min · finish {fmtMin(s.finish)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {t.stops.map((id, i) => {
                      const o = orderOf(d, id)!
                      return (
                        <span key={id} className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[11px]', isDone(o) ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line')}>
                          {i + 1}·{o.outletId}
                        </span>
                      )
                    })}
                  </div>
                  <Meter className="mt-4" label={`${p.done}/${p.total} stops`} value={s.volumeM3} max={v.capacityM3} detail={`${s.volumeM3}/${v.capacityM3} m³`} />
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}

export function RouteDetail() {
  const { tripId } = useParams()
  const d = useOps((s) => s.data)
  const t = d.trips.find((x) => x.id === tripId)
  const onRoad = t && ['IN_PROGRESS', 'PAUSED'].includes(t.status)
  const [moving, setMoving] = useState<string | null>(() => {
    if (MODAL !== 'move-stop' || !t) return null
    const open = t.stops.filter((id) => !isDone(orderOf(d, id)))
    return open.find((id) => orderOf(d, id)?.outletId === STOP) ?? open.at(-1) ?? null
  })
  if (!t) return <EmptyState icon={<RouteIcon className="size-5" />} title="Route not found" />
  const v = vehicleOf(d, t.vehicleId)!
  const s = scheduleOf(d, t)
  const preds = tripPredictions(d, t.id)
  const firstOpen = t.stops.findIndex((id) => !isDone(orderOf(d, id)))
  const g = budgetGroup(t.brand)
  const lastSeen = d.presence['driver@kairon.demo']
  return (
    <>
      <Link to="/dispatcher/routes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Routes
      </Link>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            Trip {t.number} · <BrandTag brand={t.brand} /> · {t.district}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="id">{t.vehicleId}</span>
            <Badge tone={t.pendingChange ? 'attention' : tripTone[t.status]} dot>
              {t.pendingChange ? 'awaiting loader re-check' : tripLabel(t.status)}
            </Badge>
            {t.rescue && <Badge tone="info">Rescue from {t.rescue.from}</Badge>}
          </span>
        }
        subtitle={`${vehicleLabel(v.type)} · ${v.driver} · departs ${fmtMin(t.departure)} · expected finish ${fmtMin(s.finish)}${onRoad && t.vehicleId === 'VEH014' && lastSeen ? ` · driver last heard from ${timeAgo(lastSeen, Date.now())}` : ''}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <RouteMap
            className="aspect-[4/3]"
            routes={[
              {
                id: t.id,
                depot: v.depot,
                stops: t.stops.map((id, i) => {
                  const o = orderOf(d, id)!
                  return { outlet: outletOf(d, o.outletId)!, state: isDone(o) ? (o.status === 'FAILED' ? 'problem' : 'done') : i === firstOpen && t.status === 'IN_PROGRESS' ? 'current' : 'todo' }
                }),
                vehicle: t.status === 'IN_PROGRESS' ? { label: t.vehicleId, at: firstOpen } : undefined,
              },
            ]}
          />
          <Card className="grid gap-3 p-5 sm:grid-cols-3">
            <Meter label="Weight" value={s.weightKg} max={v.capacityKg} detail={`${s.weightKg} / ${v.capacityKg} kg`} />
            <Meter label="Volume" value={s.volumeM3} max={v.capacityM3} detail={`${s.volumeM3} / ${v.capacityM3} m³`} />
            <Meter label="Trip minutes (of vehicle budget)" value={s.minutes} max={BUDGET[g]} detail={`${s.minutes} / ${BUDGET[g]} min`} />
            <p className="text-xs text-muted sm:col-span-3">
              Trip time = {s.outbound} outbound + {s.interStop} between stops + {s.handling} handling = <b>{s.minutes} min</b> (no return leg; the budget allows for it).
            </p>
          </Card>
          {(t.changes?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Changes to this trip" eyebrow="Audit" />
              <ul className="divide-y divide-line">
                {t.changes!.map((c) => (
                  <li key={c.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{c.reason}</span>
                      {c.ackAt ? (
                        <Badge tone="success">
                          <CheckCircle2 className="size-3" /> {c.phase === 'route' ? 'Driver' : 'Loader'} confirmed {fmtClock(c.ackAt)}
                        </Badge>
                      ) : (
                        <Badge tone="attention">Not yet seen by the {c.phase === 'route' ? 'driver' : 'loader'}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted">
                      {fmtClock(c.at)} · {c.removed.map((r) => `${orderOf(d, r.orderId)?.outletId ?? r.orderId} → ${r.to ?? 'next run'}`).join(', ')}
                      {c.added.length ? ` · added ${c.added.map((id) => orderOf(d, id)?.outletId).join(', ')}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="Stop list" eyebrow={`${s.stops.length} stops`} action={<ModelChip />} />
          <ol className="divide-y divide-line">
            {s.stops.map((st, i) => {
              const o = orderOf(d, st.orderId)!
              const out = outletOf(d, st.outletId)!
              const p = preds[st.orderId]
              return (
                <li key={st.orderId} className="flex gap-4 px-5 py-4">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-xs font-semibold">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="id">
                        {out.id} {o.temp === 'CHILLED' && <Snowflake className="inline size-3.5 text-info" />}
                      </span>
                      <StatusBadge s={o.status} />
                    </div>
                    <div className="text-xs text-muted">{out.name}</div>
                    <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <dt className="text-muted">ETA</dt>
                        <dd className="font-semibold tabular-nums">{fmtMin(st.eta)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Window</dt>
                        <dd className="font-semibold tabular-nums">{fmtWindow(st.window)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Service</dt>
                        <dd className="font-semibold">
                          {st.service}
                          <span className="font-normal text-muted"> · ~{p ? Math.round(p.serviceMin) : '—'}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Late risk</dt>
                        <dd className={cn('font-semibold', p && p.lateProb >= 0.45 ? 'text-critical-ink' : p && p.lateProb >= 0.2 ? 'text-attention-ink' : '')}>{p ? `${Math.round(p.lateProb * 100)}%` : '—'}</dd>
                      </div>
                    </dl>
                    {onRoad && !isDone(o) && o.status !== 'ARRIVED' && (
                      <Button size="sm" variant="secondary" className="mt-2" icon={<ArrowRightLeft className="size-3.5" />} onClick={() => setMoving(o.id)}>
                        Move stop
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          <p className="border-t border-line px-5 py-2 text-[11px] text-muted">Service shows the allowance · ~model estimate. Late risk is pred_late_prob (Datathon slot; placeholder until the model is loaded).</p>
          <div className="border-t border-line p-5">
            <div className="eyebrow mb-3">Vehicle log</div>
            <AuditTimeline events={auditFor(d, t.vehicleId).slice(-8)} />
          </div>
        </Card>
      </div>
      {moving && <MoveStopModal orderId={moving} onClose={() => setMoving(null)} />}
    </>
  )
}

/**
 * Take a stop off a vehicle that is already on the road. The goods are re-picked at the depot and leave
 * on a vehicle that isn't on the road; the driver's phone learns about it on its next sync.
 * A driver going quiet is normal, so the dialog compares staying with moving and recommends moving only
 * when the driver reported a problem that makes the stop late and the other vehicle is actually earlier.
 */
function MoveStopModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const d = useOps((s) => s.data)
  const o = orderOf(d, orderId)!
  const out = outletOf(d, o.outletId)!
  const trip = byId(d.trips, o.tripId)!
  const driver = vehicleOf(d, trip.vehicleId)!.driver
  const lastSeen = trip.vehicleId === 'VEH014' ? d.presence['driver@kairon.demo'] : undefined
  const quiet = lastSeen ? Math.round((Date.now() - lastSeen) / 60_000) : 0
  const options = useMemo(() => moveOptions(orderId, d, opMinutes(d)), [orderId, d])
  const stay = useMemo(() => stayEstimate(orderId, d), [orderId, d])
  const feasible = options.filter((x) => x.validation.ok)
  const [pick, setPick] = useState<string | null>(feasible[0]?.vehicle.id ?? null)
  const [reason, setReason] = useState(() =>
    stay?.delay && stay.late ? `${stay.delay.note ?? 'Road blocked'} — ${driver} reported ~${stay.delay.minutes} min delay, would miss the ${fmtMin(stay.windowClose)} window.` : '',
  )
  const chosen = options.find((x) => x.vehicle.id === pick)
  // Worth moving only if staying is late and the other vehicle arrives earlier, inside the window.
  const worth = !!(stay?.late && chosen?.validation.ok && chosen.gain > 0 && chosen.eta <= stay.windowClose)
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      eyebrow={`${trip.vehicleId} is on the road`}
      title={`Move ${out.id} to another vehicle?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {worth ? 'Cancel' : `Keep on ${trip.vehicleId}`}
          </Button>
          <Button
            variant={worth ? 'primary' : 'secondary'}
            disabled={!chosen?.validation.ok || !reason.trim()}
            icon={<ArrowRightLeft className="size-4" />}
            onClick={() => {
              const r = ops('moveStop', orderId, pick!, reason.trim())
              if (r.ok) toast(`${out.id} moved to ${pick}`, { body: `Leaves the depot ${fmtMin(chosen!.departure)}, arrives ~${fmtMin(r.eta)}. ${driver} sees it on the next sync; the loader re-picks the goods.` })
              else toast('Could not move the stop', { tone: 'critical', body: r.message })
              onClose()
            }}
          >
            {worth ? 'Move stop' : 'Move anyway'}
          </Button>
        </>
      }
    >
      {stay && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={cn('rounded-xl border p-4', stay.late ? 'border-critical/50 bg-critical-soft/40' : 'border-line')}>
            <div className="eyebrow">Stay on {trip.vehicleId}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold tabular-nums">{fmtMin(stay.eta)}</span>
              <Badge tone={stay.late ? 'critical' : 'success'}>{stay.late ? `after the ${fmtMin(stay.windowClose)} close` : `window closes ${fmtMin(stay.windowClose)}`}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted">{stay.delay ? `Planned ${fmtMin(stay.planned)} + ${stay.delay.minutes} min delay ${driver} reported at ${fmtClock(stay.delay.at)}` : `Planned arrival · no problem reported`}</p>
            {stay.delay?.note && <p className="mt-2 text-sm">“{stay.delay.note}”</p>}
            {quiet > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <CloudOff className="size-3.5" /> No signal for {quiet} min — normal on this route; the phone keeps recording.
              </p>
            )}
          </div>
          <div className={cn('rounded-xl border p-4', worth ? 'border-brand bg-brand-soft/50' : 'border-line')}>
            <div className="eyebrow">Move to {chosen?.vehicle.id ?? 'another vehicle'}</div>
            {chosen?.validation.ok ? (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-semibold tabular-nums">{fmtMin(chosen.eta)}</span>
                  <Badge tone={chosen.gain > 0 ? 'success' : 'attention'}>{chosen.gain > 0 ? `${chosen.gain} min sooner` : `${-chosen.gain} min later`}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">Re-picked at {out.depot}, leaves {fmtMin(chosen.departure)}</p>
                <p className="mt-2 flex items-center gap-1.5 text-sm">
                  <Fuel className="size-4 text-steel" /> +{chosen.km} km · ~{chosen.fuelL} L fuel
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">No vehicle at the depot can reach {out.id} inside its window.</p>
            )}
          </div>
        </div>
      )}
      <Callout tone={worth ? 'brand' : 'attention'} className="mt-3" title={worth ? 'Recommended: move it' : `Recommended: keep it on ${trip.vehicleId}`}>
        {worth
          ? `Staying misses the window by ${Math.round(stay!.eta - stay!.windowClose)} min; ${chosen!.vehicle.id} arrives ${chosen!.gain} min sooner, inside the window. Worth the extra ${chosen!.km} km for chilled goods a supermarket needs before opening.`
          : stay?.delay
            ? `Even with the reported delay ${driver} should arrive inside the window, and a rescue trip would burn fuel for nothing.`
            : `${driver} hasn’t reported a problem. Being offline alone isn’t a reason to move a stop — drivers keep working without signal and their records sync later.`}
      </Callout>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
        <span className="min-w-0 flex-1">
          <b>Try {driver} first.</b> A call or SMS often gets through where mobile data doesn’t. The change is also sent to the phone by SMS.
        </span>
        <Button size="sm" variant="secondary" icon={<Phone className="size-3.5" />} onClick={() => toast(`Calling ${driver}…`, { body: 'No answer — the call is logged on the trip.' })}>
          Call {driver}
        </Button>
      </div>
      <Callout tone="info" className="mt-3" title="No wasted trip if the delivery syncs first">
        {chosen?.validation.ok ? `${chosen.vehicle.id} leaves at ${fmtMin(chosen.departure)} after the re-pick. ` : ''}If {driver}’s phone syncs a delivery of {out.id} before then, the re-pick is cancelled and {chosen?.vehicle.id ?? 'the vehicle'} stays at the depot. {driver} keeps the original goods on board and returns them.
      </Callout>
      <div className="mt-4 grid gap-2">
        {options.slice(0, 4).map((x) => {
          const late = x.validation.checks.find((c) => !c.ok && c.blocking)
          return (
            <button
              key={x.vehicle.id}
              disabled={!x.validation.ok}
              onClick={() => setPick(x.vehicle.id)}
              className={cn('flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60', pick === x.vehicle.id ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface-2')}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="id">{x.vehicle.id}</span>
                  {isReefer(x.vehicle.type) && <Snowflake className="size-3.5 text-info" />}
                  {x.vehicle.reserve && (
                    <Badge tone="info">
                      <LifeBuoy className="size-3" /> Reserve
                    </Badge>
                  )}
                </span>
                <span className="block text-xs text-muted">
                  {vehicleLabel(x.vehicle.type)} · {x.vehicle.driver} · leaves {fmtMin(x.departure)}
                  {x.validation.ok && ` · +${x.km} km · ~${x.fuelL} L`}
                </span>
                {late && <span className="mt-0.5 block text-xs text-critical-ink">{late.label}: {late.detail}</span>}
              </span>
              {x.validation.ok && (
                <span className="text-right">
                  <span className="block font-display text-lg font-semibold tabular-nums">{fmtMin(x.eta)}</span>
                  <span className={cn('text-xs', x.gain > 0 ? 'text-brand-ink' : 'text-attention-ink')}>{x.gain > 0 ? `${x.gain} min sooner` : `${-x.gain} min later`} than staying</span>
                </span>
              )}
            </button>
          )
        })}
      </div>
      <Field label="Reason (the driver, loader and store see this)" className="mt-4">
        {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" />}
      </Field>
    </Modal>
  )
}
