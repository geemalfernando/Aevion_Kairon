import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { useEffect } from 'react'
import { api } from '../store/remote'
import { accessToken, useSession } from '../store'

/** Re-register token changes for the signed-in, consenting user; never subscribe a device to a role-wide topic. */
export function NativeNotifications() {
  const token = useSession((state) => state.token)
  useEffect(() => {
    if (!token || !Capacitor.isNativePlatform()) return
    let active = true
    const listeners: PluginListenerHandle[] = []
    const track = async (listener: Promise<PluginListenerHandle>) => {
      const handle = await listener
      if (active) listeners.push(handle)
      else await handle.remove()
    }
    void (async () => {
      const { FirebaseMessaging } = await import('../lib/native-push')
      const settings = await api.preferences(await accessToken())
      if (!active || !settings.channels.nativePush || !settings.preferences.push) return
      const register = async (deviceToken: string) => {
        if (!active) return
        const access = await accessToken()
        const latest = await api.preferences(access)
        if (active && latest.preferences.push) await api.registerNativePush(access, deviceToken)
      }
      await track(FirebaseMessaging.addListener('tokenReceived', (event) => { void register(event.token).catch(() => undefined) }))
      await track(FirebaseMessaging.addListener('notificationActionPerformed', () => { if (active) window.location.assign('/login') }))
      if ((await FirebaseMessaging.checkPermissions()).receive === 'granted') await register((await FirebaseMessaging.getToken()).token)
    })().catch(() => undefined)
    return () => { active = false; for (const handle of listeners) void handle.remove() }
  }, [token])
  return null
}
