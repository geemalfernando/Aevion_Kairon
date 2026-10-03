import { ArrowDown, ArrowLeft, Check, ChevronRight, CloudOff, Minus, Package, PackageCheck, PackageMinus, PackagePlus, PackageSearch, Plus, Snowflake, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { isReefer } from '@core/rules'
import { fmtClock, fmtMin, greeting, timeAgo } from '@core/time'
import type { OpsData, Order, Trip, TripChange } from '@core/types'
import { AuditTimeline } from '../../components/AuditTimeline'
import { PhotoCapture } from '../../components/ProofCapture'
import { RouteMap } from '../../components/RouteMap'
import { Badge, BrandTag, Button, Callout, Card, CardHeader, ChoiceList, cn, EmptyState, Modal, PageHeader, Segmented, SeverityBadge, Stat, TempTag, toast, type Tone } from '../../components/ui'
import { MODAL, STOP } from '../../demo/mode'
import { orderOf, outletOf, vehicleOf } from '../../lib/select'
import { useDevice, useNetwork, useNow, useSession, useView } from '../../store'

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

const loaderTrips = (d: OpsData, depot: string) =>
  d.trips.filter((t) => !['DRAFT', 'ABORTED'].includes(t.status) && t.stops.length && vehicleOf(d, t.vehicleId)?.depot === depot).sort((a, b) => a.departure - b.departure || a.vehicleId.localeCompare(b.vehicleId))

function NotReleased() {
  const { t } = useTranslation()
  return (
    <Card>
      <EmptyState icon={<Package className="size-5" />} title={t('loader.not_released')} body={t('loader.not_released_body')} />
    </Card>
  )
}

export function Dashboard() {
  const d = useView()
  const user = useSession((s) => s.user)!
  const now = useNow()
  const { t } = useTranslation()
  const trips = loaderTrips(d, user.depot)
  const ready = trips.filter((x) => x.status === 'PLANNED')
  const loading = trips.filter((x) => x.status === 'LOADING')
  const done = trips.filter((x) => ['LOADED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'].includes(x.status))
  const changed = trips.filter((x) => x.pendingChange)
  const next = [...changed, ...loading.filter((x) => !x.pendingChange), ...ready].slice(0, 8)
  return (
    <>
      <PageHeader eyebrow={`${t(`greeting.${greeting(now)}`)}, ${user.name}`} title={t('loader.bay', { depot: user.depot })} subtitle={t('loader.trips_today', { count: trips.length })} />
      {trips.length === 0 ? (
        <NotReleased />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <Stat label={t('loader.ready')} value={ready.length} tone="brand" />
            <Stat label={t('loader.loading')} value={loading.length} tone="attention" />
            <Stat label={t('loader.completed')} value={done.length} tone="success" />
          </div>
          <h2 className="mb-3 text-sm font-semibold">{t('loader.up_next')}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {next.map((x) => (
              <TripCard key={x.id} t={x} />
            ))}
            {next.length === 0 && <p className="text-sm text-muted">{t('loader.all_loaded')}</p>}
          </div>
        </>
      )}
    </>
  )
}

function TripCard({ t: trip }: { t: Trip }) {
  const d = useView()
  const { t } = useTranslation()
  const v = vehicleOf(d, trip.vehicleId)!
  return (
    <Link to={`/loader/load/${trip.id}`} className="group">
      <Card className={cn('flex items-center gap-4 p-5 transition group-hover:border-brand', trip.pendingChange && 'border-attention')}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="id text-xl">{trip.vehicleId}</span>
            {isReefer(v.type) && <Snowflake className="size-4 text-info" aria-label={t('vehicle.reefer')} />}
            <Badge tone={trip.pendingChange ? 'attention' : tripTone[trip.status]} dot>
              {trip.pendingChange ? t('loader.change.eyebrow') : t(`trip.${trip.status}`)}
            </Badge>
          </div>
          <div className="mt-0.5 text-sm text-muted">{t('loader.trip_line', { n: trip.number, brand: trip.brand, district: trip.district, count: trip.stops.length })}</div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-semibold tabular-nums">{fmtMin(trip.departure)}</div>
          <div className="text-xs text-muted">{t('loader.departure')}</div>
        </div>
        <ChevronRight className="size-5 text-faint" />
      </Card>
    </Link>
  )
}

export function Trips() {
  const d = useView()
  const user = useSession((s) => s.user)!
  const { t } = useTranslation()
  const [f, setF] = useState<'todo' | 'done' | 'all'>('todo')
  const all = loaderTrips(d, user.depot)
  const trips = all.filter((x) => (f === 'todo' ? ['PLANNED', 'LOADING'].includes(x.status) : f === 'done' ? !['PLANNED', 'LOADING'].includes(x.status) : true))
  return (
    <>
      <PageHeader
        title={t('loader.trips')}
        actions={
          <Segmented
            value={f}
            onChange={setF}
            options={[
              { value: 'todo', label: t('loader.to_load') },
              { value: 'done', label: t('loader.loaded_tab') },
              { value: 'all', label: t('loader.all_tab') },
            ]}
          />
        }
      />
      {all.length === 0 ? (
        <NotReleased />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {trips.map((x) => (
            <TripCard key={x.id} t={x} />
          ))}
        </div>
      )}
    </>
  )
}

const isOrderConfirmed = (o: Order) => !!o.loaded && o.items.every((i) => o.loaded![i.name] !== undefined)

export function Load() {
  const { tripId } = useParams()
  const d = useView()
  const record = useDevice((s) => s.record)
  const net = useNetwork()
  const { t } = useTranslation()
  const trip = d.trips.find((x) => x.id === tripId)
  // ?stop=OUT005 opens that stop (stable link for previews).
  const [open, setOpen] = useState<string | null>(() => (STOP && trip ? (trip.stops.find((id) => orderOf(d, id)?.outletId === STOP) ?? null) : null))
  const [short, setShort] = useState<{ o: Order; item: string; available: number } | null>(() => {
    if (MODAL !== 'shortfall' || !trip) return null
    const o = trip.stops.map((id) => orderOf(d, id)!).find((x) => !isOrderConfirmed(x))
    return o ? { o, item: o.items[0].name, available: Math.max(0, o.items[0].qty - 3) } : null
  })

  if (!trip) return <EmptyState icon={<Package className="size-5" />} title="Trip not found" />
  const v = vehicleOf(d, trip.vehicleId)!
  const orders = trip.stops.map((id) => orderOf(d, id)!).filter(Boolean)
  const loadOrder = [...orders].reverse() // last stop goes in first
  const confirmedCount = orders.filter(isOrderConfirmed).length
  const canComplete = confirmedCount === orders.length && trip.status === 'LOADING' && !trip.pendingChange
  const current = open ?? loadOrder.find((o) => !isOrderConfirmed(o))?.id ?? null
  const shortIssue = (o: Order) => d.issues.find((i) => i.kind === 'SHORTFALL' && i.orderIds?.includes(o.id))
  const locked = trip.status === 'PLANNED' || !!trip.pendingChange

  return (
    <>
      <Link to="/loader/trips" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {t('loader.back')}
      </Link>
      <PageHeader
        eyebrow={`${t(`vehicle.${v.type}`)} · ${v.driver}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="id">{trip.vehicleId}</span>
            <span className="text-muted">{t('driver.trip_line', { n: trip.number, brand: '', district: '' }).split(' ·')[0]}</span>
            <Badge tone={trip.pendingChange ? 'attention' : tripTone[trip.status]} dot>
              {trip.pendingChange ? t('loader.change.eyebrow') : t(`trip.${trip.status}`)}
            </Badge>
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <BrandTag brand={trip.brand} /> · {trip.district} · {t('common.departure')} {fmtMin(trip.departure)} · {t('loader.trip_line', { n: trip.number, brand: trip.brand, district: trip.district, count: trip.stops.length }).split(' · ').at(-1)}
          </span>
        }
      />

      {trip.pendingChange && <PlanChanged trip={trip} change={trip.pendingChange} />}

      {trip.status === 'PLANNED' && (
        <Card className="mb-6 flex flex-wrap items-center gap-4 p-5">
          <div className="flex-1">
            <div className="font-semibold">{t('loader.ready_title')}</div>
            <p className="text-sm text-muted">{t('loader.ready_body')}</p>
          </div>
          <Button size="xl" onClick={() => (record({ type: 'LOAD_START', tripId: trip.id }), toast(t('loader.started'), { tone: 'info' }))}>
            {t('loader.start')}
          </Button>
        </Card>
      )}
      {!net.online && trip.status !== 'PLANNED' && (
        <Callout tone="neutral" icon={<CloudOff className="size-5" />} title={t('loader.offline')} className="mb-4">
          {t('loader.offline_body')}
        </Callout>
      )}

      <div className={cn('grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]', locked && 'pointer-events-none opacity-50')} aria-disabled={locked}>
        {/* On a phone the stop being counted comes first; the full sequence follows. */}
        <div className="order-1 space-y-4 lg:order-2">
          {current && (
            <OrderLoader
              key={current}
              o={orders.find((x) => x.id === current)!}
              stop={trip.stops.indexOf(current) + 1}
              issue={shortIssue(orders.find((x) => x.id === current)!)}
              onShort={(item, available) => setShort({ o: orders.find((x) => x.id === current)!, item, available })}
              onConfirmed={() => setOpen(loadOrder.find((o) => o.id !== current && !isOrderConfirmed(o))?.id ?? null)}
            />
          )}
          <Button
            size="xl"
            block
            icon={<PackageCheck className="size-5" />}
            disabled={!canComplete}
            onClick={() => {
              record({ type: 'LOAD_COMPLETE', tripId: trip.id })
              toast(t('loader.complete_toast', { id: trip.vehicleId }), { body: net.online ? t('loader.complete_online') : t('loader.complete_offline') })
            }}
          >
            {['LOADED', 'IN_PROGRESS', 'COMPLETED'].includes(trip.status) ? t('loader.complete_done') : t('loader.complete', { done: confirmedCount, total: orders.length })}
          </Button>
        </div>

        <Card className="order-2 self-start lg:order-1">
          <CardHeader title={t('loader.sequence')} eyebrow={t('loader.confirmed', { done: confirmedCount, total: orders.length })} />
          <div className="bg-brand-soft px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-brand-ink">{t('loader.load_first')}</div>
          <ol>
            {loadOrder.map((o) => {
              const stop = trip.stops.indexOf(o.id) + 1
              const ok = isOrderConfirmed(o)
              const added = trip.pendingChange?.added.includes(o.id)
              return (
                <li key={o.id}>
                  <button onClick={() => setOpen(o.id)} className={cn('flex w-full items-center gap-4 border-b border-line px-5 py-4 text-left transition', current === o.id ? 'bg-surface-2' : 'hover:bg-surface-2')}>
                    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl font-display text-lg font-bold', ok ? 'bg-brand-fill text-white' : current === o.id ? 'border-2 border-brand bg-surface text-brand-ink' : 'bg-surface-3')}>
                      {ok ? <Check className="size-5" strokeWidth={3} /> : stop}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="id text-base">{o.outletId}</span>
                      <span className="block truncate text-xs text-muted">{outletOf(d, o.outletId)?.name}</span>
                    </span>
                    {added && <Badge tone="info">+</Badge>}
                    {o.shortfall && <Badge tone="attention">{t('loader.shortfall')}</Badge>}
                    {o.temp === 'CHILLED' && <Snowflake className="size-4 text-info" aria-label={t('temp.chilled')} />}
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="flex items-center gap-2 bg-surface-2 px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">
            <ArrowDown className="size-3.5" /> {t('loader.unload_first')}
          </div>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title={t('loader.map_title')} eyebrow={t('loader.map_eyebrow')} />
        <div className="p-4">
          <RouteMap className="h-72" routes={[{ id: trip.id, depot: v.depot, stops: orders.map((o) => ({ outlet: outletOf(d, o.outletId)!, state: 'todo' as const })) }]} />
        </div>
      </Card>
      {short && <ShortfallModal {...short} onClose={() => setShort(null)} />}
    </>
  )
}

/**
 * Second degradation screen: the dispatcher changed this trip after loading began.
 * The loader sees exactly what comes off and what goes on (and where), ticks each line when it's
 * physically done, and confirms — the vehicle cannot depart until then.
 */
function PlanChanged({ trip, change }: { trip: Trip; change: TripChange }) {
  const d = useView()
  const record = useDevice((s) => s.record)
  const { t } = useTranslation()
  const [done, setDone] = useState<Record<string, boolean>>({})
  const lines = [...change.removed.map((r) => `-${r.orderId}`), ...change.added.map((id) => `+${id}`)]
  const all = lines.every((l) => done[l])
  const total = trip.stops.length
  const where = (id: string) => {
    const i = trip.stops.indexOf(id)
    if (i === 0) return t('loader.change.where_first')
    if (i === total - 1) return t('loader.change.where_last')
    return t('loader.change.where_between', { a: i, b: i + 2 })
  }
  const units = (o?: Order) => o?.items.reduce((s, i) => s + i.qty, 0) ?? 0

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border-2 border-attention bg-surface shadow-card" aria-labelledby="change-title">
      <div className="bg-attention-soft px-5 py-4">
        <div className="eyebrow flex items-center gap-1.5 !text-attention-ink">
          <PackageSearch className="size-4" /> {t('loader.change.eyebrow')}
        </div>
        <h2 id="change-title" className="mt-1 font-display text-xl font-bold">
          {t('loader.change.title', { vehicle: trip.vehicleId })}
        </h2>
        <p className="mt-1 text-sm">{t('loader.change.body', { time: fmtClock(change.at), reason: change.reason })}</p>
      </div>
      <div className="divide-y divide-line">
        {change.removed.map((r) => {
          const o = orderOf(d, r.orderId)
          const key = `-${r.orderId}`
          return (
            <ChangeLine
              key={key}
              icon={<PackageMinus className="size-5" />}
              tone="attention"
              label={t('loader.change.unload')}
              id={o?.outletId ?? r.orderId}
              name={outletOf(d, o?.outletId)?.name}
              detail={`${t('common.units', { count: units(o) })} · ${r.to ? t('loader.change.moved_to', { vehicle: r.to }) : t('loader.change.back_to_queue')}`}
              chilled={o?.temp === 'CHILLED'}
              items={o?.items.map((i) => `${i.qty} ${i.name}`).join(' · ')}
              checked={!!done[key]}
              onToggle={() => setDone((s) => ({ ...s, [key]: !s[key] }))}
            />
          )
        })}
        {change.added.map((id) => {
          const o = orderOf(d, id)
          const key = `+${id}`
          return (
            <ChangeLine
              key={key}
              icon={<PackagePlus className="size-5" />}
              tone="info"
              label={t('loader.change.add')}
              id={o?.outletId ?? id}
              name={outletOf(d, o?.outletId)?.name}
              detail={`${t('loader.change.add_line', { count: units(o), n: trip.stops.indexOf(id) + 1, total })} · ${t('loader.change.add_where', { where: where(id) })}`}
              chilled={o?.temp === 'CHILLED'}
              items={o?.items.map((i) => `${i.qty} ${i.name}`).join(' · ')}
              checked={!!done[key]}
              onToggle={() => setDone((s) => ({ ...s, [key]: !s[key] }))}
            />
          )
        })}
      </div>
      <div className="border-t border-line bg-surface-2/60 p-5">
        <Button
          size="xl"
          block
          disabled={!all}
          icon={<Check className="size-5" />}
          onClick={() => {
            record({ type: 'LOAD_CHANGE_ACK', tripId: trip.id, changeId: change.id })
            toast(t('loader.change.toast'), { body: t('loader.change.toast_body') })
          }}
        >
          {t('loader.change.confirm')}
        </Button>
        <p className="mt-2 text-center text-xs text-muted">{t('loader.change.confirm_hint')}</p>
      </div>
    </section>
  )
}

function ChangeLine(p: { icon: React.ReactNode; tone: 'attention' | 'info'; label: string; id: string; name?: string; detail: string; chilled?: boolean; items?: string; checked: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  return (
    <label className={cn('flex cursor-pointer items-start gap-4 border-l-4 px-5 py-4', p.tone === 'attention' ? 'border-attention' : 'border-info', p.checked && 'bg-surface-2')}>
      <span className={cn('mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl', p.tone === 'attention' ? 'bg-attention-soft text-attention-ink' : 'bg-info-soft text-info-ink')}>{p.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="eyebrow block">{p.label}</span>
        <span className="id text-lg">{p.id}</span>
        {p.name && <span className="ml-2 text-sm text-muted">{p.name}</span>}
        <span className="mt-0.5 block text-sm">{p.detail}</span>
        {p.items && <span className="mt-0.5 block text-xs text-muted">{p.items}</span>}
        {p.chilled && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-info-ink">
            <Snowflake className="size-3.5" /> {t('loader.change.chilled')}
          </span>
        )}
      </span>
      <span className="flex flex-col items-center gap-1 pt-1">
        <input type="checkbox" checked={p.checked} onChange={p.onToggle} className="size-7 accent-[var(--brand)]" aria-label={`${t('loader.change.done')} ${p.id}`} />
        <span className="text-[11px] font-semibold text-muted">{t('loader.change.done')}</span>
      </span>
    </label>
  )
}

function OrderLoader({ o, stop, issue, onShort, onConfirmed }: { o: Order; stop: number; issue?: { resolved?: { decision: string } }; onShort: (item: string, available: number) => void; onConfirmed: () => void }) {
  const d = useView()
  const record = useDevice((s) => s.record)
  const { t } = useTranslation()
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(o.items.map((i) => [i.name, o.loaded?.[i.name] ?? 0])))
  const out = outletOf(d, o.outletId)!
  const missing = o.items.filter((i) => counts[i.name] < i.qty)
  const unresolvedMissing = missing.filter((i) => o.shortfall?.item !== i.name)
  return (
    <Card>
      <div className="flex items-start justify-between border-b border-line px-5 py-4">
        <div>
          <div className="eyebrow">{t('loader.stop', { n: stop })}</div>
          <div className="id text-2xl">{out.id}</div>
          <div className="text-sm text-muted">{out.name}</div>
        </div>
        <TempTag temp={o.temp} />
      </div>
      <ul className="divide-y divide-line">
        {o.items.map((i) => {
          const c = counts[i.name]
          const set = (n: number) => setCounts((s) => ({ ...s, [i.name]: Math.max(0, Math.min(i.qty, n)) }))
          const full = c >= i.qty
          return (
            <li key={i.name} className="px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{i.name}</div>
                  <div className={cn('text-sm tabular-nums', full ? 'text-brand-ink' : 'text-muted')}>
                    {c} / {i.qty} {i.unit}
                  </div>
                </div>
                <div className="inline-flex items-center rounded-xl border border-line-strong">
                  <button className="grid size-12 place-items-center" onClick={() => set(c - 1)} aria-label={t('loader.remove_one', { item: i.name })}>
                    <Minus className="size-5" />
                  </button>
                  <span className="w-9 text-center text-lg font-semibold tabular-nums">{c}</span>
                  <button className="grid size-12 place-items-center" onClick={() => set(c + 1)} aria-label={t('loader.add_one', { item: i.name })}>
                    <Plus className="size-5" />
                  </button>
                </div>
                <Button variant={full ? 'secondary' : 'primary'} className="h-12" onClick={() => set(i.qty)} disabled={full}>
                  {t('loader.all')}
                </Button>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(c / i.qty) * 100}%` }} />
              </div>
              {!full && c > 0 && o.shortfall?.item !== i.name && (
                <button onClick={() => onShort(i.name, c)} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-attention-ink">
                  <TriangleAlert className="size-4" /> {t('loader.missing', { count: i.qty - c })}
                </button>
              )}
              {o.shortfall?.item === i.name && <div className="mt-2 text-sm text-attention-ink">{t('loader.reported', { status: issue?.resolved ? t('loader.decision', { decision: issue.resolved.decision }) : t('loader.awaiting') })}</div>}
            </li>
          )
        })}
      </ul>
      <div className="border-t border-line p-5">
        {unresolvedMissing.length > 0 ? (
          <p className="text-sm text-muted">{t('loader.count_hint')}</p>
        ) : (
          <Button
            block
            size="lg"
            onClick={() => {
              for (const i of o.items) record({ type: 'LOAD_COUNT', orderId: o.id, item: i.name, count: counts[i.name] })
              toast(t('loader.confirmed_toast', { id: out.id }))
              onConfirmed()
            }}
          >
            {isOrderConfirmed(o) ? t('loader.update') : t('loader.confirm', { id: out.id })}
          </Button>
        )}
      </div>
    </Card>
  )
}

const REASONS = ['Inventory unavailable', 'Damaged item', 'Wrong item', 'Missing stock', 'Other'] as const

function ShortfallModal({ o, item, available, onClose }: { o: Order; item: string; available: number; onClose: () => void }) {
  const record = useDevice((s) => s.record)
  const net = useNetwork()
  const { t } = useTranslation()
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null)
  const [photo, setPhoto] = useState<string>()
  const line = o.items.find((i) => i.name === item)!
  const submit = () => {
    record({ type: 'SHORTFALL', orderId: o.id, item, missing: line.qty - available, reason: reason!, photo })
    toast(net.online ? t('loader.short.toast_online') : t('loader.short.toast_offline'), { tone: 'attention', body: `${o.outletId}: ${line.qty - available} × ${item}` })
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={o.outletId}
      title={t('loader.short.title')}
      tone="attention"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="attention" disabled={!reason} onClick={submit}>
            {net.online ? t('loader.short.notify') : t('loader.short.save_offline')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          [t('loader.short.expected'), line.qty],
          [t('loader.short.available'), available],
          [t('loader.short.shortfall'), line.qty - available],
        ].map(([l, v], i) => (
          <div key={String(l)} className={cn('rounded-xl p-3', i === 2 ? 'bg-attention-soft text-attention-ink' : 'bg-surface-2')}>
            <div className="text-xs">{l}</div>
            <div className="font-display text-2xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-sm text-muted">
        {item} · {line.unit}
      </p>
      <div className="mt-5">
        <div className="mb-2 text-sm font-medium">{t('loader.short.reason')}</div>
        <ChoiceList name={t('loader.short.reason')} columns={2} value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: t(`loader.short.reasons.${r}`) }))} />
      </div>
      <div className="mt-5">
        <div className="mb-2 text-sm font-medium">{t('loader.short.photo')}</div>
        <PhotoCapture value={photo} onChange={setPhoto} label={t('loader.short.capture')} />
      </div>
    </Modal>
  )
}

export function Issues() {
  const d = useView()
  const now = useNow()
  const { t } = useTranslation()
  const list = d.issues.filter((i) => i.kind === 'SHORTFALL')
  return (
    <>
      <PageHeader title={t('loader.issues.title')} subtitle={t('loader.issues.subtitle')} />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<TriangleAlert className="size-5" />} title={t('loader.issues.none')} body={t('loader.issues.none_body')} />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {list.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <SeverityBadge s={i.severity} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{i.title}</div>
                <div className="text-sm text-muted">{i.detail}</div>
              </div>
              {i.resolved ? <Badge tone="success">{i.resolved.decision}</Badge> : <Badge tone="attention">{t('loader.issues.awaiting')}</Badge>}
              <span className="text-xs text-faint">{timeAgo(i.createdAt, now)}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

export function History() {
  const d = useView()
  const { t } = useTranslation()
  const events = useMemo(() => d.audit.filter((e) => e.actor === 'LOADER').sort((a, b) => a.at - b.at), [d])
  return (
    <>
      <PageHeader title={t('loader.history.title')} />
      <Card className="p-5">
        <AuditTimeline events={events.map((e) => ({ ...e, text: `${e.entity} · ${e.text}` }))} empty={t('loader.history.empty')} />
      </Card>
    </>
  )
}
