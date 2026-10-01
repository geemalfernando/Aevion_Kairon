import { Clock, Eye, FlaskConical, LayoutGrid, RotateCcw, Wifi, WifiOff, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { byId, validate } from '@core/rules'
import { colomboDate, colomboTs, fmtClock, hm } from '@core/time'
import type { Role } from '@core/types'
import { DEMO_PASSWORD, DEMO_USERS } from '@core/users'
import { PRESET } from '../../demo/mode'
import { PRESETS } from '../../demo/presets'
import { ops, PREVIEW, resetDemo, signInWith, useDevice, useNow, useOps, useSession } from '../../store'
import { Badge, Button, cn, IconButton, toast } from '../ui'
import { HOME, ROLE_LABEL } from './nav'

const STORY_TRIP = 'TRP-014-1'

/** Demo-only tools for presenters and judges. Clearly separated from the product UI. */
export function DemoDock() {
  const [open, setOpen] = useState(false)
  const plan = useOps((s) => s.data.plan)
  const closed = useOps((s) => s.data.ordersClosed)
  const simOff = useSession((s) => s.simulateOffline)
  const setOff = useSession((s) => s.setSimulateOffline)
  const user = useSession((s) => s.user)
  const flaky = useDevice((s) => s.flakyUploads)
  const setFlaky = useDevice((s) => s.setFlaky)
  const navigate = useNavigate()
  const now = useNow(15_000)

  if (PREVIEW) return <PreviewPill />

  const switchRole = async (r: Role) => {
    try {
      await signInWith(DEMO_USERS[r].email, DEMO_PASSWORD)
      navigate(HOME[r])
      setOpen(false)
    } catch (e) {
      toast('Could not switch role', { tone: 'critical', body: e instanceof Error ? e.message : String(e) })
    }
  }

  /** The hero scenario's trigger: take a not-yet-delivered stop off VEH014 while its driver may be offline. */
  const moveStop = () => {
    const d = useOps.getState().data
    const trip = byId(d.trips, STORY_TRIP)
    const stop = trip?.stops.find((id) => !['DELIVERED', 'PARTIAL', 'FAILED', 'RECEIVED', 'ARRIVED'].includes(byId(d.orders, id)?.status ?? ''))
    const target = stop && [...trip!.stops].reverse().find((id) => !['DELIVERED', 'PARTIAL', 'FAILED', 'RECEIVED', 'ARRIVED'].includes(byId(d.orders, id)?.status ?? ''))
    if (!trip || trip.status !== 'IN_PROGRESS' || !target) return toast('Start VEH014’s route first', { tone: 'info', body: 'The driver needs to be on the road.' })
    const r = ops('moveStop', target, 'VEH031', 'Late-window risk — sent from the depot on the reserve van')
    if (r.ok) toast(`${byId(d.orders, target)?.outletId} moved to VEH031`, { body: 'The driver sees it when their phone reconnects.' })
    else toast('Could not move the stop', { tone: 'critical', body: r.message })
  }

  /** Second degradation: change VEH014 after loading has started. */
  const changeDuringLoading = () => {
    const d = useOps.getState().data
    const trip = byId(d.trips, STORY_TRIP)
    if (!trip || !['LOADING', 'LOADED'].includes(trip.status)) return toast('Start loading VEH014 first', { tone: 'info', body: 'The loader needs to have begun loading.' })
    const last = trip.stops.at(-1)!
    ops('unassign', last)
    const veh = byId(d.vehicles, trip.vehicleId)!
    const fresh = useOps.getState().data
    const add = fresh.orders.filter((o) => o.status === 'DEFERRED' && o.temp === 'CHILLED' && byId(fresh.outlets, o.outletId)?.district === trip.district).find((o) => validate(o, veh, fresh).ok)
    if (add) ops('assign', add.id, veh.id)
    toast('VEH014 changed during loading', { tone: 'attention', body: 'The loader must confirm the new load before departure.' })
  }

  const clock = (min: number, label: string) => {
    ops('setClockMinutes', min)
    toast(`Operation clock set to ${label}`, { tone: 'info' })
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 left-3 z-40 inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-line-strong bg-surface/95 px-3 text-xs font-semibold text-muted shadow-card backdrop-blur hover:text-ink lg:bottom-5 lg:left-[268px]"
        aria-expanded={open}
      >
        <FlaskConical className="size-4" /> Demo
        {simOff && <WifiOff className="size-3.5 text-attention" />}
      </button>
      {open && (
        <div className="fixed bottom-32 left-3 z-50 max-h-[calc(100dvh-10rem)] w-[min(380px,calc(100vw-24px))] animate-rise overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-pop lg:bottom-16 lg:left-[268px]">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="font-semibold">Demo controls</div>
              <p className="text-xs text-muted">Presenter tools · not part of the product</p>
            </div>
            <IconButton label="Close" onClick={() => setOpen(false)} className="-mr-2 -mt-1">
              <X className="size-4" />
            </IconButton>
          </div>

          <Section title="Operation">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <Badge tone={closed ? 'brand' : 'neutral'}>{closed ? 'Orders closed' : 'Orders open'}</Badge>
              <Badge tone={plan === 'PUBLISHED' ? 'success' : plan === 'DRAFT' ? 'attention' : 'neutral'}>Plan: {plan.toLowerCase()}</Badge>
            </div>
            <div className="grid gap-1.5">
              {plan === 'NONE' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    ops('closeOrders')
                    ops('setClock', colomboTs(colomboDate(now), hm(16, 5)))
                    const r = ops('generatePlan')
                    toast('Plan generated', { body: `${r.served} served · ${r.deferred} deferred` })
                  }}
                >
                  Close orders & generate plan
                </Button>
              )}
              {plan === 'DRAFT' && (
                <Button size="sm" variant="secondary" onClick={() => (ops('publishPlan'), toast('Plan published'))}>
                  Publish plan to loaders & drivers
                </Button>
              )}
              {plan === 'PUBLISHED' && (
                <>
                  <Button size="sm" variant="secondary" onClick={changeDuringLoading}>
                    Change VEH014’s plan during loading
                  </Button>
                  <Button size="sm" variant="secondary" onClick={moveStop}>
                    Move a VEH014 stop to the reserve van
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => (ops('simulateFleet', 'VEH014'), toast('Fleet dispatched', { body: 'Other vehicles are now on the road' }))}>
                    Send the rest of the fleet out
                  </Button>
                </>
              )}
            </div>
          </Section>

          <Section title={`Operation clock · ${fmtClock(now)}`}>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  [-hm(8, 40), '15:20 order eve'],
                  [hm(3, 30), '03:30 loading'],
                  [hm(4, 40), '04:40 departure'],
                  [hm(5, 30), '05:30 Fresh run'],
                ] as const
              ).map(([m, l]) => (
                <button key={l} onClick={() => clock(m, l.split(' ')[0])} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-xs font-medium hover:bg-surface-2">
                  <Clock className="size-3.5 text-muted" /> {l}
                </button>
              ))}
            </div>
          </Section>

          <Section title="This device">
            <Toggle on={simOff} onChange={setOff} icon={simOff ? <WifiOff className="size-4" /> : <Wifi className="size-4" />} label="Simulate offline" hint="Only this tab loses connection" />
            <Toggle on={flaky} onChange={setFlaky} label="Unstable photo uploads" hint="Proof photos fail during sync" />
          </Section>

          <Section title="Sign in as">
            <div className="grid grid-cols-2 gap-1.5">
              {(['DISPATCHER', 'LOADER', 'DRIVER', 'STORE_MANAGER'] as Role[]).map((r) => (
                <button key={r} onClick={() => void switchRole(r)} className={cn('rounded-lg border px-2 py-1.5 text-xs font-medium', user?.role === r ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line hover:bg-surface-2')}>
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">Tip: open another tab and sign in as a different role — both see one shared operation.</p>
          </Section>

          <Link to="/states" className="mb-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-surface-2">
            <LayoutGrid className="size-4 text-muted" /> Screen states for Figma & judges
          </Link>
          <Button
            size="sm"
            variant="ghost"
            block
            icon={<RotateCcw className="size-4" />}
            onClick={async () => {
              if (!confirm('Reset the whole demo to the start of the day?')) return
              await resetDemo()
              toast('Demo reset', { tone: 'info' })
              setOpen(false)
            }}
          >
            Reset demo data
          </Button>
        </div>
      )}
    </>
  )
}

/** Sandboxed preview (?demo=…): nothing is saved; a pill says so and links back to the gallery. */
function PreviewPill() {
  const preset = PRESETS.find((p) => p.id === PRESET)
  return (
    <Link to="/states" className="fixed bottom-20 left-3 z-40 inline-flex h-9 max-w-[calc(100vw-24px)] items-center gap-2 rounded-full border border-dashed border-line-strong bg-surface/95 px-3 text-xs font-semibold text-muted shadow-card backdrop-blur hover:text-ink lg:bottom-5 lg:left-[268px]">
      <Eye className="size-4 shrink-0" />
      <span className="truncate">Preview · {preset?.title ?? PRESET} · nothing is saved</span>
    </Link>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-t border-line pt-3">
      <div className="eyebrow mb-2 !text-[10px]">{title}</div>
      {children}
    </div>
  )
}

function Toggle({ on, onChange, label, hint, icon }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left">
      {icon && <span className="text-muted">{icon}</span>}
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
      <span className={cn('relative h-5 w-9 rounded-full transition', on ? 'bg-attention-fill' : 'bg-surface-3')}>
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  )
}
