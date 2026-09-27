import { ArrowLeft, Snowflake, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AuditTimeline } from '../../components/AuditTimeline'
import { Badge, Card, CardHeader, cn, EmptyState, Meter, PageHeader, Segmented } from '../../components/ui'
import { vehicleDay } from '@core/rules'
import { isReefer, isVan, vehicleLabel } from '@core/rules'
import { fmtMin } from '@core/time'
import { auditFor, scheduleOf } from '../../lib/select'
import { useOps } from '../../store'
import type { OpsData, Vehicle } from '@core/types'

const weeklyFuel = (v: Vehicle, d: OpsData) => v.fuelUsedL + vehicleDay(v, d.trips, d).fuelL
import { tripLabel, tripTone } from './Routes'

export function Vehicles() {
  const d = useOps((s) => s.data)
  const [f, setF] = useState<'all' | 'reefer' | 'van' | 'down'>('all')
  const list = useMemo(() => d.vehicles.filter((v) => (f === 'reefer' ? isReefer(v.type) : f === 'van' ? isVan(v.type) : f === 'down' ? v.status !== 'AVAILABLE' : true)), [d, f])
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Vehicles"
        subtitle={`${d.vehicles.filter((v) => v.status === 'AVAILABLE').length} of ${d.vehicles.length} available`}
        actions={
          <Segmented
            value={f}
            onChange={setF}
            options={[
              { value: 'all', label: 'All' },
              { value: 'reefer', label: 'Reefer' },
              { value: 'van', label: 'Vans' },
              { value: 'down', label: 'Workshop / down' },
            ]}
          />
        }
      />
      <Card className="overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                {['Vehicle', 'Type', 'Depot', 'Driver', 'Capacity', 'Trips', 'Fuel quota (week)', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((v) => {
                const trips = d.trips.filter((t) => t.vehicleId === v.id && t.status !== 'ABORTED')
                const fuel = weeklyFuel(v, d)
                return (
                  <tr key={v.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link to={`/dispatcher/vehicles/${v.id}`} className="id hover:underline">
                        {v.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        {isReefer(v.type) && <Snowflake className="size-3.5 text-info" />}
                        {vehicleLabel(v.type)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{v.depot}</td>
                    <td className="px-4 py-3">{v.driver}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {v.capacityKg.toLocaleString()} kg · {v.capacityM3} m³
                    </td>
                    <td className="px-4 py-3">{trips.length}/2</td>
                    <td className="w-48 px-4 py-3">
                      <Meter value={fuel} max={v.fuelQuotaL} detail={`${Math.round(fuel)}/${v.fuelQuotaL} L`} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={v.status === 'AVAILABLE' ? (v.reserve ? 'info' : 'success') : 'critical'} dot>
                        {v.status === 'AVAILABLE' ? (v.reserve ? 'Recovery reserve' : 'Available') : v.status === 'IN_WORKSHOP' ? 'In workshop' : 'Broken down'}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

export function VehicleDetail() {
  const { id } = useParams()
  const d = useOps((s) => s.data)
  const v = d.vehicles.find((x) => x.id === id)
  if (!v) return <EmptyState icon={<Truck className="size-5" />} title="Vehicle not found" />
  const trips = d.trips.filter((t) => t.vehicleId === v.id).sort((a, b) => a.number - b.number)
  const fuel = weeklyFuel(v, d)
  return (
    <>
      <Link to="/dispatcher/vehicles" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Vehicles
      </Link>
      <PageHeader eyebrow={`${vehicleLabel(v.type)} · ${v.depot}`} title={<span className="id">{v.id}</span>} subtitle={`Current driver: ${v.driver}`} actions={<Badge tone={v.status === 'AVAILABLE' ? 'success' : 'critical'} dot>{v.status.toLowerCase()}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 p-5">
          <div className="eyebrow">Capacity</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-surface-2 p-3">
              <div className="font-display text-xl font-semibold">{v.capacityKg.toLocaleString()} kg</div>
              <div className="text-xs text-muted">Weight</div>
            </div>
            <div className="rounded-lg bg-surface-2 p-3">
              <div className="font-display text-xl font-semibold">{v.capacityM3} m³</div>
              <div className="text-xs text-muted">Volume</div>
            </div>
          </div>
          <Meter label="Fuel quota this week" value={fuel} max={v.fuelQuotaL} detail={`${Math.round(v.fuelQuotaL - fuel)} / ${v.fuelQuotaL} L remaining`} />
          <Meter label="Today's trips" value={trips.filter((t) => t.status !== 'ABORTED').length} max={2} warnAt={1.01} detail={`${trips.filter((t) => t.status !== 'ABORTED').length} / 2`} />
          <div className="flex flex-wrap gap-1.5">
            {isReefer(v.type) && <Badge tone="info">Refrigerated</Badge>}
            {isVan(v.type) && <Badge>Van access</Badge>}
            {v.reserve && <Badge tone="info">Recovery reserve — kept free to rescue a breakdown</Badge>}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Trips" />
          {trips.length === 0 ? (
            <EmptyState icon={<Truck className="size-5" />} title="No trips assigned" />
          ) : (
            <ul className="divide-y divide-line">
              {trips.map((t) => {
                const s = scheduleOf(d, t)
                return (
                  <li key={t.id}>
                    <Link to={`/dispatcher/routes/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-surface-2">
                      <span>
                        <span className="font-semibold">
                          Trip {t.number} · {t.brand} · {t.district}
                        </span>
                        <span className="block text-sm text-muted">
                          {fmtMin(t.departure)} → {fmtMin(s.finish)} · {t.stops.length} stops · {s.volumeM3} m³
                        </span>
                      </span>
                      <Badge tone={tripTone[t.status]} dot>
                        {tripLabel(t.status)}
                      </Badge>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          <div className={cn('border-t border-line p-5')}>
            <div className="eyebrow mb-3">Vehicle log</div>
            <AuditTimeline events={auditFor(d, v.id)} empty="No events recorded for this vehicle today." />
          </div>
        </Card>
      </div>
    </>
  )
}
