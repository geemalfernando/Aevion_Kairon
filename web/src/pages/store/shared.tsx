import { CalendarClock, Check, PackageCheck } from 'lucide-react'
import { useState } from 'react'
import { PhotoCapture } from '../../components/ProofCapture'
import { Badge, Button, Callout, ChoiceList, Field, Input, Modal, Textarea, Timeline, toast } from '../../components/ui'
import { fmtClock, fmtDate, fmtMin, fmtWindow } from '@core/time'
import type { Order } from '@core/types'
import { outletOf, scheduleOf, tripOf, unitsOf } from '../../lib/select'
import { ops, useOps } from '../../store'
import type { OpsData } from '@core/types'

const REACHED: Record<Order['status'], number> = { CONFIRMED: 0, DEFERRED: 0, PLANNED: 1, LOADED: 2, IN_TRANSIT: 3, ARRIVED: 4, DELIVERED: 5, PARTIAL: 5, FAILED: 5, RECEIVED: 6 }

/** Seven-step journey the store sees; the step in progress pulses, problems turn orange. */
export function deliveryTimeline(o: Order) {
  const r = REACHED[o.status]
  const steps = ['Order confirmed', 'Scheduled', 'Loaded', 'In transit', 'Arrived', 'Delivered', 'Receipt confirmed']
  return steps.map((label, i) => {
    let state: 'done' | 'current' | 'todo' | 'problem' = i <= r ? 'done' : i === r + 1 ? 'current' : 'todo'
    if (o.status === 'IN_TRANSIT' && i === 3) state = 'current'
    if (o.status === 'IN_TRANSIT' && i === 4) state = 'todo'
    if ((o.status === 'FAILED' || o.status === 'PARTIAL') && i === 5) state = 'problem'
    if (o.status === 'FAILED' && i === 6) state = 'todo'
    const sub = i === 5 && o.status === 'FAILED' ? 'Failed attempt' : i === 5 && o.status === 'PARTIAL' ? 'Partial delivery' : undefined
    return { label, state, sub }
  })
}

export function etaFor(d: OpsData, o: Order) {
  const t = tripOf(d, o.tripId)
  if (!t) return null
  const s = o.projectedEta ? { eta: o.projectedEta.minutes, window: o.projectedEta.window } : scheduleOf(d, t).stops.find((x) => x.orderId === o.id)
  if (!s) return null
  return { from: fmtMin(s.eta), to: fmtMin(s.eta + 20), window: fmtWindow(s.window), vehicle: t.vehicleId, trip: t.number }
}

export function RescheduledCard({ o }: { o: Order }) {
  const next = o.deferral?.nextRun ?? o.deliveryDate
  return (
    <div className="rounded-2xl border border-attention/50 bg-attention-soft p-5">
      <div className="flex items-center gap-2 text-attention-ink">
        <CalendarClock className="size-5" />
        <span className="font-display text-lg font-bold uppercase tracking-wide">Delivery rescheduled</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-muted">Original delivery</div>
          <div className="font-semibold line-through decoration-attention">{fmtDate(o.deliveryDate)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">New expected delivery</div>
          <div className="font-semibold">{fmtDate(next, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="text-xs text-muted">Reason · {o.deferral?.reason}</div>
        <p className="mt-0.5 text-[15px]">{o.deferral?.customerMessage}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          Priority for next run <Badge tone="attention">HIGH</Badge>
        </span>
        {o.deferral?.acknowledged ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted">
            <Check className="size-4" /> Acknowledged
          </span>
        ) : (
          <Button variant="attention" onClick={() => (ops('acknowledgeDeferral', o.id), toast('Thanks — we’ll notify you when the new route is confirmed', { tone: 'info' }))}>
            Acknowledge
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">You will be notified when the new route is confirmed.</p>
    </div>
  )
}

export function ReceiptForm({ o, compact }: { o: Order; compact?: boolean }) {
  const expected = unitsOf(o) - (o.shortfall && o.shortfall.decision !== 'Replace stock' ? o.shortfall.missing : 0)
  const [received, setReceived] = useState(String(expected))
  const [condition, setCondition] = useState<'GOOD' | 'MISSING' | 'DAMAGED' | 'INCORRECT'>('GOOD')
  const [receiver, setReceiver] = useState(o.delivery?.receiver ?? '')
  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center gap-2 text-brand-ink">
          <PackageCheck className="size-5" />
          <span className="font-display text-lg font-bold uppercase tracking-wide">Delivery arrived</span>
        </div>
      )}
      {o.delivery?.offline && <Callout tone="info" title="Recorded offline by the driver">This delivery was captured without signal and synchronized later — the record is complete.</Callout>}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="text-xs text-muted">Expected</div>
          <div className="font-display text-2xl font-semibold">{expected} units</div>
        </div>
        <Field label="Received">{(id) => <Input id={id} inputMode="numeric" value={received} onChange={(e) => setReceived(e.target.value.replace(/\D/g, ''))} />}</Field>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">Condition</div>
        <ChoiceList
          name="Condition"
          columns={2}
          value={condition}
          onChange={setCondition}
          options={[
            { value: 'GOOD', label: '✓ Good' },
            { value: 'MISSING', label: 'Missing items' },
            { value: 'DAMAGED', label: 'Damaged' },
            { value: 'INCORRECT', label: 'Incorrect items' },
          ]}
        />
      </div>
      <Field label="Receiver">{(id) => <Input id={id} value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="Name" />}</Field>
      <Button
        size="lg"
        block
        disabled={!receiver.trim() || !received}
        onClick={() => {
          ops('confirmReceipt', o.id, { received: Number(received), condition, receiver: receiver.trim() })
          toast('Receipt confirmed', { body: condition === 'GOOD' ? 'Audit trail complete.' : 'An issue was raised with the dispatcher.' })
        }}
      >
        Confirm receipt
      </Button>
    </div>
  )
}

const ISSUE_KINDS = ['Missing goods', 'Damaged goods', 'Wrong quantity', 'Wrong product', 'Late delivery', 'Other'] as const

export function ReportIssueModal({ o, open, onClose }: { o?: Order; open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<(typeof ISSUE_KINDS)[number] | null>(null)
  const [desc, setDesc] = useState('')
  const [photo, setPhoto] = useState<string>()
  if (!o) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={o.id}
      title="Report delivery issue"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!kind}
            onClick={() => {
              ops('storeIssue', o.id, kind!, desc.trim() + (photo ? ' (photo attached)' : ''))
              toast('Issue reported', { body: 'The dispatcher has been notified.' })
              onClose()
            }}
          >
            Submit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ChoiceList name="Issue type" columns={2} value={kind} onChange={setKind} options={ISSUE_KINDS.map((k) => ({ value: k, label: k }))} />
        <Field label="Description">{(id) => <Textarea id={id} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What happened?" />}</Field>
        <div>
          <div className="mb-2 text-sm font-medium">Photo</div>
          <PhotoCapture value={photo} onChange={setPhoto} label="Upload photo" />
        </div>
      </div>
    </Modal>
  )
}

export function OrderSummary({ o }: { o: Order }) {
  const d = useOps((s) => s.data)
  const eta = etaFor(d, o)
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-xs text-muted">Delivery date</dt>
        <dd className="font-semibold">{fmtDate(o.deliveryDate)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Vehicle</dt>
        <dd className="id">{eta ? `${eta.vehicle} · Trip ${eta.trip}` : '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Estimated arrival</dt>
        <dd className="font-semibold tabular-nums">{eta && !['DELIVERED', 'RECEIVED', 'PARTIAL'].includes(o.status) ? `${eta.from}–${eta.to}` : o.delivery?.completedAt ? `Delivered ${fmtClock(o.delivery.completedAt)}` : '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Delivery window</dt>
        <dd className="font-semibold tabular-nums">{fmtWindow(outletOf(d, o.outletId)!.window)}</dd>
      </div>
    </dl>
  )
}

export { Timeline }
