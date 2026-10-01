import { Check, CloudDownload, LifeBuoy, Navigation, PackageSearch, ShieldAlert, Snowflake, Truck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Callout, Card, CheckRow, EmptyState, toast } from '../../components/ui'
import { isReefer } from '@core/rules'
import { fmtClock, fmtMin, greeting } from '@core/time'
import { useDevice, useNetwork, useNow, useSession } from '../../store'
import { useDriverRoute } from './common'

export function Today() {
  const user = useSession((s) => s.user)!
  const { d, trip, vehicle, sched, stops, nextIdx, done } = useDriverRoute()
  const record = useDevice((s) => s.record)
  const net = useNetwork()
  const now = useNow()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const openIssue = d.issues.find((i) => i.vehicleId === vehicle.id && !i.resolved && (i.kind === 'BREAKDOWN' || i.kind === 'REEFER_FAILURE'))
  const pending = trip?.pendingChange
  const outlets = new Set(stops.map((s) => s.outlet.id)).size

  return (
    <div className="mx-auto max-w-xl">
      <div className="eyebrow">
        {t(`greeting.${greeting(now)}`)}, {user.name}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <h1 className="id text-3xl">{vehicle.id}</h1>
        {isReefer(vehicle.type) && <Snowflake className="size-5 text-info" aria-label={t('vehicle.reefer')} />}
      </div>
      <p className="text-sm text-muted">
        {t(`vehicle.${vehicle.type}`)} · {vehicle.depot}
      </p>

      {!trip ? (
        <Card className="mt-6">
          <EmptyState icon={<Truck className="size-5" />} title={t('driver.no_route')} body={t('driver.no_route_body')} />
        </Card>
      ) : (
        <>
          {trip.rescue && (
            <Callout tone="info" icon={<LifeBuoy className="size-5" />} title={t('driver.rescue_title')} className="mt-6">
              {t('driver.rescue_body', { from: trip.rescue.from ?? '—', time: fmtMin(trip.departure) })}
            </Callout>
          )}
          <Card className="mt-6 overflow-hidden">
            <div className="bg-teal p-5 text-white">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-white/75">{t('driver.today_route')}</div>
              <div className="mt-1 font-display text-2xl font-semibold">{t('driver.trip_line', { n: trip.number, brand: trip.brand, district: trip.district })}</div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-white/75">{t('common.stops')}</div>
                  <div className="font-display text-xl font-semibold">{stops.length}</div>
                </div>
                <div>
                  <div className="text-white/75">{t('common.departure')}</div>
                  <div className="font-display text-xl font-semibold tabular-nums">{fmtMin(trip.departure)}</div>
                </div>
                <div>
                  <div className="text-white/75">{t('common.finish')}</div>
                  <div className="font-display text-xl font-semibold tabular-nums">{sched ? fmtMin(sched.finish) : '—'}</div>
                </div>
              </div>
            </div>
            <div className="p-5">
              {trip.status === 'PAUSED' || openIssue ? (
                <Callout tone="critical" icon={<ShieldAlert className="size-5" />} title={t('driver.breakdown_title')}>
                  {t('driver.breakdown_body', { count: stops.length - done })}
                </Callout>
              ) : pending ? (
                <>
                  <Callout tone="attention" icon={<PackageSearch className="size-5" />} title={t('driver.recheck_title')}>
                    {t('driver.recheck_body', { time: fmtClock(pending.at) })}
                  </Callout>
                  <Button size="xl" block className="mt-4" disabled icon={<Navigation className="size-5" />}>
                    {t('driver.start_route')}
                  </Button>
                </>
              ) : trip.status === 'IN_PROGRESS' ? (
                <>
                  <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-semibold">{t('driver.progress', { done, total: stops.length })}</span>
                    {nextIdx >= 0 && <span className="text-muted">{t('driver.next_eta', { id: stops[nextIdx].outlet.id, time: fmtMin(stops[nextIdx].plan.eta) })}</span>}
                  </div>
                  <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(done / stops.length) * 100}%` }} />
                  </div>
                  <Link to="/driver/route">
                    <Button size="xl" block icon={<Navigation className="size-5" />}>
                      {t('driver.continue_route')}
                    </Button>
                  </Link>
                </>
              ) : trip.status === 'COMPLETED' ? (
                <Callout tone="success" icon={<Check className="size-5" />} title={t('driver.route_complete')}>
                  {t('driver.route_complete_body', { count: stops.length, depot: vehicle.depot })}
                </Callout>
              ) : trip.status === 'LOADED' ? (
                <Button
                  size="xl"
                  block
                  icon={<Navigation className="size-5" />}
                  onClick={() => {
                    record({ type: 'START_ROUTE', tripId: trip.id })
                    toast(t('driver.start_route'), { body: net.online ? t('driver.stop.toast_store_notified') : t('driver.stop.toast_saved_device') })
                    navigate('/driver/route')
                  }}
                >
                  {t('driver.start_route')}
                </Button>
              ) : (
                <Callout tone="info" icon={<Truck className="size-5" />} title={trip.status === 'LOADING' ? t('driver.being_loaded') : t('driver.waiting_loading')}>
                  {t('driver.start_after_loading')}
                </Callout>
              )}
            </div>
          </Card>

          <Card className="mt-4 p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold">
                <CloudDownload className="size-4 text-brand-ink" /> {t('driver.offline_ready')}
              </div>
              <Badge tone="success">{t('driver.offline_ready_badge')}</Badge>
            </div>
            <CheckRow ok label={t('driver.offline_route')} detail={t('common.stops') + ` · ${stops.length}`} />
            <CheckRow ok label={t('driver.offline_outlets')} detail={`${outlets}`} />
            <CheckRow ok label={t('driver.offline_proof')} detail={t('driver.on_device')} />
            <CheckRow ok={net.pending === 0} warn label={t('driver.offline_outbox')} detail={net.pending ? t('driver.saved_n', { count: net.pending }) : t('driver.nothing_waiting')} />
            <p className="mt-2 text-xs text-muted">{t('driver.keep_working', { time: net.lastSync ? fmtClock(net.lastSync) : '—' })}</p>
          </Card>

          {['LOADED', 'IN_PROGRESS'].includes(trip.status) && (
            <Link to="/driver/issues" className="mt-4 block">
              <Button variant="secondary" block size="lg" icon={<ShieldAlert className="size-5" />}>
                {t('driver.report_issue')}
              </Button>
            </Link>
          )}
        </>
      )}
    </div>
  )
}
