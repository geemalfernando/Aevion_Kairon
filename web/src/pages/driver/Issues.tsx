import { MapPin, ShieldAlert, Snowflake } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { timeAgo } from '@core/time'
import { Badge, Button, Callout, Card, ChoiceList, EmptyState, Field, SeverityBadge, Textarea, toast } from '../../components/ui'
import { isDone } from '../../lib/select'
import { useDevice, useNetwork, useNow } from '../../store'
import { useDriverRoute } from './common'

const KINDS = ['Breakdown', 'Flat tyre', 'Engine warning', 'Refrigeration failure', 'Accident', 'Road blocked', 'Other'] as const
const DELAYS = ['30', '60', '90'] as const

export function Issues() {
  const { d, trip, vehicle, stops } = useDriverRoute()
  const record = useDevice((s) => s.record)
  const net = useNetwork()
  const now = useNow()
  const { t } = useTranslation()
  const [kind, setKind] = useState<(typeof KINDS)[number] | null>(null)
  const [note, setNote] = useState('')
  const [late, setLate] = useState<string | null>(null)
  const [delay, setDelay] = useState<(typeof DELAYS)[number] | null>(null)
  const [step, setStep] = useState<'pick' | 'confirm'>('pick')
  const remaining = stops.filter((s) => !isDone(s.order))
  const chilled = remaining.filter((s) => s.order.temp === 'CHILLED')
  const history = d.issues.filter((i) => i.vehicleId === vehicle.id)
  const active = history.find((i) => !i.resolved && (i.kind === 'BREAKDOWN' || i.kind === 'REEFER_FAILURE'))

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-3xl font-bold">{t('driver.issue.title')}</h1>
      <p className="text-sm text-muted">{t('driver.issue.subtitle')}</p>

      {active || trip?.status === 'PAUSED' ? (
        <Card className="mt-6 p-6">
          <div className="flex items-center gap-2 text-critical-ink">
            <ShieldAlert className="size-6" />
            <span className="font-display text-xl font-bold">{t('driver.issue.reported')}</span>
          </div>
          <ul className="mt-4 space-y-2 text-[15px]">
            <li>✓ {net.online ? t('driver.issue.notified') : t('driver.issue.notified_later')}</li>
            <li className="font-semibold">{t('driver.issue.stay')}</li>
            <li>
              {t('driver.issue.current_route')} <Badge tone="critical">{t('trip.PAUSED')}</Badge>
            </li>
            <li>{t('driver.issue.awaiting', { count: remaining.length })}</li>
          </ul>
        </Card>
      ) : !trip || !['LOADED', 'IN_PROGRESS'].includes(trip.status) ? (
        <Card className="mt-6">
          <EmptyState icon={<ShieldAlert className="size-5" />} title={t('driver.issue.none')} body={t('driver.issue.none_body')} />
        </Card>
      ) : step === 'pick' ? (
        <Card className="mt-6 space-y-4 p-5">
          <ChoiceList name={t('driver.issue.issue')} value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`driver.issue.kinds.${k}`) }))} />
          {kind === 'Road blocked' && (
            <>
              <ChoiceList name={t('driver.issue.blocked_stop')} value={late} onChange={setLate} columns={2} options={[...remaining.map((s) => ({ value: s.order.id, label: s.outlet.id, hint: s.outlet.name })), { value: 'all', label: t('driver.issue.blocked_all') }]} />
              <ChoiceList name={t('driver.issue.blocked_delay')} value={delay} onChange={setDelay} columns={2} options={DELAYS.map((n) => ({ value: n, label: t('driver.issue.delay_min', { n }) }))} />
            </>
          )}
          <Field label={t('driver.issue.details')}>{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          {kind === 'Road blocked' ? (
            <>
              <p className="text-sm text-muted">{t('driver.issue.blocked_hint')}</p>
              <Button
                size="xl"
                block
                disabled={!late || !delay}
                onClick={() => {
                  record({ type: 'VEHICLE_ISSUE', vehicleId: vehicle.id, tripId: trip.id, kind: 'Road blocked', delayOrderId: late === 'all' ? undefined : late!, delayMin: Number(delay), note: note.trim() || undefined })
                  toast(t('driver.issue.toast_blocked'), { body: net.online ? t('driver.issue.toast_online') : t('driver.issue.toast_offline') })
                  setKind(null)
                  setLate(null)
                  setDelay(null)
                  setNote('')
                }}
              >
                {t('driver.issue.report_blocked')}
              </Button>
            </>
          ) : (
            <Button size="xl" block variant="danger" disabled={!kind} onClick={() => setStep('confirm')}>
              {t('driver.issue.continue')}
            </Button>
          )}
        </Card>
      ) : (
        <Card className="mt-6 space-y-4 p-5">
          {kind === 'Refrigeration failure' && chilled.length > 0 && (
            <Callout tone="critical" icon={<Snowflake className="size-5" />} title={t('driver.issue.reefer_title')}>
              {t('driver.issue.reefer_body', { ids: chilled.map((s) => s.outlet.id).join(', ') })}
            </Callout>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-xs text-muted">{t('driver.issue.vehicle')}</dt>
              <dd className="id text-lg">{vehicle.id}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-xs text-muted">{t('driver.issue.issue')}</dt>
              <dd className="font-semibold">{kind && t(`driver.issue.kinds.${kind}`)}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-xs text-muted">{t('driver.issue.remaining')}</dt>
              <dd className="font-display text-lg font-semibold">{remaining.length}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-xs text-muted">{t('driver.issue.chilled_goods')}</dt>
              <dd className="font-semibold">{chilled.length ? t('common.yes') : t('common.no')}</dd>
            </div>
          </dl>
          <p className="flex items-center gap-2 text-sm text-muted">
            <MapPin className="size-4" /> {t('driver.issue.location')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="xl" onClick={() => setStep('pick')}>
              {t('common.back')}
            </Button>
            <Button
              size="xl"
              variant="danger"
              onClick={() => {
                record({ type: 'VEHICLE_ISSUE', vehicleId: vehicle.id, tripId: trip.id, kind: kind!, note: note.trim() || undefined })
                toast(t('driver.issue.toast'), { tone: 'critical', body: net.online ? t('driver.issue.toast_online') : t('driver.issue.toast_offline') })
                setStep('pick')
                setKind(null)
              }}
            >
              {kind === 'Refrigeration failure' ? t('driver.issue.report_failure') : t('driver.issue.report_breakdown')}
            </Button>
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold">{t('driver.issue.recent')}</h2>
          <Card className="divide-y divide-line">
            {history.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-5 py-3">
                <SeverityBadge s={i.severity} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{i.title}</div>
                  <div className="text-xs text-muted">{i.resolved ? i.resolved.decision : i.detail}</div>
                </div>
                <span className="text-xs text-faint">{timeAgo(i.createdAt, now)}</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
