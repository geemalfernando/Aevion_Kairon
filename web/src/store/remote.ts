/** Client for the authenticated, Supabase-backed API. */
import type { CommandName } from '@core/ops'
import type { OpsData, QueuedEvent, User } from '@core/types'

export const API_MODE: 'remote' | 'local' = 'remote'
const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

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
      headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
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

export const api = {
  login: (email: string, password: string) => request<{ token: string; refreshToken: string; expiresAt: number; user: User }>('/api/auth/login', { body: { email, password } }),
  refresh: (refreshToken: string) => request<{ token: string; refreshToken: string; expiresAt: number; user: User }>('/api/auth/refresh', { body: { refreshToken } }),
  state: (token: string) => request<StateResponse>('/api/state', { token }),
  command: (token: string, name: CommandName, args: unknown[]) => request<StateResponse & { result: unknown }>(`/api/commands/${name}`, { token, body: { args } }),
  events: (token: string, events: QueuedEvent[], sync?: { offlineFrom?: number; routeChanged?: boolean }) =>
    request<StateResponse & { results: EventResult[] }>('/api/events', { token, body: { events, sync }, timeoutMs: 30_000 }),
  health: () => request<{ ok: boolean }>('/api/health', { timeoutMs: 4000 }),
  /** Live version updates (server-sent events). Returns a close function. */
  stream(token: string, onVersion: (v: number) => void, onStatus: (open: boolean) => void) {
    const es = new EventSource(`${API_URL}/api/stream?token=${encodeURIComponent(token)}`)
    es.addEventListener('version', (e) => onVersion(JSON.parse((e as MessageEvent).data).version))
    es.onopen = () => onStatus(true)
    es.onerror = () => onStatus(false)
    return () => es.close()
  },
}
