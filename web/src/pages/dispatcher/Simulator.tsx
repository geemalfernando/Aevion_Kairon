import { FlaskConical, Snowflake, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Card, CardHeader, cn, PageHeader, Segmented } from '../../components/ui'
import { isReefer } from '@core/rules'
import { useOps } from '../../store'

export function Simulator() {
  const d = useOps((s) => s.data)
  const [festival, setFestival] = useState(80)
  const [payday, setPayday] = useState(true)
  const [monsoon, setMonsoon] = useState(true)
  const [downVeh, setDownVeh] = useState(7)
  const [downReefer, setDownReefer] = useState(3)
  const [ran, setRan] = useState<null | ReturnType<typeof compute>>(null)

  const base = useMemo(() => {
    const reefers = d.vehicles.filter((v) => isReefer(v.type) && v.status === 'AVAILABLE').length
    const dry = d.vehicles.filter((v) => !isReefer(v.type) && v.status === 'AVAILABLE').length
    const chilledNeed = Math.ceil(d.orders.filter((o) => o.temp === 'CHILLED').reduce((s, o) => s + o.volumeM3, 0) / 11.5)
    const dryNeed = Math.ceil(d.orders.filter((o) => o.temp === 'AMBIENT').reduce((s, o) => s + o.volumeM3, 0) / 16 / 1.6)
    return { reefers, dry, chilledNeed, dryNeed }
  }, [d])

  function compute() {
    const demand = (festival / 100) * 0.2 + (payday ? 0.06 : 0) + (monsoon ? 0.02 : 0)
    const capLoss = (monsoon ? 0.05 : 0) + downVeh / Math.max(1, base.reefers + base.dry)
    const reeferGap = base.reefers - downReefer - Math.ceil(base.chilledNeed * (1 + demand) * (1 + (monsoon ? 0.05 : 0)))
    const dryGap = base.dry - Math.max(0, downVeh - downReefer) - Math.ceil(base.dryNeed * (1 + demand) * (1 + (monsoon ? 0.05 : 0)))
    return { demand: Math.round(demand * 100), capacity: -Math.round(capLoss * 100), reeferGap, dryGap }
  }

  return (
    <>
      <PageHeader eyebrow="Planning" title="What-if simulator" subtitle="Stress-test tomorrow’s fleet against demand and availability shocks." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader title="Scenario" eyebrow="Inputs" />
          <div className="space-y-6 p-5">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <label htmlFor="festival" className="font-medium">
                  Festival proximity
                </label>
                <span className="font-semibold tabular-nums">{festival}%</span>
              </div>
              <input id="festival" type="range" min={0} max={100} value={festival} onChange={(e) => setFestival(+e.target.value)} className="w-full accent-[var(--brand)]" />
            </div>
            <Toggle label="Payday" value={payday} onChange={setPayday} />
            <Toggle label="Monsoon" value={monsoon} onChange={setMonsoon} />
            <Stepper label="Unavailable vehicles" value={downVeh} onChange={setDownVeh} max={30} icon={<Truck className="size-4" />} />
            <Stepper label="…of which reefers" value={downReefer} onChange={(v) => setDownReefer(Math.min(v, downVeh))} max={downVeh} icon={<Snowflake className="size-4" />} />
            <Button icon={<FlaskConical className="size-4" />} block size="lg" onClick={() => setRan(compute())}>
              Run scenario
            </Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Result" eyebrow="Projection" />
          {!ran ? (
            <p className="p-10 text-center text-sm text-muted">Adjust the scenario and run it to see projected demand, capacity and deficits.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-5">
              <Tile label="Expected demand" value={`+${ran.demand}%`} tone="attention" />
              <Tile label="Expected capacity" value={`${ran.capacity}%`} tone="attention" />
              <Tile label="Reefer" value={gapText(ran.reeferGap)} tone={ran.reeferGap < 0 ? 'critical' : 'success'} sub={ran.reeferGap < 0 ? 'Projected deficit' : 'Spare'} />
              <Tile label="Dry" value={gapText(ran.dryGap)} tone={ran.dryGap < 0 ? 'critical' : 'success'} sub={ran.dryGap < 0 ? 'Projected deficit' : 'Spare'} />
              <p className="col-span-2 text-sm text-muted">
                {ran.reeferGap < 0 ? `Book ${-ran.reeferGap} rental reefers or pre-position chilled stock the evening before.` : 'Current reefer fleet covers this scenario.'} Deferred orders would be prioritised on the next run.
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

const gapText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} vehicles`

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'attention' | 'critical' | 'success' }) {
  return (
    <div className={cn('rounded-xl border p-4', tone === 'critical' ? 'border-critical/40 bg-critical-soft' : tone === 'success' ? 'border-success/40 bg-success-soft' : 'border-attention/40 bg-attention-soft')}>
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('font-display text-2xl font-semibold', tone === 'critical' ? 'text-critical-ink' : tone === 'success' ? 'text-success-ink' : 'text-attention-ink')}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{label}</span>
      <Segmented size="sm" value={value ? 'on' : 'off'} onChange={(v) => onChange(v === 'on')} options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} />
    </div>
  )
}

function Stepper({ label, value, onChange, max, icon }: { label: string; value: number; onChange: (v: number) => void; max: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-2 text-sm font-medium">
        <span className="text-muted">{icon}</span>
        {label}
      </span>
      <div className="inline-flex items-center rounded-lg border border-line">
        <button className="h-9 w-9 text-lg" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Decrease ${label}`}>
          −
        </button>
        <span className="w-8 text-center font-semibold tabular-nums">{value}</span>
        <button className="h-9 w-9 text-lg" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
    </div>
  )
}
