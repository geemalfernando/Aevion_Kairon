import { ClipboardList, Search, Store, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { vehicleLabel } from '@core/rules'
import { useSession, useView } from '../../store'
import { cn, Modal, StatusBadge } from '../ui'

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const d = useView()
  const user = useSession((s) => s.user)!
  const navigate = useNavigate()
  const store = user.role === 'STORE_MANAGER'
  const res = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return null
    const match = (...xs: string[]) => xs.some((x) => x.toLowerCase().includes(s))
    const orders = d.orders.filter((o) => (!store || o.outletId === user.assignedOutlet) && match(o.id, o.outletId)).slice(0, 6)
    const outlets = store ? [] : d.outlets.filter((o) => match(o.id, o.name, o.district)).slice(0, 5)
    const vehicles = store ? [] : d.vehicles.filter((v) => match(v.id, v.driver, vehicleLabel(v.type))).slice(0, 5)
    return { orders, outlets, vehicles }
  }, [q, d, store, user.assignedOutlet])

  const go = (to: string) => {
    navigate(to)
    setQ('')
    onClose()
  }
  const Row = ({ icon, title, sub, right, to }: { icon: React.ReactNode; title: string; sub: string; right?: React.ReactNode; to: string }) => (
    <button onClick={() => go(to)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2">
      <span className="grid size-8 place-items-center rounded-md bg-surface-2 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="id block">{title}</span>
        <span className="block truncate text-xs text-muted">{sub}</span>
      </span>
      {right}
    </button>
  )
  return (
    <Modal open={open} onClose={onClose} title="Search Kairon">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={store ? 'ORD1456' : 'ORD1456, OUT005, VEH002, Nimal…'}
          className="h-12 w-full rounded-lg border border-line-strong bg-surface pl-10 pr-3 text-[15px] focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20"
        />
      </div>
      <div className="mt-4 min-h-40 space-y-4">
        {!res && <p className="py-8 text-center text-sm text-muted">Type an order, outlet or vehicle ID.</p>}
        {res && !res.orders.length && !res.outlets.length && !res.vehicles.length && <p className="py-8 text-center text-sm text-muted">No matches for “{q}”.</p>}
        {res && res.orders.length > 0 && (
          <Group title="Orders">
            {res.orders.map((o) => (
              <Row key={o.id} icon={<ClipboardList className="size-4" />} title={o.id} sub={`${o.outletId} · ${o.brand} · ${o.volumeM3} m³`} right={<StatusBadge s={o.status} />} to={store ? `/store/orders/${o.id}` : `/dispatcher/orders?o=${o.id}`} />
            ))}
          </Group>
        )}
        {res && res.outlets.length > 0 && (
          <Group title="Outlets">
            {res.outlets.map((o) => (
              <Row key={o.id} icon={<Store className="size-4" />} title={o.id} sub={`${o.name} · ${o.district}`} to={`/dispatcher/outlets?q=${o.id}`} />
            ))}
          </Group>
        )}
        {res && res.vehicles.length > 0 && (
          <Group title="Vehicles">
            {res.vehicles.map((v) => (
              <Row key={v.id} icon={<Truck className="size-4" />} title={v.id} sub={`${vehicleLabel(v.type)} · ${v.driver}`} to={`/dispatcher/vehicles/${v.id}`} />
            ))}
          </Group>
        )}
      </div>
    </Modal>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={cn('eyebrow mb-1 px-3')}>{title}</div>
      {children}
    </div>
  )
}
