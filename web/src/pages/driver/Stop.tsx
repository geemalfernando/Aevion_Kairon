import { ArrowLeft, Check, CheckCircle2, CloudOff, MapPin, Phone, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fmtClock, fmtMin, fmtWindow } from '@core/time'
import type { DeliveryRecord } from '@core/types'
import { PhotoCapture, SignaturePad } from '../../components/ProofCapture'
import { Badge, Button, Callout, Card, ChoiceList, EmptyState, Field, Input, TempTag, Textarea, toast } from '../../components/ui'
import { isDone, unitsOf } from '../../lib/select'
import { MODAL } from '../../demo/mode'
import { useDevice, useNetwork, useNow } from '../../store'
import { useDriverRoute } from './common'

type Outcome = DeliveryRecord['outcome']

export function Stop() {
  const { orderId } = useParams()
  const { trip, stops, d, nextIdx } = useDriverRoute()
  const record = useDevice((s) => s.record)
  const net = useNetwork()
  const now = useNow()
  const navigate = useNavigate()
  const { t } = useTranslation()
  // ?modal=proof opens the proof-of-delivery form already filled in (for previews).
  const proof = MODAL === 'proof'
  const [delivering, setDelivering] = useState(proof)
  const [outcome, setOutcome] = useState<Outcome | null>(proof ? 'DELIVERED' : null)
  const [receiver, setReceiver] = useState(proof ? 'Priyanka' : '')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<string>()
  const [signature, setSignature] = useState<string>()
  const [itemsOk, setItemsOk] = useState(proof)
  const [delivered, setDelivered] = useState<Record<string, number>>({})

  // /driver/stop/next opens the next stop on the route.
  const idx = orderId === 'next' ? nextIdx : stops.findIndex((s) => s.order.id === orderId)
  const s = stops[idx]
  const moved = !s && orderId ? d.orders.find((o) => o.id === orderId) : undefined
  if (!trip || !s)
    return moved ? (
      <div className="mx-auto max-w-xl">
        <Callout tone="attention" title={t('driver.stop.reassigned')}>
          {t('driver.stop.reassigned_body')}
        </Callout>
        <Link to="/driver/route" className="mt-4 inline-block text-sm font-semibold text-brand-ink">
          {t('driver.stop.back_route')}
        </Link>
      </div>
    ) : (
      <EmptyState icon={<MapPin className="size-5" />} title={t('driver.stop.not_found')} action={<Link to="/driver/route">{t('driver.stop.back_route')}</Link>} />
    )
  const { order: o, outlet, plan } = s
  const failed = outcome === 'REFUSED' || outcome === 'CLOSED' || outcome === 'NO_ACCESS'
  const nextStop = stops.slice(idx + 1).find((x) => !isDone(x.order))
  const paused = trip.status === 'PAUSED' || trip.status === 'ABORTED'
  const late = now > 0 && plan.late

  const arrive = () => {
    record({ type: 'ARRIVE', orderId: o.id, tripId: trip.id })
    toast(t('driver.stop.toast_arrived', { id: outlet.id }), { tone: 'info', body: net.online ? t('driver.stop.toast_store_notified') : t('driver.stop.toast_saved_device') })
  }

  const complete = () => {
    const rec: DeliveryRecord = {
      outcome: outcome!,
      receiver: receiver.trim() || undefined,
      notes: [notes.trim(), outcome === 'PARTIAL' ? o.items.map((i) => `${i.name} ${delivered[i.name] ?? i.qty}/${i.qty}`).join(', ') : ''].filter(Boolean).join(' · ') || undefined,
      completedAt: now,
      arrivedAt: o.delivery?.arrivedAt,
      offline: !net.online || undefined,
    }
    record({ type: 'DELIVER', orderId: o.id, tripId: trip.id, record: rec })
    if (photo) record({ type: 'PROOF', orderId: o.id, photo })
    if (signature) record({ type: 'PROOF', orderId: o.id, signature })
    toast(failed ? t('driver.stop.toast_failed') : t('driver.stop.toast_done'), {
      tone: failed ? 'attention' : 'success',
      body: net.online ? t('driver.stop.toast_synced') : t('driver.stop.toast_saved_n', { count: 1 + (photo ? 1 : 0) + (signature ? 1 : 0) }),
    })
    setDelivering(false)
  }

  const canComplete = outcome && (failed ? true : receiver.trim() && itemsOk && (photo || signature))

  return (
    <div className="mx-auto max-w-xl">
      <Link to="/driver/route" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {t('nav.route')}
      </Link>
      <div className="eyebrow">{t('driver.stop.of', { n: idx + 1, total: stops.length })}</div>
      <div className="mt-1 flex items-start justify-between gap-2">
        <h1 className="id text-4xl">{outlet.id}</h1>
        <TempTag temp={o.temp} />
      </div>
      <p className="text-muted">
        {outlet.name} · {outlet.district} · {t(`access.${outlet.dock}`)}
      </p>

      {isDone(o) ? (
        <Card className="mt-6 p-6 text-center">
          <CheckCircle2 className={`mx-auto size-12 ${o.status === 'FAILED' ? 'text-critical' : 'text-brand'}`} />
          <div className="mt-3 font-display text-xl font-semibold">{o.status === 'FAILED' ? t('driver.stop.failed') : o.status === 'PARTIAL' ? t('driver.stop.partial') : t('driver.stop.delivered')}</div>
          <p className="mt-1 text-sm text-muted">
            {o.delivery?.completedAt && t('driver.stop.at', { time: fmtClock(o.delivery.completedAt) })} {o.delivery?.receiver && `· ${t('driver.stop.received_by', { name: o.delivery.receiver })}`}
          </p>
          {o.delivery?.offline && (
            <Badge tone="neutral" className="mt-3">
              <CloudOff className="size-3" /> {t('driver.stop.recorded_offline')}
            </Badge>
          )}
          {nextStop ? (
            <Link to={`/driver/stop/${nextStop.order.id}`} className="mt-6 block">
              <Button size="xl" block>
                {t('driver.stop.next', { id: nextStop.outlet.id })}
              </Button>
            </Link>
          ) : (
            <Button size="xl" block className="mt-6" onClick={() => navigate('/driver')}>
              {t('driver.stop.finish')}
            </Button>
          )}
        </Card>
      ) : o.status !== 'ARRIVED' ? (
        <Card className="mt-6 p-5">
          <div className="grid grid-cols-3 gap-3">
            <Info label={t('common.eta')} value={fmtMin(plan.eta)} />
            <Info label={t('common.window')} value={fmtWindow(outlet.window)} />
            <Info label={t('common.items')} value={`${unitsOf(o)}`} />
          </div>
          {late && <WindowClosed windowEnd={outlet.window[1]} />}
          <Button size="xl" block className="mt-5" disabled={paused || trip.status !== 'IN_PROGRESS'} onClick={arrive}>
            {t('driver.stop.arrived_btn')}
          </Button>
          {trip.status !== 'IN_PROGRESS' && !paused && <p className="mt-2 text-center text-xs text-muted">{t('driver.stop.start_first')}</p>}
        </Card>
      ) : !delivering ? (
        <Card className="mt-6 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Info label={t('driver.stop.arrived')} value={o.delivery?.arrivedAt ? fmtClock(o.delivery.arrivedAt) : '—'} />
            <Info label={t('driver.stop.closes')} value={fmtMin(outlet.window[1])} />
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-surface-2 p-4">
            <span className="text-sm text-muted">{t('driver.stop.status')}</span>
            {late ? (
              <Badge tone="critical">{t('driver.stop.late')}</Badge>
            ) : (
              <span className="inline-flex items-center gap-1 font-semibold text-brand-ink">
                {t('driver.stop.on_time')} <Check className="size-4" strokeWidth={3} />
              </span>
            )}
          </div>
          {late && <WindowClosed windowEnd={outlet.window[1]} />}
          <Button size="xl" block className="mt-5" onClick={() => setDelivering(true)}>
            {t('driver.stop.begin')}
          </Button>
        </Card>
      ) : (
        <div className="mt-6 space-y-4">
          <Card className="p-5">
            <div className="eyebrow mb-3">{t('driver.stop.outcome')}</div>
            <ChoiceList
              name={t('driver.stop.outcome')}
              value={outcome}
              onChange={setOutcome}
              options={[
                { value: 'DELIVERED', label: t('driver.stop.o_delivered') },
                { value: 'PARTIAL', label: t('driver.stop.o_partial') },
                { value: 'REFUSED', label: t('driver.stop.o_refused') },
                { value: 'CLOSED', label: t('driver.stop.o_closed'), hint: t('driver.stop.o_closed_hint') },
                { value: 'NO_ACCESS', label: t('driver.stop.o_access'), hint: outlet.mall ? t('driver.stop.o_access_mall') : t('driver.stop.o_access_hint') },
              ]}
            />
          </Card>

          {outcome && !failed && (
            <Card className="p-5">
              <div className="eyebrow mb-3">{t('common.items')}</div>
              <ul className="divide-y divide-line text-sm">
                {o.items.map((i) => (
                  <li key={i.name} className="flex items-center justify-between py-2.5">
                    <span>{i.name}</span>
                    {outcome === 'PARTIAL' ? (
                      <span className="flex items-center gap-2">
                        <input inputMode="numeric" className="h-10 w-14 rounded-lg border border-line-strong bg-surface text-center" value={delivered[i.name] ?? i.qty} onChange={(e) => setDelivered((x) => ({ ...x, [i.name]: Math.min(i.qty, Number(e.target.value.replace(/\D/g, '')) || 0) }))} aria-label={i.name} />
                        <span className="text-muted">/ {i.qty}</span>
                      </span>
                    ) : (
                      <span className="tabular-nums text-muted">
                        {i.qty} {i.unit}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <Button variant={itemsOk ? 'secondary' : 'primary'} block className="mt-3" icon={itemsOk ? <Check className="size-4" /> : undefined} onClick={() => setItemsOk(true)}>
                {itemsOk ? t('driver.stop.items_confirmed') : t('driver.stop.confirm_items')}
              </Button>
            </Card>
          )}

          {outcome && (
            <Card className="space-y-4 p-5">
              {!failed && <Field label={t('driver.stop.receiver')}>{(id) => <Input id={id} value={receiver} onChange={(e) => setReceiver(e.target.value)} autoComplete="off" />}</Field>}
              <div>
                <div className="mb-2 text-sm font-medium">{failed ? t('driver.stop.outlet_photo') : t('driver.stop.proof_photo')}</div>
                <PhotoCapture value={photo} onChange={setPhoto} label={t('driver.stop.take_photo')} />
              </div>
              {!failed && (
                <div>
                  <div className="mb-2 text-sm font-medium">{t('driver.stop.signature')}</div>
                  <SignaturePad value={signature} onChange={setSignature} />
                </div>
              )}
              <Field label={t('common.notes')}>{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
              {!failed && !(photo || signature) && <p className="text-xs text-muted">{t('driver.stop.proof_required')}</p>}
            </Card>
          )}

          <Button size="xl" block variant={failed ? 'attention' : 'primary'} disabled={!canComplete} onClick={complete}>
            {failed ? t('driver.stop.record_failed') : t('driver.stop.complete')}
          </Button>
          {!net.online && <p className="text-center text-xs text-muted">{t('driver.stop.offline_note')}</p>}
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function WindowClosed({ windowEnd }: { windowEnd: number }) {
  const { t } = useTranslation()
  return (
    <Callout
      tone="critical"
      icon={<TriangleAlert className="size-5" />}
      title={t('driver.stop.closed_title')}
      className="mt-4"
      action={
        <a href="tel:+94110000000">
          <Button size="sm" variant="secondary" icon={<Phone className="size-4" />}>
            {t('driver.stop.contact_store')}
          </Button>
        </a>
      }
    >
      {t('driver.stop.closed_body', { time: fmtMin(windowEnd) })}
    </Callout>
  )
}
