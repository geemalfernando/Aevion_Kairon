import type { Notification, User } from '@core/types'
import type { Channel, Preferences } from './store'
import { safeError } from './providers'

export function eligible(n: Notification, user: User, preferences: Preferences) {
  if (!n.depot || n.depot !== user.depot || !n.to.includes(user.role)) return false
  if (user.role === 'DRIVER' && (!user.assignedVehicle || n.vehicleId !== user.assignedVehicle)) return false
  if (user.role === 'STORE_MANAGER' && (!user.assignedOutlet || n.outletId !== user.assignedOutlet)) return false
  if (preferences.criticalOnly && !['HIGH', 'CRITICAL'].includes(n.severity)) return false
  return true
}
export interface DeliveryPort {
  claim: (id: string, channel: Channel) => Promise<boolean>
  status: (id: string) => Promise<string | null>
  finish: (id: string, status: 'sent' | 'skipped' | 'failed', code?: string) => Promise<void>
}
/** Lease + durable result. Provider acceptance followed by a process crash can still cause a retry duplicate. */
export async function deliver(id: string, channel: Channel, send: () => Promise<string>, db: DeliveryPort, invalidate?: () => Promise<void>) {
  if (!await db.claim(id, channel)) {
    if (!['sent', 'skipped'].includes(await db.status(id) ?? '')) throw new Error('DeliveryLeaseBusy')
    return
  }
  try {
    const providerId = await send()
    await db.finish(id, 'sent', providerId)
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (channel === 'push' && [404, 410].includes(status ?? 0)) {
      await invalidate?.()
      await db.finish(id, 'skipped', 'InvalidSubscription')
      return
    }
    await db.finish(id, 'failed', safeError(error))
    throw new Error('NotificationDeliveryFailed')
  }
}
