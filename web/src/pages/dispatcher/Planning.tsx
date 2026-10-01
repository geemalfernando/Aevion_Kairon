import { CalendarClock, Check, ChevronDown, GripVertical, LifeBuoy, Lock, Repeat, Scale, Send, Snowflake, Sparkles, Truck, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BUDGET, DEFERRAL_LABEL, FRESH_END, isReefer, isVan, validate, vehicleDay, vehicleLabel, type Validation } from '@core/rules'
import { fmtMin } from '@core/time'
import type { Order, PlanAnalysis, Trip, Vehicle } from '@core/types'
import { Badge, BrandTag, Button, Callout, Card, CheckRow, cn, EmptyState, Meter, Modal, PageHeader, Segmented, TempTag, toast } from '../../components/ui'
import { outletOf, scheduleOf } from '../../lib/select'
import { MODAL } from '../../demo/mode'
import { ops, useOps } from '../../store'
import { BlockedModal, DeferModal, OrderDrawer, tryAssign } from './shared'

type Filter = 'used' | 'idle' | 'reefer' | 'van' | 'all'

export function Planning() {
  const d = useOps((s) => s.data)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<{ order: Order; vehicleId: string; v: Validation } | null>(() => (MODAL === 'blocked' ? demoBlocked(d) : null))
  const [filter, setFilter] = useState<Filter>('used')
  const [tab, setTab] = useState<'unassigned' | 'plan' | 'deferred'>('plan')
  const [generating, setGenerating] = useState(false)
  const [drawer, setDrawer] = useState<Order>()
  const [deferring, setDeferring] = useState<Order>()

  const unassigned = d.orders.filter((o) => o.status === 'CONFIRMED' && !o.tripId && o.deliveryDate === d.deliveryDate).sort((a, b) => b.priority - a.priority)
  const deferred = d.orders.filter((o) => o.status === 'DEFERRED' && o.deliveryDate === d.deliveryDate).sort((a, b) => Number(!!b.deferral?.repeat) - Number(!!a.deferral?.repeat) || b.priority - a.priority)
  const active = (o?: string | null) => (o ? d.orders.find((x) => x.id === o) : undefined)
  const moving = active(dragging ?? selected)

  const vehicles = useMemo(() => {
    const withTrips = new Set(d.trips.filter((t) => t.status !== 'ABORTED' && t.stops.length).map((t) => t.vehicleId))
    return d.vehicles
      .filter((v) => (filter === 'used' ? withTrips.has(v.id) : filter === 'reefer' ? isReefer(v.type) : filter === 'van' ? isVan(v.type) : filter === 'idle' ? !withTrips.has(v.id) && v.status === 'AVAILABLE' : true))
      .sort((a, b) => Number(b.status === 'AVAILABLE') - Number(a.status === 'AVAILABLE') || Number(withTrips.has(b.id)) - Number(withTrips.has(a.id)) || a.id.localeCompare(b.id))
  }, [d, filter])

  const summary = useMemo(() => {
    const trips = d.trips.filter((t) => t.status !== 'ABORTED' && t.stops.length)
    let vol = 0
    let cap = 0
    for (const t of trips) {
      vol += scheduleOf(d, t).volumeM3
      cap += d.vehicles.find((x) => x.id === t.vehicleId)!.capacityM3
    }
    return { served: d.orders.filter((o) => o.tripId && o.deliveryDate === d.deliveryDate).length, trips: trips.length, vehicles: new Set(trips.map((t) => t.vehicleId)).size, util: cap ? (vol / cap) * 100 : 0 }
  }, [d])

  const assign = (orderId: string, vehicleId: string) => {
    const o = active(orderId)
    if (!o) return
    const r = tryAssign(o, vehicleId)
    if (!r.ok) setBlocked({ order: o, vehicleId, v: r })
    setSelected(null)
  }

  useEffect(() => {
    if (filter === 'used' && vehicles.length === 0 && d.plan !== 'NONE') setFilter('all')
  }, [d.plan, filter, vehicles.length])

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Planning"
        subtitle="Drag orders onto vehicles — every allocation is checked against capacity, temperature, access, windows, time budgets and fuel before it’s saved."
        actions={
          <>
            <Button variant="secondary" icon={<Sparkles className="size-4" />} disabled={!d.ordersClosed} onClick={() => setGenerating(true)}>
              {d.plan === 'NONE' ? 'Generate recommended plan' : 'Re-plan'}
            </Button>
            {d.plan === 'DRAFT' && (
              <Button
                icon={<Send className="size-4" />}
                onClick={() => {
                  ops('publishPlan')
                  toast('Plan published', { body: 'Loaders, drivers and stores have been notified.' })
                }}
              >
                Publish plan
              </Button>
            )}
            {d.plan === 'PUBLISHED' && (
              <Badge tone="success" dot>
                Published
              </Badge>
            )}
          </>
        }
      />

      {!d.ordersClosed && (
        <Callout
          tone="info"
          icon={<Lock className="size-5" />}
          title="Orders are still open"
          className="mb-4"
          action={
            <Link to="/dispatcher/orders?close=1">
              <Button size="sm">Close orders</Button>
            </Link>
          }
        >
          Close orders at the 16:00 cutoff to generate the recommended plan. You can still allocate manually.
        </Callout>
      )}

      <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-fill px-3 py-1 text-white">
          <Truck className="size-3.5" /> Max 2 trips per vehicle / day
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-attention-fill px-3 py-1 text-white">
          <Snowflake className="size-3.5" /> Fresh delivered before 08:00
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-bg">Trip 2 leaves after Trip 1 returns</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ['Served', summary.served, ''],
          ['Deferred', deferred.length, deferred.length ? 'text-attention-ink' : ''],
          ['Vehicles', summary.vehicles, ''],
          ['Trips', summary.trips, ''],
          ['Volume utilisation', `${summary.util.toFixed(0)}%`, 'text-brand-ink'],
        ].map(([l, v, c]) => (
          <div key={l as string} className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="text-xs text-muted">{l}</div>
            <div className={cn('font-display text-xl font-semibold tabular-nums', c as string)}>{v}</div>
          </div>
        ))}
      </div>

      {d.analysis && d.plan !== 'NONE' && <ConstraintPanel a={d.analysis} />}

      {moving && selected && (
        <div className="sticky top-16 z-20 mb-3 flex items-center gap-3 rounded-xl border border-brand bg-brand-soft px-4 py-2.5 text-sm shadow-card">
          <span className="flex-1">
            Assigning <b className="id">{moving.outletId}</b> — tap a vehicle below.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
            Cancel
          </Button>
        </div>
      )}

      <div className="mb-3 xl:hidden">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'unassigned', label: `Unassigned (${unassigned.length})` },
            { value: 'plan', label: 'Vehicle plan' },
            { value: 'deferred', label: `Deferred (${deferred.length})` },
          ]}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)_320px]">
        <Column title="Unassigned orders" count={unassigned.length} className={cn(tab !== 'unassigned' && 'hidden xl:flex')}>
          {unassigned.length === 0 ? (
            <EmptyState icon={<Check className="size-5" />} title="Queue is clear" body={d.plan === 'NONE' ? 'Generate a plan or allocate orders manually.' : 'Every order is allocated or deferred.'} />
          ) : (
            unassigned.map((o) => <OrderCard key={o.id} o={o} selected={selected === o.id} onSelect={() => (setSelected(selected === o.id ? null : o.id), setTab('plan'))} onOpen={() => setDrawer(o)} onDrag={setDragging} />)
          )}
        </Column>

        <div className={cn('min-w-0', tab !== 'plan' && 'hidden xl:block')}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Vehicle plan</h2>
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'used', label: 'In plan' },
                { value: 'idle', label: 'Idle' },
                { value: 'reefer', label: 'Reefer' },
                { value: 'van', label: 'Vans' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          {vehicles.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Truck className="size-5" />}
                title="No vehicles in the plan yet"
                body="Generate the recommended plan, or drag an order onto an idle vehicle."
                action={
                  <Button variant="secondary" onClick={() => setFilter('idle')}>
                    Show idle vehicles
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-3 2xl:grid-cols-2">
              {vehicles.map((v) => (
                <VehicleCard key={v.id} v={v} moving={moving} onDrop={(oid) => assign(oid, v.id)} onOpen={(o) => setDrawer(o)} />
              ))}
            </div>
          )}
        </div>

        <Column title="Deferred to the next run" count={deferred.length} tone="attention" className={cn(tab !== 'deferred' && 'hidden xl:flex')}>
          {deferred.length === 0 ? (
            <EmptyState icon={<CalendarClock className="size-5" />} title="Nothing deferred" />
          ) : (
            deferred.map((o) => (
              <div key={o.id} className={cn('rounded-lg border bg-surface p-3', o.deferral?.repeat ? 'border-critical/60' : 'border-attention/40')}>
                <OrderCard o={o} compact selected={selected === o.id} onSelect={() => setSelected(selected === o.id ? null : o.id)} onOpen={() => setDrawer(o)} onDrag={setDragging} />
                {o.deferral?.repeat && (
                  <div className="mt-2 inline-flex items-center gap-1 rounded bg-critical-soft px-1.5 py-0.5 text-[11px] font-semibold text-critical-ink">
                    <Repeat className="size-3" /> Skipped yesterday too
                  </div>
                )}
                <div className="mt-2 text-xs font-semibold text-attention-ink">{o.deferral?.reason}</div>
                {o.deferral?.detail && <p className="mt-0.5 text-xs text-muted">{o.deferral.detail}</p>}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => (setSelected(o.id), setTab('plan'))}>
                    Reallocate
                  </Button>
                  {!o.deferral?.confirmed ? (
                    <Button size="sm" variant="attention" className="flex-1" onClick={() => (ops('confirmDeferral', o.id), toast(`${o.outletId} deferral confirmed`, { tone: 'attention', body: 'The store has been notified.' }))}>
                      Confirm
                    </Button>
                  ) : (
                    <Badge tone="attention" className="self-center">
                      Confirmed
                    </Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </Column>
      </div>

      <BlockedModal state={blocked} onClose={() => setBlocked(null)} onPick={(vid) => blocked && (setBlocked(null), assign(blocked.order.id, vid))} />
      <GeneratePlanModal open={generating} onClose={() => setGenerating(false)} />
      <OrderDrawer order={drawer} onClose={() => setDrawer(undefined)} onDefer={(o) => (setDrawer(undefined), setDeferring(o))} />
      <DeferModal key={deferring?.id} order={deferring} open={!!deferring} onClose={() => setDeferring(undefined)} />
    </>
  )
}

/** ?modal=blocked: a deferred chilled order dropped on an available dry-box truck. */
function demoBlocked(d: ReturnType<typeof useOps.getState>['data']) {
  const order = d.orders.find((o) => o.status === 'DEFERRED' && o.temp === 'CHILLED') ?? d.orders.find((o) => o.temp === 'CHILLED')
  const truck = order && d.vehicles.find((v) => v.depot === d.outlets.find((x) => x.id === order.outletId)?.depot && v.temp === 'ambient' && v.kind === 'truck' && v.status === 'AVAILABLE')
  return order && truck ? { order, vehicleId: truck.id, v: validate(order, truck, d) } : null
}

const POLICY = [
  ['1', 'Outlets skipped on the previous run', 'No outlet is deferred twice in a row if any vehicle can take it.'],
  ['2', 'Chilled Fresh', 'Perishable and must be on the shelf before stores open at 08:00; only reefers can carry it.'],
  ['3', 'Fresh dry goods', 'Daily replenishment; any dry-box truck can carry it.'],
  ['4', 'Tech', 'High-value, customer-promised items; fewer, heavier orders.'],
  ['5', 'Style', 'Weekly replenishment that can move a day with the least harm (except seasonal peaks).'],
]

/** What limited today's plan, what it cost, and the trade-off the dispatcher controls. */
function ConstraintPanel({ a }: { a: PlanAnalysis }) {
  const [policy, setPolicy] = useState(false)
  const binding = a.binding ? DEFERRAL_LABEL[a.binding] : null
  return (
    <Card className="mb-4 overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[1.1fr_1.4fr]">
        <div className="border-b border-line p-5 lg:border-b-0 lg:border-r">
          <div className="eyebrow">What limited today</div>
          <div className="mt-1 font-display text-xl font-semibold">{binding ? `${binding} — ${a.byCode[a.binding!]} of ${a.deferred} deferrals` : 'Every order fits today'}</div>
          <p className="mt-1 text-sm text-muted">
            {a.served} orders served, {a.deferred} moved to the next run. Deferrals are part of a normal day: each one names the constraint that stopped it and the store is told why.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(Object.entries(a.byCode) as [keyof typeof DEFERRAL_LABEL, number][]).map(([code, n]) => (
              <Badge key={code} tone="attention">
                {DEFERRAL_LABEL[code]} · {n}
              </Badge>
            ))}
            {a.repeatSkips.length > 0 && (
              <Badge tone="critical">
                <Repeat className="size-3" /> {a.repeatSkips.length} skipped two runs in a row
              </Badge>
            )}
          </div>
          {a.reserveImpact && (
            <div className="mt-4 flex gap-3 rounded-xl bg-info-soft p-3 text-sm text-info-ink">
              <LifeBuoy className="mt-0.5 size-5 shrink-0" />
              <div>
                <b>Recovery reserve: {a.reserveImpact.vehicles.join(' and ')}</b> stay free so a breakdown can be rescued before 08:00.
                {a.reserveImpact.extraServed > 0 ? ` Releasing them would serve ${a.reserveImpact.extraServed} more orders today, but leave no reefer for a rescue.` : ' Releasing them would not serve any more orders today.'}
              </div>
            </div>
          )}
          <button onClick={() => setPolicy((p) => !p)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink">
            <Scale className="size-4" /> Allocation policy <ChevronDown className={cn('size-4 transition', policy && 'rotate-180')} />
          </button>
          {policy && (
            <ol className="mt-2 space-y-1.5 text-sm">
              {POLICY.map(([n, t, why]) => (
                <li key={n} className="flex gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-bold">{n}</span>
                  <span>
                    <b>{t}.</b> <span className="text-muted">{why}</span>
                  </span>
                </li>
              ))}
              <li className="pt-1 text-xs text-muted">Within a priority, earliest window close goes first. Reefers are kept for chilled goods and vans for van-only outlets.</li>
            </ol>
          )}
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {a.resources.map((r) => (
            <div key={r.key}>
              <Meter
                label={r.label}
                value={r.used}
                max={r.available}
                warnAt={0.85}
                detail={`${r.used.toLocaleString()} / ${r.available.toLocaleString()} ${r.unit}`}
              />
              {r.note && <p className="mt-1 text-xs text-muted">{r.note}</p>}
              {((r.key === 'reefer' && (a.binding === 'reefer_capacity' || a.binding === 'delivery_window')) || (r.key === 'van' && a.binding === 'van_capacity')) && (
                <Badge tone="attention" className="mt-1">
                  Limiting
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function Column({ title, count, tone, className, children }: { title: string; count: number; tone?: 'attention'; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('flex max-h-[calc(100dvh-220px)] min-h-72 flex-col rounded-xl border border-line bg-surface-2/60', className)}>
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge tone={tone ?? 'neutral'}>{count}</Badge>
      </div>
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  )
}

function OrderCard({ o, selected, onSelect, onOpen, onDrag, compact }: { o: Order; selected?: boolean; onSelect: () => void; onOpen: () => void; onDrag: (id: string | null) => void; compact?: boolean }) {
  const d = useOps((s) => s.data)
  const out = outletOf(d, o.outletId)!
  const body = (
    <div className="flex items-start gap-2">
      <GripVertical className="mt-0.5 size-4 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <button onClick={(e) => (e.stopPropagation(), onOpen())} className="id hover:underline">
            {out.id}
          </button>
          <span className={cn('text-xs font-semibold tabular-nums', o.priority >= 80 ? 'text-attention-ink' : 'text-muted')}>P{o.priority}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <BrandTag brand={o.brand} />
          <TempTag temp={o.temp} />
          {out.vanOnly && <Badge tone="attention">Van only</Badge>}
          {out.mall && <Badge>Mall</Badge>}
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-muted">
          <span className="tabular-nums">
            {o.volumeM3} m³ · {o.weightKg} kg · {out.district}
          </span>
          <span>by {fmtMin(out.window[1])}</span>
        </div>
      </div>
    </div>
  )
  const drag = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/order', o.id)
      e.dataTransfer.effectAllowed = 'move'
      onDrag(o.id)
    },
    onDragEnd: () => onDrag(null),
  }
  if (compact)
    return (
      <div {...drag} className="cursor-grab">
        {body}
      </div>
    )
  return (
    <div
      {...drag}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      aria-pressed={selected}
      className={cn('cursor-grab rounded-lg border bg-surface p-3 shadow-sm transition active:cursor-grabbing', selected ? 'border-brand ring-3 ring-brand/20' : 'border-line hover:border-line-strong')}
    >
      {body}
    </div>
  )
}

function VehicleCard({ v, moving, onDrop, onOpen }: { v: Vehicle; moving?: Order; onDrop: (orderId: string) => void; onOpen: (o: Order) => void }) {
  const d = useOps((s) => s.data)
  const [over, setOver] = useState(false)
  const day = useMemo(() => vehicleDay(v, d.trips, d), [v, d])
  const preview = useMemo(() => (moving ? validate(moving, v, { ...d, trips: d.trips.map((t) => (t.id === moving.tripId ? { ...t, stops: t.stops.filter((s) => s !== moving.id) } : t)) }) : null), [moving, v, d])
  const unavailable = v.status !== 'AVAILABLE'
  const verdict = moving && preview ? (preview.ok ? 'ok' : 'blocked') : null

  return (
    <Card
      onDragOver={(e) => {
        if (unavailable) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData('text/order')
        if (id) onDrop(id)
      }}
      className={cn('p-4 transition', unavailable && 'opacity-60', over && verdict === 'ok' && 'border-brand ring-3 ring-brand/25', over && verdict === 'blocked' && 'border-critical ring-3 ring-critical/25', !over && moving && verdict === 'ok' && 'border-brand/50')}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="id text-[15px]">{v.id}</span>
            {isReefer(v.type) && <Snowflake className="size-3.5 text-info" aria-label="Refrigerated" />}
            {v.reserve && (
              <Badge tone="info">
                <LifeBuoy className="size-3" /> Recovery reserve
              </Badge>
            )}
          </div>
          <div className="text-xs uppercase tracking-wide text-muted">
            {vehicleLabel(v.type)} · {v.capacityKg.toLocaleString()} kg · {v.capacityM3} m³ · {v.driver}
          </div>
        </div>
        {unavailable ? (
          <Badge tone="critical">{v.status === 'IN_WORKSHOP' ? 'In workshop' : 'Broken down'}</Badge>
        ) : moving && !over ? (
          <Button size="sm" variant={verdict === 'ok' ? 'primary' : 'secondary'} onClick={() => onDrop(moving.id)}>
            {verdict === 'ok' ? 'Assign here' : 'Check'}
          </Button>
        ) : (
          <span className="text-xs text-muted">{day.trips.length}/2 trips</span>
        )}
      </div>

      {over && preview && (
        <div className={cn('mt-3 rounded-lg border p-3', preview.ok ? 'border-brand/40 bg-brand-soft' : 'border-critical/40 bg-critical-soft')}>
          <div className={cn('mb-1 text-sm font-semibold', preview.ok ? 'text-brand-ink' : 'text-critical-ink')}>{preview.ok ? '✓ Order can be assigned' : 'Cannot assign order'}</div>
          {preview.checks
            .filter((c) => (!preview.ok ? !c.ok : ['trip', 'volume', 'budget'].includes(c.key)))
            .map((c) => (
              <CheckRow key={c.key} ok={c.ok} warn={!c.blocking} label={c.label} detail={c.detail} />
            ))}
        </div>
      )}

      {day.trips.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Meter label="Fresh budget" value={day.freshMin} max={BUDGET.fresh} detail={`${Math.round(day.freshMin)} / ${BUDGET.fresh} min`} />
          <Meter label="Style + Tech budget" value={day.styleTechMin} max={BUDGET.styleTech} detail={`${Math.round(day.styleTechMin)} / ${BUDGET.styleTech} min`} />
        </div>
      )}
      {day.trips.length === 0 && !over && <p className="mt-3 rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-muted">Drop an order to start a trip</p>}
      {day.trips.map(({ trip }) => (
        <TripBlock key={trip.id} t={trip} v={v} onOpen={onOpen} />
      ))}
    </Card>
  )
}

function TripBlock({ t, v, onOpen }: { t: Trip; v: Vehicle; onOpen: (o: Order) => void }) {
  const d = useOps((s) => s.data)
  const s = scheduleOf(d, t)
  const late = s.stops.some((x) => x.late)
  // A Fresh drop that finishes after 08:00 misses the store opening, even if it arrived inside its window.
  const freshLate = t.brand === 'Fresh' && s.stops.some((x) => x.start + x.service > FRESH_END)
  const editable = ['DRAFT', 'PLANNED', 'LOADING', 'LOADED'].includes(t.status)
  const loading = t.status === 'LOADING' || t.status === 'LOADED'
  return (
    <div className="mt-3 rounded-lg bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          Trip {t.number} · <BrandTag brand={t.brand} className="!text-xs !text-ink" /> · {t.district}
        </span>
        <span className="text-muted">
          {fmtMin(t.departure)} → {fmtMin(s.finish)} · {s.minutes} min
          {t.status !== 'DRAFT' && (
            <Badge className="ml-2" tone={t.pendingChange ? 'attention' : 'neutral'}>
              {t.pendingChange ? 'awaiting loader re-check' : t.status.toLowerCase().replace('_', ' ')}
            </Badge>
          )}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {t.stops.map((id, i) => {
          const o = d.orders.find((x) => x.id === id)!
          const st = s.stops.find((x) => x.orderId === id)
          return (
            <span key={id} className={cn('group inline-flex items-center gap-1 rounded-md border bg-surface py-0.5 pl-2 pr-1 text-xs', st?.late ? 'border-critical/50' : 'border-line')}>
              <span className="text-faint">{i + 1}</span>
              <button className="id hover:underline" onClick={() => onOpen(o)}>
                {o.outletId}
              </button>
              {o.temp === 'CHILLED' && <Snowflake className="size-3 text-info" aria-label="Chilled" />}
              {editable && (
                <button
                  aria-label={`Remove ${o.outletId}`}
                  className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-critical"
                  onClick={() => {
                    if (loading && !confirm(`Loading has started on ${t.vehicleId}. The loader will be asked to take ${o.outletId} off and confirm before departure. Continue?`)) return
                    ops('unassign', id)
                    toast(`${o.outletId} returned to queue`, { tone: 'neutral', body: loading ? 'The loader has been asked to re-check the load.' : undefined })
                  }}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          )
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Meter label="Weight" value={s.weightKg} max={v.capacityKg} detail={`${s.weightKg.toLocaleString()} / ${v.capacityKg.toLocaleString()} kg`} />
        <Meter label="Volume" value={s.volumeM3} max={v.capacityM3} detail={`${s.volumeM3} / ${v.capacityM3} m³`} />
      </div>
      {late && <p className="mt-2 text-xs font-semibold text-critical-ink">A stop misses its delivery window.</p>}
      {freshLate && <p className="mt-2 text-xs font-semibold text-critical-ink">A Fresh stop finishes after 08:00.</p>}
      {t.brand === 'Fresh' && !freshLate && s.stops.length > 0 && (
        <p className="mt-2 text-xs text-muted">Fresh done by {fmtMin(s.stops[s.stops.length - 1].start + s.stops[s.stops.length - 1].service)} · deadline 08:00</p>
      )}
    </div>
  )
}

const PLAN_STEPS = ['Fleet availability & recovery reserve', 'Weight and volume', 'Refrigeration', 'Van-only and mall access', 'Delivery windows', '270 / 480-minute budgets', 'Weekly fuel quotas', 'Priority and fairness']

function GeneratePlanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useOps((s) => s.data)
  const [step, setStep] = useState(0)
  const [result, setResult] = useState<ReturnType<typeof ops<'generatePlan'>> | null>(null)
  const queue = d.orders.filter((o) => o.deliveryDate === d.deliveryDate && (o.status === 'CONFIRMED' || (o.status === 'DEFERRED' && !o.deferral?.confirmed) || (o.status === 'PLANNED' && d.plan === 'DRAFT'))).length
  useEffect(() => {
    if (!open) {
      setStep(0)
      setResult(null)
      return
    }
    if (step < PLAN_STEPS.length) {
      const timer = setTimeout(() => setStep((s) => s + 1), 220)
      return () => clearTimeout(timer)
    }
    if (!result) setResult(ops('generatePlan'))
  }, [open, step, result])

  return (
    <Modal open={open} onClose={onClose} eyebrow="Recommended plan" title={result ? 'Plan ready' : `Checking ${queue} orders…`} footer={result && <Button onClick={onClose}>Review plan</Button>}>
      {!result ? (
        <div>
          {PLAN_STEPS.map((s, i) => (
            <div key={s} className={cn('flex items-center gap-3 py-1.5 text-sm transition', i < step ? 'text-ink' : 'text-faint')}>
              <span className={cn('grid size-5 place-items-center rounded-full', i < step ? 'bg-brand-soft text-brand-ink' : 'border-2 border-line-strong')}>{i < step && <Check className="size-3" strokeWidth={3} />}</span>
              {s}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Big label="Served" value={result.served} tone="text-brand-ink" />
          <Big label="Deferred" value={result.deferred} tone="text-attention-ink" />
          <Big label="Vehicles" value={result.vehicles} />
          <Big label="Trips" value={result.trips} />
          {result.binding && (
            <p className="col-span-2 rounded-xl bg-attention-soft p-3 text-sm text-attention-ink">
              Limiting resource: <b>{DEFERRAL_LABEL[result.binding]}</b>. Deferrals are proposals until you confirm them or publish; each carries the reason the store will see.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function Big({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className={cn('font-display text-3xl font-semibold tabular-nums', tone)}>{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  )
}
