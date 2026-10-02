import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../store/remote'
import { accessToken } from '../store'
import { Button, toast } from './ui'
import { Capacitor } from '@capacitor/core'

type Settings = Awaited<ReturnType<typeof api.preferences>>
export function NotificationSettings() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const native = Capacitor.isNativePlatform()
  useEffect(() => {
    let active = true
    void accessToken().then(api.preferences).then((value) => { if (active) setSettings(value) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])
  const update = async (key: keyof Settings['preferences'], enabled: boolean) => {
    if (!settings) return
    setBusy(true)
    try {
      const token = await accessToken()
      if (key === 'push' && native) {
        const { FirebaseMessaging } = await import('../lib/native-push')
        if (enabled) {
          if ((await FirebaseMessaging.requestPermissions()).receive !== 'granted') throw new Error('Permission denied')
          const device = await FirebaseMessaging.getToken()
          await api.registerNativePush(token, device.token)
        } else await FirebaseMessaging.deleteToken()
      }
      if (key === 'push' && enabled && !native) {
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !settings.publicKey) throw new Error('Push unavailable')
        if (await Notification.requestPermission() !== 'granted') throw new Error('Permission denied')
        const registration = await navigator.serviceWorker.ready
        const keyBytes = Uint8Array.from(atob(settings.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
        const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes })
        await api.registerPush(token, subscription.toJSON())
      }
      if (key === 'push' && !enabled && !native && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) { await api.removePush(token, subscription.endpoint); await subscription.unsubscribe() }
      }
      const preferences = { ...settings.preferences, [key]: enabled }
      await api.setPreferences(token, preferences)
      setSettings({ ...settings, preferences })
    } catch { toast(t('notificationSettings.failed'), { tone: 'critical' }) }
    finally { setBusy(false) }
  }
  if (!settings) return <span className="text-xs text-muted">{t(failed ? 'notificationSettings.failed' : 'notificationSettings.loading')}</span>
  return <div className="flex flex-col gap-2 text-sm">
    {(['push', 'email', 'sms', 'criticalOnly'] as const).map((key) => <label key={key} className="flex items-center gap-2">
      <input type="checkbox" checked={settings.preferences[key]} disabled={busy || key !== 'criticalOnly' && !(key === 'push' && native ? settings.channels.nativePush : settings.channels[key])} onChange={(event) => void update(key, event.target.checked)} />
      {t(`notificationSettings.${key}`)}
      {key !== 'criticalOnly' && !(key === 'push' && native ? settings.channels.nativePush : settings.channels[key]) && <span className="text-xs text-muted">{t('notificationSettings.unavailable')}</span>}
    </label>)}
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void accessToken().then(api.preferences).then(setSettings).catch(() => toast(t('notificationSettings.failed'), { tone: 'critical' }))}>{t('notificationSettings.refresh')}</Button>
    <span className="max-w-xs text-xs text-muted">{t('notificationSettings.phoneHint')}</span>
  </div>
}
