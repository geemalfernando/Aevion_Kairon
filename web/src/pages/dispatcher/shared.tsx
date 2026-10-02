import { Ban, Clock, Fuel, Lock, LockOpen, Scale, Snowflake, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { tripPredictions } from '@core/predict'
import { customerMessageFor, DEFERRAL_LABEL, suggestVehicles, validate, vehicleLabel, type Validation } from '@core/rules'
import { fmtMin, fmtWindow } from '@core/time'
import type { DeferralCode, Order } from '@core/types'
import { AuditTimeline } from '../../components/AuditTimeline'
import { LocationMap } from '../../components/RouteMap'
import { Badge, BrandTag, Button, CheckRow, ChoiceList, cn, Field, IconButton, ModelChip, Modal, StatusBadge, TempTag, Textarea, toast } from '../../components/ui'
import { auditFor, outletOf, tripOf } from '../../lib/select'
import { ops, useOps } from '../../store'

const REASONS: DeferralCode[] = ['reefer_capacity', 'van_capacity', 'vehicle_capacity', 'delivery_window', 'time_budget', 'fuel_quota', 'dispatcher_choice']

export function DeferModal({ order, open, onClose }: { order?: Order; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState<DeferralCode | null>(order?.deferral?.code ?? null)
  const [message, setMessage] = useState(order?.deferral?.customerMessage ?? '')
  const [note, setNote] = useState('')
  if (!order) return null
  const pick = (r: DeferralCode) => {
    setReason(r)
    setMessage(customerMessageFor(r))
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={`Order ${order.id} · ${order.outletId}`}
      title="Confirm deferral"
      tone="attention"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="attention"
            disabled={!reason || !message.trim()}
            onClick={() => {
              ops('defer', order.id, reason!, DEFERRAL_LABEL[reason!], message.trim(), note.trim() || undefined)
              toast(`${order.id} deferred`, { tone: 'attention', body: 'The store has been notified with your explanation.' })
              onClose()
            }}
          >
            Confirm deferral
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {order.deferral?.detail && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <div className="text-xs font-semibold text-muted">Planner found</div>
            {order.deferral.detail}
          </div>
        )}
        <div>
          <div className="mb-2 text-sm font-medium">Reason</div>
          <ChoiceList name="Deferral reason" columns={2} value={reason} onChange={pick} options={REASONS.map((r) => ({ value: r, label: DEFERRAL_LABEL[r] }))} />
        </div>
        <Field label="Customer-facing explanation" hint="The store manager sees exactly this text.">
          {(id) => <Textarea id={id} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your delivery has been rescheduled because…" />}
        </Field>
        <Field label="Internal note">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />}</Field>
      </div>
    </Modal>
  )
}

const CHECK_ICON: Partial<Record<string, typeof Ban>> = { temperature: Snowflake, access: Truck, weight: Scale, volume: Scale, budget: Clock, window: Clock, fuel: Fuel }

/** Friendly headline for the first blocking constraint. Hard constraints can't be overridden. */
export function blockedHeadline(v: Validation, order: Order, vehicleId: string, vehicleType: string) {
  const first = v.checks.find((c) => c.blocking && !c.ok)!
  const icon = CHECK_ICON[first.key] ?? Ban
  switch (first.key) {
    case 'access':
      return { title: `${order.outletId} is van only`, body: `${vehicleId} is a ${vehicleType.toLowerCase()} — trucks can't reach this outlet.`, icon }
    case 'temperature':
      return { title: `${order.outletId} is a chilled order`, body: `Chilled goods need a reefer. ${vehicleId} is a ${vehicleType.toLowerCase()}.`, icon }
    case 'volume':
    case 'weight':
      return { title: 'Capacity exceeded', body: `${vehicleId} · ${first.label}: ${first.detail}.`, icon }
    case 'budget':
      return { title: 'Out of time budget', body: `${first.detail}. Budgets are per vehicle per day: 270 Fresh minutes, 480 Style + Tech minutes.`, icon }
    case 'trips':
      return { title: 'Two trips already', body: `${vehicleId} ${first.detail.toLowerCase()}. A vehicle runs at most two trips a day.`, icon }
    case 'window':
      return { title: 'A delivery window would be missed', body: first.detail, icon }
    case 'fuel':
      return { title: 'Weekly fuel quota', body: `This allocation projects ${first.detail}.`, icon }
    default:
      return { title: 'Cannot assign order', body: `${first.label}: ${first.detail}`, icon }
  }
}

export function BlockedModal({ state, onClose, onPick }: { state: { order: Order; vehicleId: string; v: Validation } | null; onClose: () => void; onPick: (vehicleId: string) => void }) {
  const d = useOps((s) => s.data)
  if (!state) return null
  const vehicle = d.vehicles.find((v) => v.id === state.vehicleId)!
  const h = blockedHeadline(state.v, state.order, vehicle.id, vehicleLabel(vehicle.type))
  const suggestions = suggestVehicles(state.order, d, vehicle.id)
  return (
    <Modal open onClose={onClose} eyebrow="Blocked" title={h.title} tone="critical" footer={<Button variant="secondary" onClick={onClose}>Choose another vehicle</Button>}>
      <p className="flex items-start gap-2 text-sm">
        <h.icon className="mt-0.5 size-4 shrink-0" /> {h.body}
      </p>
      <p className="mt-1 text-xs text-muted">No “continue anyway”: operating constraints can’t be overridden.</p>
      <div className="mt-4 rounded-xl border border-line p-3">
        {state.v.checks.map((c) => (
          <CheckRow key={c.key} ok={c.ok} warn={!c.blocking} label={c.label} detail={c.detail} />
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-2">Vehicles that fit</div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s.id} onClick={() => onPick(s.id)} className="rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-left text-sm hover:border-brand">
                <span className="id block text-brand-ink">{s.id}</span>
                <span className="text-xs text-muted">{vehicleLabel(s.type)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Try an allocation; returns the validation so callers can show success or the blocked dialog. */
export function tryAssign(order: Order, vehicleId: string) {
  const d = useOps.getState().data
  const v = d.vehicles.find((x) => x.id === vehicleId)!
  const trip = tripOf(d, order.tripId)
  const pre = validate(order, v, { ...d, trips: d.trips.map((t) => (t.id === trip?.id ? { ...t, stops: t.stops.filter((s) => s !== order.id) } : t)) })
  if (!pre.ok) return pre
  if (v.reserve && !confirm(`${v.id} is held in reserve for breakdown recovery. Use it anyway? Nothing would be left to rescue a broken-down reefer.`)) return pre
  const r = ops('assign', order.id, vehicleId)
  if (r.ok) {
    const target = useOps.getState().data.trips.find((t) => t.vehicleId === vehicleId && t.stops.includes(order.id))
    toast(`${order.outletId} → ${vehicleId}`, { body: target?.pendingChange ? 'Loading had started — the loader must confirm the change.' : `${r.checks.find((c) => c.key === 'volume')!.detail} · ${r.checks.find((c) => c.key === 'budget')!.detail}` })
  }
  return r
}

export function OrderDrawer({ order, onClose, onDefer }: { order?: Order; onClose: () => void; onDefer: (o: Order) => void }) {
  const d = useOps((s) => s.data)
  const [allocating, setAllocating] = useState(false)
  const [blocked, setBlocked] = useState<{ order: Order; vehicleId: string; v: Validation } | null>(null)
  if (!order) return null
  const o = d.orders.find((x) => x.id === order.id) ?? order
  const out = outletOf(d, o.outletId)!
  const trip = tripOf(d, o.tripId)
  const pred = trip ? tripPredictions(d, trip.id)[o.id] : undefined
  const suggestions = allocating ? suggestVehicles(o, d, undefined, 5) : []
  const assign = (vid: string) => {
    const r = tryAssign(o, vid)
    if (!r.ok) setBlocked({ order: o, vehicleId: vid, v: r })
    else setAllocating(false)
  }
  const canAct = ['CONFIRMED', 'PLANNED', 'DEFERRED', 'LOADED'].includes(o.status) && (!trip || ['DRAFT', 'PLANNED', 'LOADING', 'LOADED'].includes(trip.status))
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal aria-label={`Order ${o.id}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-lg animate-rise flex-col border-l border-line bg-surface shadow-pop">
        <div className="flex items-start justify-between border-b border-line px-6 py-5">
          <div>
            <div className="eyebrow mb-1">Order details</div>
            <h2 className="flex items-center gap-3 text-xl font-semibold">
              <span className="id">{o.id}</span> <StatusBadge s={o.status} />
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
              {out.name} · <span className="id">{out.id}</span> <BrandTag brand={o.brand} /> <TempTag temp={o.temp} />
            </p>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="scroll-thin flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ['Size', `${o.volumeM3} m³ · ${o.weightKg} kg`],
              ['Units', o.units],
              ['District', `${out.district} · ${out.depot}`],
              ['Access', out.vanOnly ? 'Van only' : out.mall ? 'Mall dock' : 'Any vehicle'],
              ['Dock', out.dock.replace('_', ' ')],
              ['Requested window', fmtWindow(out.requestedWindow)],
              ...(out.mallWindow ? [['Mall window', fmtWindow(out.mallWindow)]] : []),
              ['Effective window', fmtWindow(out.window)],
              ['Vehicle', trip ? `${trip.vehicleId} · Trip ${trip.number}` : '—'],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {pred && (
            <div className="rounded-xl border border-dashed border-line-strong p-3 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted">Datathon predictions</span>
                <ModelChip source={pred.source} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted">pred_service_min</div>
                  <div className="font-semibold">{pred.serviceMin} min</div>
                </div>
                <div>
                  <div className="text-xs text-muted">pred_late_prob</div>
                  <div className={cn('font-semibold', pred.lateProb >= 0.45 && 'text-critical-ink')}>{Math.round(pred.lateProb * 100)}%</div>
                </div>
              </div>
            </div>
          )}
          <div>
            <div className="eyebrow mb-2">Priority {o.priority}</div>
            <ul className="space-y-1 text-sm">
              {(o.priorityWhy ?? []).map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="text-muted">·</span> {w}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <Badge>Last delivery {out.lastServedDaysAgo} d ago</Badge>
              {out.deferredYesterday && <Badge tone="attention">Skipped on the previous run</Badge>}
              {!!out.deferralsThisWeek && <Badge tone="attention">{out.deferralsThisWeek} deferrals this week</Badge>}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-2">Items</div>
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {o.items.map((i) => (
                <li key={i.name} className="flex justify-between px-3 py-2">
                  {i.name}
                  <span className="tabular-nums text-muted">
                    {i.qty} {i.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <LocationMap outlet={out} depot={out.depot} vehicle={o.status === 'IN_TRANSIT' ? trip?.vehicleId : undefined} className="h-48" />
          {o.deferral && (
            <div className="rounded-xl border border-attention/40 bg-attention-soft p-4 text-sm">
              <div className="font-semibold text-attention-ink">
                {o.deferral.confirmed ? 'Deferred' : 'Proposed deferral'} · {o.deferral.reason}
              </div>
              {o.deferral.detail && <p className="mt-1">{o.deferral.detail}</p>}
              <p className="mt-2 text-xs text-muted">Store sees: “{o.deferral.customerMessage}”</p>
              <p className="mt-1 text-xs text-muted">Next run: {o.deferral.nextRecommendation}</p>
            </div>
          )}
          {allocating && (
            <div>
              <div className="eyebrow mb-2">Vehicles that fit</div>
              {suggestions.length === 0 && <p className="text-sm text-muted">No vehicle can take this order without breaking a constraint.</p>}
              <div className="grid gap-2">
                {suggestions.map((v) => (
                  <button key={v.id} onClick={() => assign(v.id)} className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left text-sm hover:border-brand hover:bg-brand-soft">
                    <span>
                      <span className="id">{v.id}</span> <span className="text-muted">· {vehicleLabel(v.type)} · {v.driver}</span>
                    </span>
                    <span className="text-xs font-semibold text-brand-ink">Assign</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="eyebrow mb-3">Audit trail</div>
            <AuditTimeline events={auditFor(d, o.id)} />
          </div>
        </div>
        {canAct && (
          <div className="flex gap-2 border-t border-line bg-surface-2/60 px-6 py-4">
            <Button onClick={() => setAllocating((a) => !a)} className="flex-1">
              {o.tripId ? 'Reallocate' : 'Allocate'}
            </Button>
            {o.status !== 'DEFERRED' || !o.deferral?.confirmed ? (
              <Button variant="secondary" className="flex-1" onClick={() => onDefer(o)}>
                Defer
              </Button>
            ) : null}
            {trip && (
              <Button
                variant="secondary"
                className="flex-1"
                icon={o.lock ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                onClick={() => {
                  const r = o.lock ? ops('unlockStop', o.id) : ops('lockStop', o.id)
                  if (r.ok) toast(o.lock ? `${out.id} unlocked` : `${out.id} locked to ${trip.vehicleId}`, { tone: 'neutral', body: o.lock ? 'Re-planning may move it again.' : 'Re-planning keeps it on this vehicle at the same time.' })
                  else toast(r.message, { tone: 'critical' })
                }}
              >
                {o.lock ? 'Unlock' : `Lock to ${trip.vehicleId}`}
              </Button>
            )}
          </div>
        )}
        {trip && ['IN_PROGRESS', 'PAUSED'].includes(trip.status) && !['DELIVERED', 'RECEIVED', 'PARTIAL', 'FAILED'].includes(o.status) && (
          <p className="border-t border-line bg-surface-2/60 px-6 py-3 text-xs text-muted">
            On the road since {trip.startedAt ? fmtMin(trip.departure) : '—'} — use <b>Move stop</b> on the route to send it on another vehicle.
          </p>
        )}
      </aside>
      <BlockedModal state={blocked} onClose={() => setBlocked(null)} onPick={(vid) => (setBlocked(null), assign(vid))} />
    </div>
  )
}
