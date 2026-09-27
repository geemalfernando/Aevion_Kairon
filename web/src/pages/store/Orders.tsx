import { ArrowLeft, ClipboardList, PackagePlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AuditTimeline } from '../../components/AuditTimeline'
import { Button, Card, CardHeader, EmptyState, PageHeader, StatusBadge, Timeline } from '../../components/ui'
import { fmtDate } from '@core/time'
import { auditFor, storeOrders, unitsOf } from '../../lib/select'
import { useSession, useView } from '../../store'
import { deliveryTimeline, OrderSummary, ReceiptForm, ReportIssueModal, RescheduledCard } from './shared'

export function Orders() {
  const d = useView()
  const user = useSession((s) => s.user)!
  const orders = storeOrders(d, user.assignedOutlet)
  return (
    <>
      <PageHeader
        eyebrow="Orders"
        title="Your orders"
        actions={
          <Link to="/store/orders/new">
            <Button icon={<PackagePlus className="size-4" />}>Create order</Button>
          </Link>
        }
      />
      {orders.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardList className="size-5" />} title="No orders yet" />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {orders.map((o) => (
            <Link key={o.id} to={`/store/orders/${o.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-surface-2">
              <span className="id w-24">{o.id}</span>
              <span className="flex-1 text-sm text-muted">
                {fmtDate(o.deliveryDate, { weekday: 'short', day: 'numeric', month: 'short' })} · {unitsOf(o)} units · {o.temp === 'CHILLED' ? 'Chilled' : 'Ambient'}
              </span>
              <StatusBadge s={o.status} />
            </Link>
          ))}
        </Card>
      )}
    </>
  )
}

export function OrderDetail() {
  const { id } = useParams()
  const d = useView()
  const user = useSession((s) => s.user)!
  const o = d.orders.find((x) => x.id === id && x.outletId === user.assignedOutlet)
  const [reporting, setReporting] = useState(false)
  if (!o) return <EmptyState icon={<ClipboardList className="size-5" />} title="Order not found" />
  return (
    <>
      <Link to="/store/orders" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Orders
      </Link>
      <PageHeader
        eyebrow={fmtDate(o.deliveryDate, { weekday: 'long', day: 'numeric', month: 'long' })}
        title={
          <span className="flex items-center gap-3">
            <span className="id">{o.id}</span> <StatusBadge s={o.status} />
          </span>
        }
        actions={
          ['DELIVERED', 'PARTIAL', 'RECEIVED', 'FAILED'].includes(o.status) && (
            <Button variant="secondary" onClick={() => setReporting(true)}>
              Report issue
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {o.status === 'DEFERRED' && o.deferral?.confirmed && <RescheduledCard o={o} />}
          <Card className="p-5">
            <OrderSummary o={o} />
          </Card>
          {['DELIVERED', 'PARTIAL'].includes(o.status) && (
            <Card className="p-5">
              <ReceiptForm o={o} />
            </Card>
          )}
          <Card>
            <CardHeader title="Items" eyebrow={`${unitsOf(o)} units`} />
            <ul className="divide-y divide-line text-sm">
              {o.items.map((i) => (
                <li key={i.name} className="flex justify-between px-5 py-3">
                  {i.name}
                  <span className="tabular-nums text-muted">
                    {i.qty} {i.unit}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          {o.delivery?.photo || o.delivery?.signature ? (
            <Card className="p-5">
              <div className="eyebrow mb-3">Proof of delivery</div>
              <div className="flex flex-wrap gap-4">
                {o.delivery.photo && <img src={o.delivery.photo} alt="Delivery photo" className="h-32 rounded-lg border border-line object-cover" />}
                {o.delivery.signature && <img src={o.delivery.signature} alt="Receiver signature" className="h-32 rounded-lg border border-line bg-white" />}
              </div>
              {o.delivery.receiver && <p className="mt-2 text-sm text-muted">Received by {o.delivery.receiver}</p>}
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          {o.status !== 'DEFERRED' && (
            <Card className="p-5">
              <div className="eyebrow mb-4">Tracking</div>
              <Timeline items={deliveryTimeline(o)} />
            </Card>
          )}
          <Card className="p-5">
            <div className="eyebrow mb-4">Full history</div>
            <AuditTimeline events={auditFor(d, o.id)} />
          </Card>
        </div>
      </div>
      <ReportIssueModal o={o} open={reporting} onClose={() => setReporting(false)} />
    </>
  )
}
