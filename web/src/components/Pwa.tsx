import { Capacitor } from '@capacitor/core'
import { Bookmark, Download, RefreshCw, Share, WifiOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { create } from 'zustand'
import { Button, IconButton, Logo } from './ui'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const isStandalone = () => typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)

/** Captures the browser's install prompt as early as possible so any screen can offer it. */
export const useInstall = create<{ evt: BeforeInstallPromptEvent | null; installed: boolean; prompt: () => Promise<void> }>((set, get) => ({
  evt: null,
  installed: isStandalone(),
  async prompt() {
    const e = get().evt
    if (!e) return
    await e.prompt()
    const r = await e.userChoice
    set({ evt: null, installed: r.outcome === 'accepted' })
  },
}))
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    useInstall.setState({ evt: e as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => useInstall.setState({ evt: null, installed: true }))
}

export const canInstall = () => !!useInstall.getState().evt || (isIos() && !isStandalone())

/** Whether the update / offline-ready card is on screen; the install reminder waits for it (same corner). */
const usePwaBanner = create<{ showing: boolean }>(() => ({ showing: false }))

/** Service-worker lifecycle: new version available, and first "ready offline" moment. */
export function PwaUpdater() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Look for new versions every 30 minutes while the app is open.
      if (reg) setInterval(() => void reg.update(), 30 * 60 * 1000)
    },
  })
  // Tiles cached before the map sent a Referer are OpenStreetMap "Access denied" images; drop that cache (now osm-tiles-v2).
  useEffect(() => {
    if ('caches' in window) void caches.delete('osm-tiles').catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!offlineReady) return
    const t = setTimeout(() => setOfflineReady(false), 6000)
    return () => clearTimeout(t)
  }, [offlineReady, setOfflineReady])

  const showing = needRefresh || offlineReady
  useEffect(() => usePwaBanner.setState({ showing }), [showing])
  if (!showing) return null
  return (
    <div role="status" className="fixed inset-x-3 bottom-24 z-[70] mx-auto max-w-sm animate-rise rounded-2xl border border-line bg-surface p-4 shadow-pop lg:bottom-6 lg:left-auto lg:right-6">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">{needRefresh ? <RefreshCw className="size-4" /> : <WifiOff className="size-4" />}</span>
        <div className="flex-1">
          <div className="text-sm font-semibold">{needRefresh ? 'A new version of Kairon is ready' : 'Kairon is ready to work offline'}</div>
          <p className="text-xs text-muted">{needRefresh ? 'Reload to update. Anything waiting to sync is kept on this device.' : 'Every screen is saved on this device — keep working when the signal drops.'}</p>
          {needRefresh && (
            <Button size="sm" className="mt-3" icon={<RefreshCw className="size-3.5" />} onClick={() => updateServiceWorker(true)}>
              Reload
            </Button>
          )}
        </div>
        <IconButton label="Dismiss" className="-mr-2 -mt-2" onClick={() => (setNeedRefresh(false), setOfflineReady(false))}>
          <X className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}

const DISMISS_KEY = 'kairon-install-dismissed'
const DISMISS_DAYS = 7

/** Which way this browser can save Kairon: a real install prompt, or the manual steps for its platform. */
function installMethod(hasPrompt: boolean): 'prompt' | 'ios' | 'android' | 'macSafari' | 'bookmark' {
  if (hasPrompt) return 'prompt'
  const ua = navigator.userAgent
  if (isIos()) return 'ios'
  if (/android/i.test(ua)) return 'android'
  if (/macintosh/i.test(ua) && /safari/i.test(ua) && !/chrome|chromium|crios|edg|firefox|fxios/i.test(ua)) return 'macSafari'
  return 'bookmark'
}

/** Install / bookmark reminder for every visitor; hidden in the native app, once installed, or for a week after dismissal. */
export function InstallPrompt() {
  const { t } = useTranslation()
  const evt = useInstall((s) => s.evt)
  const installed = useInstall((s) => s.installed)
  const bannerShowing = usePwaBanner((s) => s.showing)
  const prompt = useInstall((s) => s.prompt)
  // Wait for the splash screen and first paint before asking.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 4000)
    return () => clearTimeout(timer)
  }, [])
  const [hidden, setHidden] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_DAYS * 86_400_000
    } catch {
      return false
    }
  })
  if (!ready || bannerShowing || installed || hidden || Capacitor.isNativePlatform()) return null
  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* ignore */
    }
  }
  const method = installMethod(!!evt)
  const keys = /mac/i.test(navigator.userAgent) ? '⌘ D' : 'Ctrl + D'
  return (
    <div role="dialog" aria-labelledby="install-title" className="fixed inset-x-3 bottom-20 z-[60] mx-auto max-w-md animate-rise rounded-2xl border border-line bg-surface p-4 shadow-pop lg:bottom-6 lg:left-auto lg:right-6">
      <div className="flex items-start gap-3">
        <Logo className="!gap-0 !text-[0px]" />
        <div className="flex-1">
          <div id="install-title" className="font-semibold">{t(method === 'bookmark' ? 'install.bookmarkTitle' : 'install.title')}</div>
          <p className="text-sm text-muted">{t('install.body')}</p>
          {method === 'prompt' ? (
            <div className="mt-3 flex gap-2">
              <Button size="sm" icon={<Download className="size-4" />} onClick={() => prompt().then(dismiss)}>
                {t('install.button')}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                {t('install.later')}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-sm">
              {method === 'ios' && <Share className="mr-1 inline size-4 align-[-3px] text-info" />}
              {method === 'bookmark' && <Bookmark className="mr-1 inline size-4 align-[-3px] text-info" />}
              {t(`install.${method}`, { keys })}
            </p>
          )}
        </div>
        <IconButton label={t('install.dismiss')} onClick={dismiss} className="-mr-2 -mt-2">
          <X className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}
