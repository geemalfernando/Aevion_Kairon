import { Check, Clock, Navigation, Route as RouteIcon, Timer, TriangleAlert, Truck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { riskBand } from '@core/predict'
import { fmtMin, fmtWindow } from '@core/time'
import { directionsUrl, RouteMap } from '../../components/RouteMap'
import { Badge, Button, Callout, Card, cn, EmptyState, ModelChip, StatusBadge, TempTag } from '../../components/ui'
import { isDone } from '../../lib/select'
import { useDriverRoute } from './common'

export function RouteView() {
  const { trip, vehicle, stops, nextIdx, done } = useDriverRoute()
  const { t } = useTranslation()
  if (!trip) return <EmptyState icon={<RouteIcon className="size-5" />} title={t('driver.no_route')} />
  const next = nextIdx >= 0 ? stops[nextIdx] : undefined
  const band = next?.pred && riskBand(next.pred.lateProb)
  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-bold">
          {done} / {stops.length} <span className="text-lg font-semibold text-muted">{t('driver.complete')}</span>
        </h1>
        <span className="id text-muted">{trip.id}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(done / Math.max(1, stops.length)) * 100}%` }} />
      </div>

      {trip.status === 'PAUSED' && (
        <Callout tone="critical" title={t('driver.paused')} className="mt-4">
          {t('driver.paused_body')}
        </Callout>
      )}

      {next && trip.status !== 'PAUSED' && (
        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-line bg-brand-soft px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-brand-ink">{t('driver.next_stop')}</div>
          <div className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="id text-3xl">{next.outlet.id}</div>
                <div className="text-muted">{next.outlet.name}</div>
              </div>
              <TempTag temp={next.order.temp} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-muted">{t('common.eta')}</div>
                <div className="font-display text-2xl font-semibold tabular-nums">{fmtMin(next.plan.eta)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">{t('common.window')}</div>
                <div className="font-display text-lg font-semibold tabular-nums leading-tight">{fmtWindow(next.outlet.window)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">{t('common.service')}</div>
                <div className="font-display text-lg font-semibold">{t('risk.service', { min: Math.round(next.pred?.serviceMin ?? next.plan.service) })}</div>
              </div>
            </div>
            {next.pred && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 text-muted">
                  <Timer className="size-3.5" /> {t('risk.label')}:
                </span>
                <Badge tone={band === 'high' ? 'critical' : band === 'medium' ? 'attention' : 'success'}>
                  {t(`risk.${band}`)} · {Math.round(next.pred.lateProb * 100)}%
                </Badge>
                <ModelChip source={next.pred.source} />
              </div>
            )}
            {next.plan.late && (
              <Callout tone="attention" icon={<TriangleAlert className="size-5" />} title={t('driver.window_will_miss')} className="mt-4">
                {t('driver.window_will_miss_body')}
              </Callout>
            )}
            {next.outlet.mall && (
              <Callout tone="info" icon={<Clock className="size-5" />} title={t('driver.mall_title', { window: fmtWindow(next.outlet.window) })} className="mt-4">
                {t('driver.mall_body')}
              </Callout>
            )}
            {next.outlet.vanOnly && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted">
                <Truck className="size-4" /> {t('driver.van_only')} · {t(`access.${next.outlet.dock}`)}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <a href={directionsUrl(next.outlet)} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="xl" block icon={<Navigation className="size-5" />}>
                  {t('driver.navigate')}
                </Button>
              </a>
              <Link to={`/driver/stop/${next.order.id}`}>
                <Button size="xl" block>
                  {next.order.status === 'ARRIVED' ? t('driver.deliver') : t('driver.open_stop')}
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <ol className="divide-y divide-line">
          {stops.map((s, i) => {
            const d = isDone(s.order)
            const cur = i === nextIdx
            return (
              <li key={s.order.id}>
                <Link to={`/driver/stop/${s.order.id}`} className={cn('flex items-center gap-4 px-5 py-4', cur && 'bg-surface-2')}>
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-bold', d ? 'border-brand bg-brand-fill text-white' : cur ? 'border-info text-info-ink' : 'border-line-strong text-muted')}>
                    {d ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="id">{s.outlet.id}</span>
                    <span className="block truncate text-xs text-muted">{s.outlet.name}</span>
                  </span>
                  {d ? <StatusBadge s={s.order.status} /> : <span className="text-sm tabular-nums text-muted">{fmtMin(s.plan.eta)}</span>}
                  {s.order.delivery?.offline && !d && <Badge>{t('driver.saved')}</Badge>}
                </Link>
              </li>
            )
          })}
        </ol>
      </Card>

      <RouteMap
        className="mt-4 aspect-[4/3]"
        label={t('driver.map')}
        routes={[
          {
            id: trip.id,
            depot: vehicle.depot,
            stops: stops.map((s, i) => ({ outlet: s.outlet, state: isDone(s.order) ? (s.order.status === 'FAILED' ? 'problem' : 'done') : i === nextIdx ? 'current' : 'todo' })),
            vehicle: trip.status === 'IN_PROGRESS' && nextIdx >= 0 ? { label: vehicle.id, at: nextIdx } : undefined,
          },
        ]}
      />
    </div>
  )
}
