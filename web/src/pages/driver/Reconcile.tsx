import { ArrowRight, CheckCircle2, CloudCheck, PackageMinus, PackagePlus, ShieldCheck, Truck, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { byId } from '@core/rules'
import { fmtClock, fmtMin } from '@core/time'
import { Button, Card, EmptyState, TempTag, cn } from '../../components/ui'
import { isDone } from '../../lib/select'
import { useDevice, useNetwork } from '../../store'
import { useDriverRoute } from './common'

/**
 * Hero degradation screen: the driver's phone was offline, the dispatcher changed the route meanwhile,
 * and the phone has just reconnected. It says what was kept, what moved and what to do now,
 * and the driver confirms before continuing — the dispatcher sees that confirmation.
 */
export function Reconcile() {
  const net = useNetwork()
  const ack = useDevice((s) => s.acknowledgeConflict)
  const { d, stops, nextIdx } = useDriverRoute()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const c = net.conflict

  if (!c)
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState icon={<CheckCircle2 className="size-5" />} title={t('driver.reconcile.nothing')} action={<Link to="/driver" className="text-sm font-semibold text-brand-ink">{t('driver.reconcile.back')}</Link>} />
      </div>
    )

  const order = (id: string) => byId(d.orders, id)
  const outlet = (id: string) => byId(d.outlets, order(id)?.outletId)
  const mins = Math.max(1, Math.round((c.at - c.offlineFrom) / 60_000))
  const next = nextIdx >= 0 ? stops[nextIdx] : undefined

  return (
    <div className="mx-auto max-w-xl pb-28">
      <div className="rounded-2xl border border-attention/50 bg-attention-soft p-5">
        <div className="eyebrow !text-attention-ink">{t('driver.reconcile.eyebrow', { time: fmtClock(c.at) })}</div>
        <h1 className="mt-1 font-display text-2xl font-bold leading-tight">{t('driver.reconcile.title')}</h1>
        <p className="mt-2 flex items-start gap-2 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-ink" />
          {t('driver.reconcile.offline_for', { mins })}
        </p>
      </div>

      {c.kept.length > 0 && (
        <Section icon={<CloudCheck className="size-5 text-brand-ink" />} title={t('driver.reconcile.kept_title')}>
          {c.kept.map((id) => (
            <Row key={id} id={outlet(id)?.id ?? id} name={outlet(id)?.name} detail={t('driver.reconcile.kept_line', { time: order(id)?.delivery?.completedAt ? fmtClock(order(id)!.delivery!.completedAt!) : '—' })} tone="done" />
          ))}
        </Section>
      )}

      {c.collided.length > 0 && (
        <Section icon={<ShieldCheck className="size-5 text-brand-ink" />} title={t('driver.reconcile.collided_title')}>
          {c.collided.map((id) => (
            <Row key={id} id={outlet(id)?.id ?? id} name={outlet(id)?.name} detail={t('driver.reconcile.collided_line')} tone="done" />
          ))}
        </Section>
      )}

      {c.removed.length > 0 && (
        <Section icon={<PackageMinus className="size-5 text-attention-ink" />} title={t('driver.reconcile.removed_title')}>
          {c.removed.map((r) => (
            <Row
              key={r.orderId}
              id={r.outletId}
              name={outlet(r.orderId)?.name}
              detail={r.to ? t('driver.reconcile.removed_to', { vehicle: r.to, reason: r.reason }) : t('driver.reconcile.removed_deferred', { reason: r.reason })}
              tone="removed"
              extra={
                <>
                  {order(r.orderId) && <TempTag temp={order(r.orderId)!.temp} className="mt-2" />}
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium">
                    <Undo2 className="mt-0.5 size-4 shrink-0" /> {t('driver.reconcile.goods')}
                  </p>
                </>
              }
            />
          ))}
        </Section>
      )}

      {c.added.length > 0 && (
        <Section icon={<PackagePlus className="size-5 text-info-ink" />} title={t('driver.reconcile.added_title')}>
          {c.added.map((id) => (
            <Row key={id} id={outlet(id)?.id ?? id} name={outlet(id)?.name} tone="added" />
          ))}
        </Section>
      )}

      <Section icon={<Truck className="size-5 text-muted" />} title={t('driver.reconcile.now_title')}>
        <ol className="divide-y divide-line">
          {stops.map((s, i) => (
            <li key={s.order.id} className="flex items-center gap-3 px-4 py-3">
              <span className={cn('grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold', isDone(s.order) ? 'border-brand bg-brand-fill text-white' : i === nextIdx ? 'border-info text-info-ink' : 'border-line-strong text-muted')}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="id">{s.outlet.id}</span>
                <span className="block truncate text-xs text-muted">{s.outlet.name}</span>
              </span>
              <span className="text-sm tabular-nums text-muted">{isDone(s.order) ? t(`status.${s.order.status}`) : fmtMin(s.plan.eta)}</span>
            </li>
          ))}
        </ol>
      </Section>

      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-4 backdrop-blur lg:bottom-0 lg:left-[252px]">
        <div className="mx-auto max-w-xl">
          {next && <p className="mb-2 text-center text-xs text-muted">{t('driver.reconcile.next', { id: next.outlet.id, time: fmtMin(next.plan.eta) })}</p>}
          <Button
            size="xl"
            block
            icon={<ArrowRight className="size-5" />}
            onClick={() => {
              ack()
              navigate('/driver/route')
            }}
          >
            {t('driver.reconcile.ack')}
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-muted">{t('driver.reconcile.ack_hint')}</p>
        </div>
      </div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </Card>
  )
}

function Row({ id, name, detail, tone, extra }: { id: string; name?: string; detail?: string; tone: 'done' | 'removed' | 'added'; extra?: React.ReactNode }) {
  return (
    <div className={cn('border-l-4 px-4 py-3', tone === 'done' ? 'border-brand' : tone === 'removed' ? 'border-attention' : 'border-info')}>
      <div className={cn('id text-lg', tone === 'removed' && 'line-through decoration-attention decoration-2')}>{id}</div>
      {name && <div className="text-sm text-muted">{name}</div>}
      {detail && <div className="mt-1 text-sm">{detail}</div>}
      {extra}
    </div>
  )
}
