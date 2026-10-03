import { CheckCircle2, Clock, Minus, Plus, Snowflake, Sun } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { catalogFor, measure, ORDER_CUTOFF, runForOrderPlacedAt, splitByTemp } from '@core/catalog'
import { colomboMinutes, fmtDate } from '@core/time'
import type { OrderItem } from '@core/types'
import { Badge, Button, Card, CardHeader, Field, PageHeader, Textarea, toast } from '../../components/ui'
import { outletOf } from '../../lib/select'
import { saveCommand, useNow, useOps, useSession } from '../../store'

/** Countdown to the 16:00 cutoff on the operation clock; after it, orders join the following operating day's run. */
export function useCutoff() {
  const now = useNow(1000)
  const cal = useOps((s) => s.data.calendar)
  const run = runForOrderPlacedAt(cal, now)
  const ms = Math.max(0, (ORDER_CUTOFF - colomboMinutes(now)) * 60_000)
  const hh = Math.floor(ms / 3.6e6)
  const mm = Math.floor((ms % 3.6e6) / 6e4)
  const ss = Math.floor((ms % 6e4) / 1000)
  return { passed: run.afterCutoff, label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, deliveryDate: run.date, urgent: !run.afterCutoff && ms < 3.6e6 }
}

export function NewOrder() {
  const user = useSession((s) => s.user)!
  const d = useOps((s) => s.data)
  const outlet = outletOf(d, user.assignedOutlet)!
  const [saving, setSaving] = useState(false)
  const cat = catalogFor(outlet.brand, d.catalog)
  const products = [...cat.chilled.map((c) => ({ c, chilled: true })), ...cat.ambient.map((c) => ({ c, chilled: false }))]
  const [qty, setQty] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState<{ ids: string[]; deliveryDate: string; afterCutoff: boolean } | null>(null)
  const cutoff = useCutoff()

  const items: OrderItem[] = products.map(({ c }) => ({ name: c[0], unit: c[1], qty: qty[c[0]] ?? 0 })).filter((i) => i.qty > 0)
  const parts = splitByTemp(outlet.brand, items, d.catalog).map((p) => ({ ...p, m: measure(outlet.brand, p.items, d.catalog) }))
  const day = (date: string) => fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })

  if (done)
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <CheckCircle2 className="mx-auto size-14 text-brand" />
        <div className="eyebrow mt-4">Order received</div>
        <h1 className="mt-1 font-mono text-3xl font-bold">{done.ids.join(' + ')}</h1>
        <p className="mt-2 text-muted">Delivery {day(done.deliveryDate)}</p>
        <Badge tone="success" dot className="mt-4">
          Confirmed
        </Badge>
        {done.ids.length > 1 && <p className="mt-4 text-sm">Chilled and dry goods arrive as two deliveries: chilled on a refrigerated vehicle, dry on a dry-box truck.</p>}
        <p className="mt-4 text-sm text-muted">{done.afterCutoff ? 'It was placed after the 16:00 cutoff, so it joins the following run.' : 'It enters planning at today’s 16:00 cutoff.'} You’ll be notified when it’s scheduled, with an expected arrival time.</p>
        <div className="mt-8 flex justify-center gap-2">
          <Link to={`/store/orders/${done.ids[0]}`}>
            <Button>View order</Button>
          </Link>
          <Button variant="secondary" onClick={() => (setDone(null), setQty({}), setNotes(''))}>
            New order
          </Button>
        </div>
      </div>
    )

  return (
    <>
      <PageHeader eyebrow={`${outlet.name} · ${outlet.id}`} title="New order" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Products" eyebrow={`${outlet.brand} catalogue`} />
          <ul className="divide-y divide-line">
            {!products.length && <li className="p-5 text-muted">No products available. Ask your administrator to import the product catalogue.</li>}
            {products.map(({ c, chilled }) => {
              const [name, unit] = c
              const v = qty[name] ?? 0
              const set = (n: number) => setQty((q) => ({ ...q, [name]: Math.max(0, Math.min(99, n)) }))
              return (
                <li key={name} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-4 sm:flex sm:px-5">
                  <span className={`grid size-9 place-items-center rounded-lg ${chilled ? 'bg-info-soft text-info-ink' : 'bg-surface-2 text-muted'}`}>{chilled ? <Snowflake className="size-4" /> : <Sun className="size-4" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-muted">
                      {unit} · {chilled ? 'chilled' : 'ambient'}
                    </div>
                  </div>
                  <div className="col-start-2 inline-flex shrink-0 items-center justify-self-start rounded-lg border border-line-strong">
                    <button className="grid size-11 place-items-center" onClick={() => set(v - 1)} aria-label={`Fewer ${name}`}>
                      <Minus className="size-4" />
                    </button>
                    <input inputMode="numeric" value={v} onChange={(e) => set(Number(e.target.value.replace(/\D/g, '')) || 0)} className="h-11 w-12 bg-transparent text-center font-semibold tabular-nums focus:outline-none" aria-label={`${name} quantity`} />
                    <button className="grid size-11 place-items-center" onClick={() => set(v + 1)} aria-label={`More ${name}`}>
                      <Plus className="size-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="border-t border-line p-5">
            <Field label="Notes">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Access notes, substitutions…" />}</Field>
          </div>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <div className="eyebrow">Delivery date</div>
            <div className="mt-1 font-display text-2xl font-semibold">{day(cutoff.deliveryDate)}</div>
            <p className="text-xs text-muted">Waypoint delivers Monday to Saturday{outlet.brand === 'Fresh' ? `, before your ${outlet.window[0] < 480 ? 'store opens' : 'window closes'}` : ''}.</p>
            {parts.length === 0 ? (
              <p className="mt-4 rounded-lg bg-surface-2 p-3 text-sm text-muted">Add products to see the delivery.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {parts.map((p) => (
                  <div key={p.temp} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm ${p.temp === 'CHILLED' ? 'bg-info-soft text-info-ink' : 'bg-surface-2'}`}>
                    <span className="inline-flex items-center gap-2 font-semibold">
                      {p.temp === 'CHILLED' ? <Snowflake className="size-4" /> : <Sun className="size-4" />}
                      {p.temp === 'CHILLED' ? 'Chilled delivery' : 'Dry delivery'}
                    </span>
                    <span className="tabular-nums">
                      {p.m.units} units · {p.m.volumeM3} m³ · {p.m.weightKg} kg
                    </span>
                  </div>
                ))}
                {parts.length > 1 && <p className="text-xs text-muted">Chilled goods travel on a refrigerated vehicle, so they arrive as a separate delivery.</p>}
              </div>
            )}
          </Card>
          <Card className={`p-5 ${cutoff.urgent ? 'border-attention' : ''}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4 text-attention-ink" /> Order cutoff · 16:00
            </div>
            {cutoff.passed ? (
              <p className="mt-2 text-sm text-muted">Today’s cutoff has passed. This order joins the {day(cutoff.deliveryDate)} run.</p>
            ) : (
              <>
                <div className={`mt-1 font-display text-3xl font-semibold tabular-nums ${cutoff.urgent ? 'text-attention-ink' : ''}`}>{cutoff.label}</div>
                <div className="text-xs text-muted">time remaining</div>
              </>
            )}
          </Card>
          <Button
            size="xl"
            block
            disabled={!items.length || saving}
            onClick={async () => {
              setSaving(true)
              try {
                const r = await saveCommand('createOrder', outlet.id, items, notes.trim())
                toast('Order submitted', { body: r.ids.join(' + ') })
                setDone(r)
              } catch (e) { toast('Order not saved', { tone: 'critical', body: e instanceof Error ? e.message : 'Try again' }) }
              finally { setSaving(false) }
            }}
          >
            Submit order
          </Button>
        </div>
      </div>
    </>
  )
}
