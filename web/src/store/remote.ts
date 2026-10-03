/** Client for the authenticated API (RDS or legacy Supabase). */
import type { CommandName } from '@core/ops'
import type { PublicSummary } from '@core/summary'
import type { OpsData, QueuedEvent, User } from '@core/types'
import { Capacitor } from '@capacitor/core'

export const API_MODE: 'remote' | 'local' = 'remote'
const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
export const COOKIE_SESSION = !Capacitor.isNativePlatform()

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The request never reached the server (no signal, server down). The caller treats this as offline. */
export class NetworkError extends Error {}

async function request<T>(path: string, init: { method?: string; body?: unknown; token?: string; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000)
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      headers: { 'x-session-mode': COOKIE_SESSION ? 'cookie' : 'bearer', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    })
  } catch {
    throw new NetworkError('No connection to the server')
  } finally {
    clearTimeout(timer)
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`)
  return json
}

export interface StateResponse {
  version: number
  data: OpsData
}

export interface EventResult {
  id: string
  status: 'applied' | 'duplicate' | 'rejected'
  conflict?: boolean
  message?: string
}

// Browser tabs share the HttpOnly refresh cookie. Serialize cookie-changing requests
// across tabs so normal refresh races are not mistaken for refresh-token replay.
function sessionRequest<T>(action: () => Promise<T>): Promise<T> {
  if (COOKIE_SESSION && typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('kairon-session-cookie', action)
  return action()
}

export const api = {
  login: (email: string, password: string) => sessionRequest(() => request<{ token: string; refreshToken: string | null; expiresAt: number; user: User }>('/api/auth/login', { body: { email, password } })),
  refresh: (refreshToken: string | null, expectedEmail?: string) => sessionRequest(() => request<{ token: string; refreshToken: string | null; expiresAt: number; user: User }>('/api/auth/refresh', { body: { refreshToken, expectedEmail } })),
  logout: (token: string | null) => sessionRequest(() => request('/api/auth/logout', { body: {}, token: token ?? undefined })),
  preferences: (token: string) => request<{ preferences: { push: boolean; email: boolean; sms: boolean; criticalOnly: boolean }; channels: { push: boolean; nativePush: boolean; email: boolean; sms: boolean }; publicKey: string | null }>('/api/notifications/preferences', { token }),
  setPreferences: (token: string, preferences: { push: boolean; email: boolean; sms: boolean; criticalOnly: boolean }) => request('/api/notifications/preferences', { token, body: preferences }),
  registerPush: (token: string, subscription: PushSubscriptionJSON) => request('/api/notifications/push', { token, body: subscription }),
  registerNativePush: (token: string, deviceToken: string) => request('/api/notifications/native-push', { token, body: { token: deviceToken } }),
  removePush: (token: string, endpoint: string) => request('/api/notifications/push/remove', { token, body: { endpoint } }),
  state: (token: string) => request<StateResponse>('/api/state', { token }),
  command: (token: string, name: CommandName, args: unknown[]) => request<StateResponse & { result: unknown }>(`/api/commands/${name}`, { token, body: { args } }),
  events: (token: string, events: QueuedEvent[], sync?: { offlineFrom?: number; routeChanged?: boolean }) =>
    request<StateResponse & { results: EventResult[] }>('/api/events', { token, body: { events, sync }, timeoutMs: 30_000 }),
  /** Demo mode only: the server puts the seeded delivery day back. */
  reset: (token: string) => request<{ version: number }>('/api/demo/reset', { token, body: {} }),
  health: () => request<{ ok: boolean }>('/api/health', { timeoutMs: 4000 }),
  /** Landing page figures; no sign-in needed. */
  publicSummary: () => request<PublicSummary>('/api/public/summary', { timeoutMs: 8000 }),
  /** Live version updates (server-sent events). Returns a close function. */
  stream(token: string, onVersion: (v: number) => void, onStatus: (open: boolean) => void) {
    // fetch supports Authorization headers; EventSource would put the access token in the URL.
    const ctrl = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = async () => {
      try {
        const res = await fetch(`${API_URL}/api/stream`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal })
        if (!res.ok || !res.body) throw new Error('Live stream unavailable')
        onStatus(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        try {
          while (!ctrl.signal.aborted) {
            const { value, done } = await reader.read()
            if (done) break
            pending += decoder.decode(value, { stream: true })
            let boundary: number
            while ((boundary = pending.indexOf('\n\n')) !== -1) {
              const event = pending.slice(0, boundary)
              pending = pending.slice(boundary + 2)
              if (!event.split('\n').includes('event: version')) continue
              const data = event.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
              if (data) {
                const version = (JSON.parse(data) as { version: number }).version
                if (Number.isSafeInteger(version)) onVersion(version)
              }
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
      } catch {
        // The regular authenticated state probe renews expired tokens and restarts this binding.
      }
      if (!ctrl.signal.aborted) {
        onStatus(false)
        retry = setTimeout(() => void connect(), 3000)
      }
    }
    void connect()
    return () => { ctrl.abort(); clearTimeout(retry) }
  },
}
