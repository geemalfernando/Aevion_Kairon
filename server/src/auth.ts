import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { User } from '@core/types'
import { config } from './config'
import * as local from './auth-local'
import { authClient } from './supabase'

/** Supabase Auth on the hosted deployment; the local demo accounts (auth-local.ts) with the local backend. */
export interface Session extends User { exp: number; id: string }
const roles = ['DISPATCHER', 'LOADER', 'DRIVER', 'STORE_MANAGER'] as const
export function profile(email: string | undefined, metadata: Record<string, unknown>): User | null {
  const role = metadata.role
  if (!email || !roles.includes(role as typeof roles[number]) || !['Peliyagoda', 'Kandy'].includes(String(metadata.depot)) || typeof metadata.name !== 'string' || !metadata.name.trim()) return null
  return { email, name: metadata.name, role: role as User['role'], depot: metadata.depot as User['depot'], assignedVehicle: typeof metadata.assignedVehicle === 'string' ? metadata.assignedVehicle : undefined, assignedOutlet: typeof metadata.assignedOutlet === 'string' ? metadata.assignedOutlet : undefined }
}
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
export async function verifyToken(token: string | undefined): Promise<Session | null> {
  if (config.backend === 'postgres') return local.verifyToken(token)
  if (!token) return null
  try {
    jwks ??= createRemoteJWKSet(new URL(config.supabaseJwksUrl))
    const { payload } = await jwtVerify(token, jwks, { issuer: `${config.supabaseUrl}/auth/v1`, audience: 'authenticated', algorithms: ['ES256', 'RS256'] })
    if (!payload.sub || !payload.exp) return null
    const user = profile(payload.email as string, (payload.app_metadata ?? {}) as Record<string, unknown>)
    return user ? { ...user, id: payload.sub, exp: payload.exp * 1000 } : null
  } catch { return null }
}
export async function login(email: string, password: string) {
  if (config.backend === 'postgres') return local.login(email, password)
  const { data, error } = await authClient().auth.signInWithPassword({ email: email.trim(), password })
  if (error || !data.session) return null
  const user = profile(data.user.email, data.user.app_metadata)
  return user ? { user, token: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at } : null
}
export async function refreshSession(refreshToken: string) {
  if (config.backend === 'postgres') return local.refreshSession(refreshToken)
  const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.session || !data.user) return null
  const user = profile(data.user.email, data.user.app_metadata)
  return user ? { user, token: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at } : null
}
