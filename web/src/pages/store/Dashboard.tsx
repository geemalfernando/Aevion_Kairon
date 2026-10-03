import { ArrowRight, Clock, PackagePlus, TriangleAlert, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LocationMap } from '../../components/RouteMap'
import { Button, Callout, Card, CardHeader, EmptyState, PageHeader, StatusBadge, Timeline } from '../../components/ui'
import { fmtDate, fmtWindow, greeting } from '@core/time'
import { outletOf, storeOrders, unitsOf } from '../../lib/select'
import { MODAL } from '../../demo/mode'
import { useNow, useSession, useView } from '../../store'
import { useCutoff } from './NewOrder'
import { deliveryTimeline, etaFor, OrderSummary, ReceiptForm, ReportIssueModal, RescheduledCard } from './shared'

export function Dashboard() {
  const d = useView()
  const user = useSession((s) => s.user)!
  const out = outletOf(d, user.assignedOutlet)!
  const orders = storeOrders(d, out.id)
  const cutoff = useCutoff()
  const now = useNow()
  const [reporting, setReporting] = useState(MODAL === 'report-issue')
  // Focus on the order that needs attention most, soonest delivery first.
  const tripOf = (o: (typeof orders)[number]) => d.trips.find((t) => t.id === o.tripId)
  const byDate = [...orders].sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || b.createdAt - a.createdAt)
  const focus =
    byDate.find((o) => ['DELIVERED', 'PARTIAL'].includes(o.status)) ??
    byDate.find((o) => o.status === 'DEFERRED' && o.deferral?.confirmed && !o.deferral.acknowledged) ??
    byDate.find((o) => o.shortfall && !['DELIVERED', 'PARTIAL', 'RECEIVED'].includes(o.status)) ??
    // Something changed on the way: moved to another vehicle, or the driver reported a delay to this stop.
    byDate.find((o) => !['DELIVERED', 'PARTIAL', 'RECEIVED', 'DEFERRED'].includes(o.status) && (!!tripOf(o)?.rescue?.from || tripOf(o)?.reportedDelay?.orderId === o.id)) ??
    byDate.find((o) => ['ARRIVED', 'IN_TRANSIT', 'LOADED', 'FAILED'].includes(o.status)) ??
    byDate.find((o) => !['RECEIVED', 'DEFERRED'].includes(o.status)) ??
    orders[0]
  // The dispatcher moved this order to another vehicle mid-route.
  const trip = focus && d.trips.find((t) => t.id === focus.tripId)
  const moved = trip?.rescue?.from && focus && !['DELIVERED', 'PARTIAL', 'RECEIVED'].includes(focus.status) ? { to: trip.vehicleId, from: d.trips.find((t) => t.id === trip.rescue!.from)?.vehicleId, reason: trip.rescue.reason } : undefined

  // The driver reported a blocked road to this stop and the dispatcher hasn't moved it yet.
  const delay = trip?.reportedDelay?.orderId === focus?.id && focus && !['DELIVERED', 'PARTIAL', 'RECEIVED'].includes(focus.status) ? trip!.reportedDelay : undefined

  return (
    <>
      <PageHeader
        eyebrow={`${greeting(now)}, ${user.name}`}
        title={out.name}
        subtitle={
          <>
            <span className="id">{out.id}</span> · {out.district} · delivery window {fmtWindow(out.window)}
          </>
        }
        actions={
          <Link to="/store/orders/new">
            <Button icon={<PackagePlus className="size-4" />}>Create order</Button>
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          {focus ? (
            <>
              <CardHeader eyebrow={focus.status === 'DEFERRED' ? 'Needs your attention' : `Delivery · ${fmtDate(focus.deliveryDate, { weekday: 'long', day: 'numeric', month: 'long' })}`} title={<span className="flex items-center gap-3"><span className="id">{focus.id}</span> <StatusBadge s={focus.status} /></span>} action={<Link to={`/store/orders/${focus.id}`} className="text-sm font-medium text-brand-ink">Details</Link>} />
              <div className="space-y-6 p-5">
                {focus.status === 'DEFERRED' && focus.deferral?.confirmed ? (
                  <RescheduledCard o={focus} />
                ) : (
                  <>
                    <OrderSummary o={focus} />
                    <LocationMap outlet={out} depot={out.depot} vehicle={['IN_TRANSIT', 'ARRIVED'].includes(focus.status) ? etaFor(d, focus)?.vehicle : undefined} className="h-56" />
                    <div className="text-sm text-muted">{unitsOf(focus)} units · {focus.items.map((i) => `${i.qty} ${i.name}`).join(' · ')}</div>
                    {focus.shortfall && (
                      <Callout tone="attention" icon={<TriangleAlert className="size-5" />} title={`${focus.shortfall.missing} × ${focus.shortfall.item} unavailable at loading`}>
                        {focus.shortfall.decision ? `Dispatcher decision: ${focus.shortfall.decision}.` : 'The dispatcher is deciding how to proceed.'}
                      </Callout>
                    )}
                    {!moved && delay && (
                      <Callout tone="attention" icon={<Clock className="size-5" />} title={`Driver reported about ${delay.minutes} min delay on the way to you`}>
                        {delay.note ? `${delay.note}. ` : ''}The dispatcher has been told and may send this delivery on another vehicle.
                      </Callout>
                    )}
                    {moved && (
                      <Callout tone="info" icon={<Truck className="size-5" />} title={`Delivery vehicle changed: now ${moved.to}${moved.from ? ` instead of ${moved.from}` : ''}`}>
                        {moved.reason} The arrival time above is for the new vehicle — no need to wait for the original truck.
                      </Callout>
                    )}
                    {focus.status === 'FAILED' && <Callout tone="critical" title="Delivery attempt failed">{focus.delivery?.notes || 'The driver recorded a failed attempt. The dispatcher will reschedule.'}</Callout>}
                    {['DELIVERED', 'PARTIAL'].includes(focus.status) ? (
                      <div className="rounded-xl border border-brand/40 p-4">
                        <ReceiptForm o={focus} />
                        <button onClick={() => setReporting(true)} className="mt-3 w-full text-center text-sm font-medium text-muted underline">
                          Something wrong? Report an issue
                        </button>
                      </div>
                    ) : (
                      <Timeline items={deliveryTimeline(focus)} />
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <EmptyState icon={<PackagePlus className="size-5" />} title="No orders yet" body="Create your first order before today’s cutoff." />
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4 text-attention-ink" /> Order cutoff · 16:00
            </div>
            <div className="mt-2 font-display text-4xl font-semibold tabular-nums">{cutoff.passed ? 'Closed' : cutoff.label}</div>
            <p className="mt-1 text-sm text-muted">{cutoff.passed ? `New orders are delivered ${fmtDate(cutoff.deliveryDate, { weekday: 'long', day: 'numeric', month: 'long' })}.` : `Time remaining to order for ${fmtDate(cutoff.deliveryDate, { weekday: 'long' })}.`}</p>
            <Link to="/store/orders/new" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink">
              New order <ArrowRight className="size-4" />
            </Link>
          </Card>
          <Card>
            <CardHeader title="Recent orders" action={<Link to="/store/orders" className="text-sm font-medium text-brand-ink">All</Link>} />
            <ul className="divide-y divide-line">
              {orders.slice(0, 5).map((o) => (
                <li key={o.id}>
                  <Link to={`/store/orders/${o.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-surface-2">
                    <span>
                      <span className="id">{o.id}</span>
                      <span className="block text-xs text-muted">{fmtDate(o.deliveryDate)} · {unitsOf(o)} units</span>
                    </span>
                    <StatusBadge s={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <ReportIssueModal key={focus?.id} o={focus} open={reporting} onClose={() => setReporting(false)} />
    </>
  )
}
