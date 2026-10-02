import Dexie, { type Table } from 'dexie'
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { applyEvent, commands, opNow, seedOps, uid, type CommandName } from '@core/ops'
import type { FieldEvent, OpsData, QueuedEvent, Role, User } from '@core/types'
import { toast } from '../components/ui'
import { DEMO_USERS } from '@core/demo'
import { FRAME, PRESET, PREVIEW, THEME_OVERRIDE } from '../demo/mode'
import { buildPreset } from '../demo/presets'
import { detectConflict, type RouteConflict } from './conflict'
import { API_MODE, ApiError, api, NetworkError } from './remote'

export { API_MODE, FRAME, PREVIEW }
export type { RouteConflict }

/**
 * Browser tabs keep their own sign-in (so a demo can run four roles side by side);
 * the installed app remembers the user between launches.
 */
const isInstalledApp = () => typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** In remote mode the server is the source of truth; in local mode (static build) this browser is. */
const REMOTE = !PREVIEW
/** Demo mode only (?demo=<preset>): a sandboxed copy of the operation in one named state. */
const preset = PREVIEW && PRESET ? buildPreset(PRESET) : null

// ---------------------------------------------------------------------------
// Storage: IndexedDB (no 5 MB cap — proof photos queue safely offline), kept in step across tabs.
// ---------------------------------------------------------------------------

class KaironDB extends Dexie {
  kv!: Table<{ key: string; value: string }, string>
  constructor() {
    super('kairon')
    this.version(1).stores({ kv: 'key' })
  }
}
const db = new KaironDB()
const TAB = Math.random().toString(36).slice(2)
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('kairon')
const memory = new Map<string, string>()

const idbStorage: StateStorage = {
  async getItem(key) {
    try {
      return (await db.kv.get(key))?.value ?? null
    } catch {
      return memory.get(key) ?? null
    }
  },
  async setItem(key, value) {
    try {
      await db.kv.put({ key, value })
      channel?.postMessage({ key, from: TAB })
    } catch {
      memory.set(key, value)
    }
  },
  async removeItem(key) {
    await db.kv.delete(key).catch(() => undefined)
  },
}
const memoryStorage: StateStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k) }
const storage = () => (PREVIEW ? memoryStorage : idbStorage)

// ---------------------------------------------------------------------------
// The operation ("the server" in local mode, a cache of it in remote mode)
// ---------------------------------------------------------------------------

interface OpsStore {
  data: OpsData
  run: <T>(fn: (d: OpsData) => T) => T
  replace: (data: OpsData) => void
  reset: () => void
}

export const useOps = create<OpsStore>()(
  persist(
    (set, get) => ({
      data: preset?.data ?? seedOps(),
      run(fn) {
        const draft = structuredClone(get().data)
        const out = fn(draft)
        set({ data: draft })
        return out
      },
      replace: (data) => set({ data }),
      reset: () => set({ data: seedOps() }),
    }),
    { name: 'kairon-supabase-ops-v1', storage: createJSONStorage(storage), version: 2 },
  ),
)

// ---------------------------------------------------------------------------
// Session: who is signed in on this tab and whether this tab is "offline".
// ---------------------------------------------------------------------------

interface SessionStore {
  user: User | null
  token: string | null
  refreshToken: string | null
  expiresAt: number
  ready: boolean
  simulateOffline: boolean
  netOnline: boolean
  /** Remote mode: whether the API answered recently. */
  serverUp: boolean
  signIn: (u: User, token?: string | null) => void
  signOut: () => void
  setSimulateOffline: (v: boolean) => void
}

const pathRole = (): Role | null => {
  const p = typeof location === 'undefined' ? '' : location.pathname
  return p.startsWith('/driver') ? 'DRIVER' : p.startsWith('/loader') ? 'LOADER' : p.startsWith('/store') ? 'STORE_MANAGER' : p.startsWith('/dispatcher') ? 'DISPATCHER' : null
}

export const useSession = create<SessionStore>()(
  persist(
    (set) => ({
      user: preset ? DEMO_USERS[pathRole() ?? preset.preset.role] : null,
      token: null, refreshToken: null, expiresAt: 0, ready: !!preset,
      simulateOffline: !!preset?.offline,
      netOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
      serverUp: true,
      signIn: (user, token = null) => {
        set({ user, token, simulateOffline: false })
        applyTheme(themePrefFor(user.role))
      },
      signOut: () => { latestVersion = 0; confirmed = null; useOps.getState().reset(); set({ user: null, token: null, refreshToken: null, expiresAt: 0, ready: false, simulateOffline: false }) },
      setSimulateOffline: (simulateOffline) => {
        set({ simulateOffline })
        if (simulateOffline) useDevice.getState().goOffline()
        else void useDevice.getState().sync()
      },
    }),
    {
      name: 'kairon-supabase-session-v1',
      storage: createJSONStorage(() => (PREVIEW ? memoryStorage : isInstalledApp() ? localStorage : sessionStorage)),
      partialize: (s) => ({ user: s.user, token: s.token, refreshToken: s.refreshToken, expiresAt: s.expiresAt, ready: s.ready }),
    },
  ),
)

export const isOnline = () => {
  const s = useSession.getState()
  return s.netOnline && !s.simulateOffline && (!REMOTE || s.serverUp)
}


// ---------------------------------------------------------------------------
// Talking to the API (remote mode)
// ---------------------------------------------------------------------------

let latestVersion = 0
let confirmed: OpsData | null = null

function accept(res: { version: number; data: OpsData }) {
  if (res.version < latestVersion) return
  latestVersion = res.version
  confirmed = structuredClone(res.data)
  useOps.getState().replace(res.data)
  useSession.setState({ serverUp: true })
}

function onNetworkError(e: unknown) {
  if (e instanceof NetworkError) {
    useSession.setState({ serverUp: false })
    return true
  }
  return false
}

export async function refresh() {
  const { token } = useSession.getState()
  if (!REMOTE || !token) return
  try {
    accept(await api.state(await accessToken()))
    useSession.setState({ ready: true })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) useSession.getState().signOut()
    else onNetworkError(e)
  }
}

/** Authenticate with Supabase through the server, then load the shared operation. */
export async function signInWith(email: string, password: string): Promise<User> {
  const r = await api.login(email, password)
  const state = await api.state(r.token)
  latestVersion = 0
  accept(state)
  useSession.getState().signIn(r.user, r.token)
  useSession.setState({ refreshToken: r.refreshToken, expiresAt: r.expiresAt, ready: true })
  return r.user
}
let renewing: Promise<string> | null = null
async function accessToken(): Promise<string> {
  const s = useSession.getState()
  if (!s.token) throw new ApiError(401, 'Sign in again')
  if (s.expiresAt * 1000 > Date.now() + 60_000) return s.token
  if (!s.refreshToken) throw new ApiError(401, 'Sign in again')
  renewing ??= api.refresh(s.refreshToken).then((r) => {
    useSession.setState({ token: r.token, refreshToken: r.refreshToken, expiresAt: r.expiresAt, user: r.user })
    return r.token
  }).finally(() => { renewing = null })
  return renewing
}

export async function saveCommand<K extends CommandName>(name: K, ...args: Parameters<(typeof commands)[K]> extends [OpsData, ...infer R] ? R : never): Promise<ReturnType<(typeof commands)[K]>> {
  const result = await api.command(await accessToken(), name, args)
  accept(result)
  return result.result as ReturnType<(typeof commands)[K]>
}

const QUIET: CommandName[] = ['heartbeat', 'markRead']

/**
 * Run a dispatcher or store command. It applies locally at once (the shared core returns the same
 * result the server will), then the server confirms it and its version replaces ours.
 */
export const ops = <K extends CommandName>(name: K, ...args: Parameters<(typeof commands)[K]> extends [OpsData, ...infer R] ? R : never) => {
  if (REMOTE && !useSession.getState().token) throw new ApiError(401, 'Sign in again')
  const before = structuredClone(useOps.getState().data)
  const out = useOps.getState().run((d) => (commands[name] as (d: OpsData, ...a: unknown[]) => unknown)(d, ...args)) as ReturnType<(typeof commands)[K]>
  const { token } = useSession.getState()
  if (REMOTE && token) {
    accessToken().then((valid) => api.command(valid, name, args)).then(accept, (e) => {
      useOps.getState().replace(structuredClone(confirmed ?? before))
      if (onNetworkError(e)) {
        if (!QUIET.includes(name)) toast('Not saved — no connection to the server', { tone: 'critical', body: 'Your change was undone. Try again when you are back online.' })
      } else if (!QUIET.includes(name)) toast('The server refused this change', { tone: 'critical', body: e instanceof Error ? e.message : String(e) })
      void refresh()
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Device outbox: field events recorded while offline, kept per user in IndexedDB,
// replayed on reconnect with route-conflict detection.
// ---------------------------------------------------------------------------

export interface Outbox {
  queue: QueuedEvent[]
  /** The operation as this device last saw it before losing connection. */
  snapshot: OpsData | null
  offlineFrom: number | null
  lastSync: number | null
  /** A route change found on reconnect, kept until the driver acknowledges it. */
  conflict: RouteConflict | null
}

interface DeviceStore {
  boxes: Record<string, Outbox>
  syncing: boolean
  flakyUploads: boolean
  box: () => Outbox
  record: (event: FieldEvent) => void
  goOffline: () => void
  sync: () => Promise<void>
  retry: (id?: string) => Promise<void>
  acknowledgeConflict: () => void
  setFlaky: (v: boolean) => void
  clear: () => void
}

const emptyBox: Outbox = { queue: [], snapshot: null, offlineFrom: null, lastSync: null, conflict: null }
const key = () => useSession.getState().user?.email ?? 'anon'
const presetBox = preset?.device ? { [DEMO_USERS[preset.preset.role].email]: preset.device } : {}

export const useDevice = create<DeviceStore>()(
  persist(
    (set, get) => {
      const patch = (fn: (b: Outbox) => Partial<Outbox>) => {
        const k = key()
        const b = get().boxes[k] ?? emptyBox
        set({ boxes: { ...get().boxes, [k]: { ...b, ...fn(b) } } })
      }
      const view = () => {
        const b = get().box()
        const d = structuredClone(b.snapshot ?? useOps.getState().data)
        for (const q of b.queue) applyEvent(d, q)
        return d
      }
      return {
        boxes: presetBox,
        syncing: false,
        flakyUploads: false,
        box: () => get().boxes[key()] ?? emptyBox,
        record(event) {
          const user = useSession.getState().user
          if (!user) return
          const q: QueuedEvent = { id: uid('evt'), at: opNow(view()), actor: user.role, event, status: 'pending' }
          if (REMOTE) {
            // Every field action goes through the outbox: sent at once when online, replayed later when not.
            if (!isOnline()) get().goOffline()
            patch((b) => ({ queue: [...b.queue, q] }))
            if (isOnline()) void get().sync()
          } else if (isOnline() && !get().syncing && !get().box().queue.length) {
            useOps.getState().run((d) => applyEvent(d, q))
            patch(() => ({ lastSync: Date.now() }))
          } else {
            get().goOffline()
            patch((b) => ({ queue: [...b.queue, q] }))
          }
        },
        goOffline() {
          if (get().box().snapshot) return
          const d = useOps.getState().data
          patch(() => ({ snapshot: structuredClone(d), offlineFrom: opNow(d) }))
        },
        async sync() {
          if (get().syncing || !isOnline()) return
          const box = get().box()
          const user = useSession.getState().user
          const pending = box.queue.filter((q) => q.status === 'pending')
          if (!pending.length) {
            if (box.snapshot && !box.queue.length) patch(() => ({ snapshot: null, offlineFrom: null }))
            return
          }
          set({ syncing: true })
          const wasOffline = !!box.snapshot
          try {
            await sleep(REMOTE ? 150 : 600)
            // The simulated flaky connection drops photo uploads; everything else goes through.
            const failing = new Set(get().flakyUploads ? pending.filter((q) => q.event.type === 'PROOF' && q.event.photo).map((q) => q.id) : [])
            const sending = pending.filter((q) => !failing.has(q.id))
            const delivered: string[] = []
            const collided: string[] = []
            if (REMOTE) {
              const latest = await api.state(await accessToken())
              const probe = box.snapshot && detectConflict(box.snapshot, latest.data, user?.assignedVehicle, box.offlineFrom ?? 0, [], [], opNow(latest.data))
              const res = await api.events(await accessToken(), sending, wasOffline ? { offlineFrom: box.offlineFrom ?? undefined, routeChanged: !!probe } : undefined)
              res.results.forEach((r, i) => {
                const e = sending[i].event
                if (e.type === 'DELIVER' && r.status !== 'rejected') delivered.push(e.orderId)
                if (r.conflict && 'orderId' in e) collided.push(e.orderId)
              })
              const rejected = res.results.filter((r) => r.status === 'rejected')
              if (rejected.length) toast(`${rejected.length} update${rejected.length > 1 ? 's were' : ' was'} refused by the server`, { tone: 'critical', body: rejected[0].message })
              accept(res)
            } else {
              for (const q of sending) {
                await sleep(200)
                if (!isOnline()) break
                const r = useOps.getState().run((d) => applyEvent(d, q))
                if (q.event.type === 'DELIVER' && r.status !== 'rejected') delivered.push(q.event.orderId)
                if (r.conflict && 'orderId' in q.event) collided.push(q.event.orderId)
              }
            }
            const sent = new Set(sending.map((q) => q.id))
            patch((b) => ({ queue: b.queue.filter((q) => !sent.has(q.id)).map((q) => (failing.has(q.id) ? { ...q, status: 'failed' as const, error: 'Photo upload interrupted' } : q)) }))
            if (wasOffline && box.snapshot) {
              const latest = useOps.getState().data
              const conflict = user?.role === 'DRIVER' ? detectConflict(box.snapshot, latest, user.assignedVehicle, box.offlineFrom ?? 0, delivered, collided, opNow(latest)) : null
              if (!REMOTE && user && (user.role === 'DRIVER' || user.role === 'LOADER'))
                ops('recordSync', { email: user.email, name: user.name, role: user.role, vehicleId: user.assignedVehicle, offlineFrom: box.offlineFrom ?? opNow(latest), events: sending.length, deliveries: delivered.length, conflicts: collided, routeChanged: !!conflict })
              patch(() => ({ conflict: conflict ?? get().box().conflict }))
            }
            const failed = get().box().queue.some((q) => q.status === 'failed')
            patch((b) => ({ snapshot: b.queue.length ? b.snapshot : null, offlineFrom: b.queue.length ? b.offlineFrom : null, lastSync: failed ? b.lastSync : Date.now() }))
          } catch (e) {
            // Lost the connection on the way: keep everything queued and remember what the route looked like.
            if (onNetworkError(e)) get().goOffline()
            else toast('Sync failed', { tone: 'critical', body: e instanceof Error ? e.message : String(e) })
          } finally {
            set({ syncing: false })
          }
        },
        async retry(id) {
          patch((b) => ({ queue: b.queue.map((q) => (!id || q.id === id ? { ...q, status: 'pending', error: undefined } : q)) }))
          set({ flakyUploads: false })
          await get().sync()
        },
        acknowledgeConflict() {
          const c = get().box().conflict
          if (!c) return
          if (c.changeIds.length) get().record({ type: 'ROUTE_ACK', tripId: c.tripId, changeIds: c.changeIds })
          patch(() => ({ conflict: null }))
        },
        setFlaky: (flakyUploads) => set({ flakyUploads }),
        clear: () => set({ boxes: {} }),
      }
    },
    { name: 'kairon-supabase-device-v1', storage: createJSONStorage(storage), partialize: (s) => ({ boxes: s.boxes, flakyUploads: s.flakyUploads }) },
  ),
)

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Network status as the UI shows it. */
export function useNetwork() {
  const netOnline = useSession((s) => s.netOnline)
  const simulateOffline = useSession((s) => s.simulateOffline)
  const serverUp = useSession((s) => s.serverUp)
  const syncing = useDevice((s) => s.syncing)
  const email = useSession((s) => s.user?.email ?? 'anon')
  const box = useDevice((s) => s.boxes[email]) ?? emptyBox
  const online = netOnline && !simulateOffline && (!REMOTE || serverUp)
  const pending = box.queue.filter((q) => q.status === 'pending').length
  const failed = box.queue.filter((q) => q.status === 'failed').length
  const status: 'online' | 'offline' | 'syncing' | 'error' = !online ? 'offline' : syncing ? 'syncing' : failed ? 'error' : 'online'
  return { online, status, pending, failed, queue: box.queue, lastSync: box.lastSync, offlineFrom: box.offlineFrom, conflict: box.conflict }
}

/**
 * What this device believes the operation looks like: the last state it saw,
 * plus everything it has recorded but not yet synchronised.
 */
export function useView(): OpsData {
  const data = useOps((s) => s.data)
  const email = useSession((s) => s.user?.email ?? 'anon')
  const box = useDevice((s) => s.boxes[email])
  return useMemo(() => {
    if (!box || (!box.snapshot && !box.queue.length)) return data
    const d = structuredClone(box.snapshot ?? data)
    for (const q of box.queue) applyEvent(d, q)
    return d
  }, [data, box])
}

/** The operation clock, re-rendering every `ms`. */
export function useNow(ms = 15_000) {
  const clock = useOps((s) => s.data.clock)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
  return opNow({ clock })
}

/** Wire connectivity, cross-tab storage, live server updates and presence into the stores. */
export function useRuntimeBindings() {
  const token = useSession((s) => s.token)
  const email = useSession((s) => s.user?.email)
  const role = useSession((s) => s.user?.role)

  useEffect(() => {
    const up = () => {
      useSession.setState({ netOnline: true })
      void useDevice.getState().sync()
    }
    const down = () => {
      useSession.setState({ netOnline: false })
      useDevice.getState().goOffline()
    }
    const onMessage = (e: MessageEvent<{ key: string; from: string }>) => {
      if (e.data.from === TAB) return
      if (e.data.key === 'kairon-supabase-ops-v1') void useOps.persist.rehydrate()
      if (e.data.key === 'kairon-supabase-device-v1') void useDevice.persist.rehydrate()
    }
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    channel?.addEventListener('message', onMessage)
    const unsub = useDevice.persist.onFinishHydration(() => isOnline() && void useDevice.getState().sync())
    if (useDevice.persist.hasHydrated() && isOnline()) void useDevice.getState().sync()
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      channel?.removeEventListener('message', onMessage)
      unsub()
    }
  }, [])

  // Remote: live version stream, and a light health probe while the server is unreachable.
  useEffect(() => {
    if (!REMOTE || !token) return
    void refresh()
    const close = api.stream(
      token,
      (v) => v > latestVersion && void refresh(),
      (open) => {
        if (open && !useSession.getState().serverUp) {
          useSession.setState({ serverUp: true })
          void useDevice.getState().sync()
        }
      },
    )
    const probe = setInterval(() => {
      if (useSession.getState().serverUp) { void refresh(); return }
      api.health().then(
        () => {
          useSession.setState({ serverUp: true })
          void refresh().then(() => useDevice.getState().sync())
        },
        () => undefined,
      )
    }, 8000)
    return () => {
      close()
      clearInterval(probe)
    }
  }, [token])

  // Local: field devices report presence so the dispatcher can see who has gone quiet.
  useEffect(() => {
    if (REMOTE || PREVIEW || !email || (role !== 'DRIVER' && role !== 'LOADER')) return
    const beat = () => isOnline() && ops('heartbeat', email)
    beat()
    const t = setInterval(beat, 30_000)
    return () => clearInterval(t)
  }, [email, role])
}

/** Demo mode only: put the seeded delivery day back (server) or the preset (sandbox), and clear this device. */
export async function resetDemo() {
  if (REMOTE) {
    await api.reset(await accessToken())
    latestVersion = 0
    await refresh()
  } else useOps.getState().replace(preset?.data ?? seedOps())
  useDevice.getState().clear()
  useSession.getState().setSimulateOffline(false)
}

// ---------------------------------------------------------------------------
// Theme: the driver app is dark by default (Fresh runs leave at 03:30); every other role starts light.
// ---------------------------------------------------------------------------

export type ThemePref = 'light' | 'dark' | 'system'
const DEFAULT_THEME: Record<Role, ThemePref> = { DRIVER: 'dark', LOADER: 'light', DISPATCHER: 'light', STORE_MANAGER: 'light' }

function themePrefFor(role?: Role): ThemePref {
  if (THEME_OVERRIDE) return THEME_OVERRIDE
  if (!role) return 'light'
  try {
    return (localStorage.getItem(`kairon-theme:${role}`) as ThemePref) || DEFAULT_THEME[role]
  } catch {
    return DEFAULT_THEME[role]
  }
}

function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  setThemePref?.(pref)
}

/** Bound once the theme store exists (the session store can apply a theme earlier, during module load). */
let setThemePref: ((pref: ThemePref) => void) | undefined

interface ThemeStore {
  pref: ThemePref
  setPref: (p: ThemePref) => void
}

export const useTheme = create<ThemeStore>(() => ({
  pref: themePrefFor(useSession.getState().user?.role),
  setPref(p) {
    const role = useSession.getState().user?.role
    try {
      if (role) localStorage.setItem(`kairon-theme:${role}`, p)
    } catch {
      /* storage unavailable */
    }
    applyTheme(p)
  },
}))

setThemePref = (pref) => useTheme.setState({ pref })

if (typeof window !== 'undefined') {
  applyTheme(themePrefFor(useSession.getState().user?.role))
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useTheme.getState().pref))
  useSession.persist.onFinishHydration((s) => applyTheme(themePrefFor(s.user?.role)))
}
