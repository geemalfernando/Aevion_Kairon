import { seedOps as emptyOps } from '@core/ops'
import { priorityOf } from '@core/rules'
import { calRow, splitByTemp, measure, catalogFor } from '@core/catalog'
import { colomboTs, hm } from '@core/time'
import type { OpsData, Order, OrderItem } from '@core/types'
import { buildReference, rng, STORY_OUTLETS } from './reference'
import { FIXTURE_CATALOG } from './catalog'
export function seedOps({ today = '2026-09-30' } = {}): OpsData {
  const d = emptyOps({ today, reference: buildReference() })
  d.catalog = FIXTURE_CATALOG
  d.clock = { sim: colomboTs(today, hm(15, 20)), real: Date.now() }
  d.orders = buildOrders(d.outlets, d.calendar, d.deliveryDate, today)
  return d
}
function buildOrders(outlets: OpsData['outlets'], cal: OpsData['calendar'], deliveryDate: string, orderDay: string): Order[] {
  const r = rng(47)
  const row = calRow(cal, deliveryDate)
  const lift = 1 + (row?.festival_ramp ?? 0) * 0.25 + (row?.is_payday ? 0.08 : 0)
  const qty = (lo: number, hi: number) => Math.max(1, Math.round((lo + Math.floor(r() * (hi - lo + 1))) * lift))
  const pick = (p: number) => r() < p
  const dow = new Date(`${deliveryDate}T00:00:00Z`).getUTCDay()
  const orders: Order[] = []
  let n = 1400

  const push = (outlet: OpsData['outlets'][number], items: OrderItem[], extra: Partial<Order> = {}) => {
    for (const part of splitByTemp(outlet.brand, items, FIXTURE_CATALOG)) {
      const m = measure(outlet.brand, part.items, FIXTURE_CATALOG)
      const runsDeferred = outlet.deferredYesterday && (part.temp === 'CHILLED' || outlet.brand !== 'Fresh') ? 1 : 0
      const pr = priorityOf({ brand: outlet.brand, temp: part.temp, runsDeferred }, outlet)
      orders.push({
        id: `ORD${++n}`,
        outletId: outlet.id,
        brand: outlet.brand,
        temp: part.temp,
        items: part.items,
        ...m,
        deliveryDate,
        status: 'CONFIRMED',
        priority: pr.score,
        priorityWhy: pr.why,
        runsDeferred: runsDeferred || undefined,
        createdAt: colomboTs(orderDay, hm(8) + Math.floor(r() * 470)),
        ...extra,
      })
    }
  }

  outlets.forEach((o, idx) => {
    const cat = catalogFor(o.brand, FIXTURE_CATALOG)
    const story = !!STORY_OUTLETS[o.id]
    if (o.brand === 'Fresh') {
      if (o.id === 'OUT032') {
        push(o, [
          { name: 'Dairy', unit: 'crates', qty: 12 },
          { name: 'Frozen goods', unit: 'cartons', qty: 4 },
          { name: 'Dry groceries', unit: 'cartons', qty: 20 },
          { name: 'Produce', unit: 'crates', qty: 8 },
        ])
        return
      }
      // Dry goods: every operating day.
      const dry: OrderItem[] = [
        { name: 'Dry groceries', unit: 'cartons', qty: qty(14, 30) },
        { name: 'Produce', unit: 'crates', qty: qty(6, 16) },
        ...(pick(0.6) ? [{ name: 'Bakery', unit: 'trays', qty: qty(4, 10) }] : []),
        ...(pick(0.6) ? [{ name: 'Beverages', unit: 'cases', qty: qty(6, 14) }] : []),
      ]
      // Chilled: several days a week, so not every outlet orders it today.
      const chilled: OrderItem[] =
        story || o.deferredYesterday || pick(0.68)
          ? [
              { name: 'Dairy', unit: 'crates', qty: qty(6, 16) },
              ...(pick(0.7) ? [{ name: 'Yoghurt', unit: 'crates', qty: qty(3, 8) }] : []),
              ...(pick(0.7) ? [{ name: 'Meat & fish', unit: 'crates', qty: qty(3, 10) }] : []),
              ...(pick(0.6) ? [{ name: 'Frozen goods', unit: 'cartons', qty: qty(2, 8) }] : []),
            ]
          : []
      push(o, [...dry, ...chilled])
    } else if (o.brand === 'Style') {
      // Weekly, on a fixed day per outlet; festival build-up brings extra orders.
      if (idx % 6 !== dow % 6 && !((row?.festival_ramp ?? 0) > 0 && idx % 3 === 0) && idx % 4 !== 1) return
      push(o, [
        { name: 'Hanging garments', unit: 'rails', qty: qty(2, 6) },
        { name: 'Apparel cartons', unit: 'cartons', qty: qty(10, 26) },
        ...(pick(0.7) ? [{ name: 'Footwear cartons', unit: 'cartons', qty: qty(4, 12) }] : []),
      ])
    } else {
      // As needed, often a single large item.
      if (!pick(0.45)) return
      const big = cat.ambient[Math.floor(r() * 3)]
      push(o, [{ name: big[0], unit: big[1], qty: big[0] === 'Televisions' ? qty(2, 5) : qty(1, 2) }, ...(pick(0.5) ? [{ name: 'Small appliances', unit: 'cartons', qty: qty(3, 10) }] : [])])
    }
  })
  return orders
}

