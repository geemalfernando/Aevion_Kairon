import { Lock, Search, Snowflake } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, Callout, Card, cn, Modal, PageHeader, Select, StatusBadge, toast } from '../../components/ui'
import { fmtDate, fmtWindow } from '@core/time'
import type { Order, OrderStatus } from '@core/types'
import { outletOf, tripOf } from '../../lib/select'
import { ops, useOps } from '../../store'
import { DeferModal, OrderDrawer } from './shared'

export function Orders() {
  const d = useOps((s) => s.data)
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [district, setDistrict] = useState('')
  const [temp, setTemp] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<'priority' | 'window' | 'volume'>('priority')
  const [deferring, setDeferring] = useState<Order>()
  const open = params.get('o') ? d.orders.find((o) => o.id === params.get('o')) : undefined
  const closing = params.get('close') === '1'

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return d.orders
      .map((o) => ({ o, out: outletOf(d, o.outletId)! }))
      .filter(({ o, out }) => (!s || o.id.toLowerCase().includes(s) || out.id.toLowerCase().includes(s) || out.name.toLowerCase().includes(s)) && (!brand || o.brand === brand) && (!district || out.district === district) && (!temp || o.temp === temp) && (!status || o.status === status))
      .sort((a, b) => (sort === 'priority' ? b.o.priority - a.o.priority : sort === 'window' ? a.out.window[0] - b.out.window[0] : b.o.volumeM3 - a.o.volumeM3))
  }, [d, q, brand, district, temp, status, sort])

  const districts = [...new Set(d.outlets.map((o) => o.district))]
  const statuses: OrderStatus[] = ['CONFIRMED', 'PLANNED', 'DEFERRED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RECEIVED']

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Orders"
        subtitle={`${d.orders.length} orders for ${fmtDate(d.deliveryDate)} · ${d.ordersClosed ? 'closed for planning' : 'accepting orders until 16:00'}`}
        actions={
          d.ordersClosed ? (
            <Badge tone="brand" dot>
              Orders closed
            </Badge>
          ) : (
            <Button icon={<Lock className="size-4" />} onClick={() => setParams({ close: '1' })}>
              Close orders
            </Button>
          )
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, outlet…" className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm focus:border-brand focus:outline-none" />
        </div>
        <Select value={brand} onChange={(e) => setBrand(e.target.value)} className="w-auto" aria-label="Brand">
          <option value="">All brands</option>
          {['Fresh', 'Style', 'Tech'].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </Select>
        <Select value={district} onChange={(e) => setDistrict(e.target.value)} className="w-auto" aria-label="District">
          <option value="">All districts</option>
          {districts.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </Select>
        <Select value={temp} onChange={(e) => setTemp(e.target.value)} className="w-auto" aria-label="Temperature">
          <option value="">Any temperature</option>
          <option value="CHILLED">Chilled</option>
          <option value="AMBIENT">Ambient</option>
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status">
          <option value="">Any status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ').toLowerCase()}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto" aria-label="Sort">
          <option value="priority">Sort: priority</option>
          <option value="window">Sort: window</option>
          <option value="volume">Sort: size</option>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                {['Order', 'Outlet', 'Brand', 'Temp', 'Size', 'Window', 'Priority', 'Vehicle', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ o, out }) => (
                <tr key={o.id} onClick={() => setParams({ o: o.id })} className="cursor-pointer transition hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <span className="id">{o.id}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="id">{out.id}</span>
                    <span className="block text-xs text-muted">{out.name}</span>
                  </td>
                  <td className="px-4 py-3">{o.brand}</td>
                  <td className="px-4 py-3">
                    {o.temp === 'CHILLED' ? (
                      <span className="inline-flex items-center gap-1 text-info-ink">
                        <Snowflake className="size-3.5" /> Chilled
                      </span>
                    ) : (
                      <span className="text-muted">Ambient</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {o.volumeM3} m³<span className="block text-xs text-muted">{o.weightKg} kg</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{fmtWindow(out.window)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('font-semibold tabular-nums', o.priority >= 80 && 'text-attention-ink')}>{o.priority}</span>
                  </td>
                  <td className="px-4 py-3">{tripOf(d, o.tripId)?.vehicleId ?? <span className="text-faint">—</span>}</td>
                  <td className="px-4 py-3">
                    <StatusBadge s={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-10 text-center text-sm text-muted">No orders match these filters.</p>}
        </div>
      </Card>

      <OrderDrawer order={open} onClose={() => setParams({})} onDefer={(o) => setDeferring(o)} />
      <DeferModal key={deferring?.id} order={deferring} open={!!deferring} onClose={() => setDeferring(undefined)} />
      <CloseOrdersModal open={closing} onClose={() => setParams({})} />
    </>
  )
}

function CloseOrdersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useOps((s) => s.data)
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const confirmed = d.orders.filter((o) => o.status === 'CONFIRMED' && o.deliveryDate === d.deliveryDate)
  const by = (b: string) => confirmed.filter((o) => o.brand === b).length
  const vol = confirmed.reduce((s, o) => s + o.volumeM3, 0)
  const chilled = confirmed.filter((o) => o.temp === 'CHILLED').reduce((s, o) => s + o.volumeM3, 0)
  const close = () => {
    setConfirming(false)
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      eyebrow="16:00 cutoff"
      title={confirming ? 'Close orders?' : 'Orders close'}
      footer={
        confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                ops('closeOrders')
                toast('Orders closed', { body: `${confirmed.length} orders entered the planning queue` })
                close()
                navigate('/dispatcher/planning')
              }}
            >
              Close orders
            </Button>
          </>
        ) : (
          <Button onClick={() => setConfirming(true)} disabled={d.ordersClosed}>
            Close orders & begin planning
          </Button>
        )
      }
    >
      {confirming ? (
        <Callout tone="info" title="Orders will now enter the planning queue.">
          Late orders will be moved to the next run.
        </Callout>
      ) : (
        <div className="space-y-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-muted">Delivery date</div>
              <div className="font-display text-xl font-semibold">{fmtDate(d.deliveryDate)}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-3xl font-semibold">{confirmed.length}</div>
              <div className="text-xs text-muted">confirmed orders</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['Fresh', 'Style', 'Tech'].map((b) => (
              <div key={b} className="rounded-lg bg-surface-2 p-3">
                <div className="text-xs text-muted">{b}</div>
                <div className="font-display text-xl font-semibold">{by(b)}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line p-3">
              <div className="text-xs text-muted">Total volume</div>
              <div className="font-display text-xl font-semibold">{Math.round(vol)} m³</div>
            </div>
            <div className="rounded-lg border border-info/40 bg-info-soft p-3">
              <div className="flex items-center gap-1 text-xs text-info-ink">
                <Snowflake className="size-3.5" /> Chilled
              </div>
              <div className="font-display text-xl font-semibold text-info-ink">{Math.round(chilled)} m³</div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
