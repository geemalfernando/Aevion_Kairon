import { Bell, ChevronRight, Clock, CloudOff, LogOut, Menu, Moon, RefreshCw, Route as RouteIcon, Search, Sun, SunMoon, TriangleAlert, User as UserIcon, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { fmtClock, fmtDate, timeAgo } from '@core/time'
import type { Notification, Role, User } from '@core/types'
import { ops, useNetwork, useNow, useSession, useTheme, useView } from '../../store'
import { Copyright } from '../Copyright'
import { LanguageSwitch } from '../LanguageSwitch'
import { Badge, cn, IconButton, Logo, severityTone, toast, toneDot } from '../ui'
import { HOME, NAV, ROLE_LABEL, type NavItem } from './nav'
import { SearchDialog } from './SearchDialog'

export function visibleNotifications(list: Notification[], user: User) {
  return list.filter((n) => n.to.includes(user.role) && (!n.outletId || n.outletId === user.assignedOutlet) && (!n.vehicleId || n.vehicleId === user.assignedVehicle))
}

const isField = (r: Role) => r === 'DRIVER' || r === 'LOADER'

function useBadges(role: Role) {
  const d = useView()
  const net = useNetwork()
  return {
    issues: role === 'DISPATCHER' ? d.issues.filter((i) => !i.resolved).length : role === 'LOADER' ? d.issues.filter((i) => !i.resolved && i.kind === 'SHORTFALL').length : 0,
    deferred: d.orders.filter((o) => o.status === 'DEFERRED' && !o.deferral?.confirmed).length,
    sync: net.pending + net.failed,
  }
}

function useNavLabel() {
  const { t } = useTranslation()
  return (it: NavItem) => (it.labelKey ? t(it.labelKey) : it.label)
}

export function AppShell() {
  const user = useSession((s) => s.user)!
  const nav = NAV[user.role]
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const loc = useLocation()
  const { t } = useTranslation()
  const label = useNavLabel()
  useEffect(() => setMoreOpen(false), [loc.pathname])
  useSyncToasts(user.role)
  useConflictRedirect(user.role)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const allItems = nav.sections.flatMap((s) => s.items)
  const bottomItems = nav.bottom.map((to) => allItems.find((i) => i.to === to)!).filter(Boolean)
  const field = isField(user.role)

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-col">
        <TopBar user={user} onSearch={() => setSearchOpen(true)} onNotifications={() => setNotifOpen(true)} />
        <ConnectivityStrip role={user.role} />
        {user.role === 'DRIVER' && <ConflictBanner />}
        <main className={cn('mx-auto w-full flex-1 px-4 pb-8 pt-6 sm:px-6 lg:px-8 lg:pb-12', field ? 'max-w-3xl lg:max-w-5xl' : 'max-w-[1440px]')}>
          <Outlet />
        </main>
        <footer className="border-t border-line px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] text-center text-xs text-muted lg:pb-5">
          <Copyright />
        </footer>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {bottomItems.map((it) => (
            <BottomLink key={it.to} item={it} role={user.role} />
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted">
            <Menu className="size-5" />
            {field ? t('nav.more') : 'More'}
          </button>
        </div>
      </nav>
      {moreOpen && <MoreSheet user={user} onClose={() => setMoreOpen(false)} label={label} />}

      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} user={user} />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}

function Sidebar({ user }: { user: User }) {
  const badges = useBadges(user.role)
  const label = useNavLabel()
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link to={HOME[user.role]}>
          <Logo />
        </Link>
      </div>
      <div className="mx-4 mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs">
        <div className="eyebrow !text-[10px]">{ROLE_LABEL[user.role]} workspace</div>
        <div className="mt-0.5 font-medium">{user.role === 'STORE_MANAGER' ? `Outlet ${user.assignedOutlet}` : user.role === 'DRIVER' ? `${user.assignedVehicle} · ${user.depot}` : `${user.depot} depot`}</div>
      </div>
      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Workspace">
        {NAV[user.role].sections.map((s, i) => (
          <div key={i}>
            {s.title && <div className="eyebrow mb-1.5 px-2 !text-[10px]">{s.title}</div>}
            <ul className="space-y-0.5">
              {s.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.end}
                    className={({ isActive }) => cn('group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition', isActive ? 'bg-brand-fill text-on-brand shadow-sm' : 'text-muted hover:bg-surface-2 hover:text-ink')}
                  >
                    <it.icon className="size-[18px] shrink-0" />
                    <span className="flex-1">{label(it)}</span>
                    {it.badge && badges[it.badge] > 0 && (
                      <Badge tone={it.badge === 'issues' ? 'critical' : it.badge === 'sync' ? 'info' : 'attention'} className="!px-1.5 !text-[10px]">
                        {badges[it.badge]}
                      </Badge>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <UserCard user={user} />
    </aside>
  )
}

function UserCard({ user }: { user: User }) {
  const signOut = useSession((s) => s.signOut)
  const navigate = useNavigate()
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 border-t border-line p-4">
      <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal font-display text-sm font-semibold text-white">{user.name[0]}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{user.name}</span>
          <span className="block truncate text-xs text-muted">{ROLE_LABEL[user.role]}</span>
        </span>
      </Link>
      <IconButton
        label={t('nav.sign_out')}
        onClick={() => {
          signOut()
          navigate('/login')
        }}
      >
        <LogOut className="size-4" />
      </IconButton>
    </div>
  )
}

function BottomLink({ item, role }: { item: NavItem; role: Role }) {
  const badges = useBadges(role)
  const label = useNavLabel()
  const n = item.badge ? badges[item.badge] : 0
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => cn('relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand-ink' : 'text-muted')}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand" />}
          <span className="relative">
            <item.icon className="size-5" />
            {n > 0 && <span className="absolute -right-2 -top-1 grid min-w-4 place-items-center rounded-full bg-attention-fill px-1 text-[9px] font-bold text-white">{n}</span>}
          </span>
          <span className="max-w-full truncate px-1">{label(item).split(' ')[0]}</span>
        </>
      )}
    </NavLink>
  )
}

function MoreSheet({ user, onClose, label }: { user: User; onClose: () => void; label: (it: NavItem) => string }) {
  const signOut = useSession((s) => s.signOut)
  const navigate = useNavigate()
  const { t } = useTranslation()
  const items = NAV[user.role].sections.flatMap((s) => s.items)
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal aria-label={t('nav.menu')}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] animate-rise overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold">{t('nav.menu')}</span>
          <IconButton label={t('common.close')} onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => cn('flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs font-medium', isActive ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line')}>
              <it.icon className="size-5" />
              {label(it)}
            </NavLink>
          ))}
        </div>
        {isField(user.role) && <LanguageSwitch className="mt-4" />}
        <div className="mt-4 flex gap-2">
          <Link to="/profile" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-line text-sm font-medium">
            <UserIcon className="size-4" /> {t('nav.profile')}
          </Link>
          <button
            onClick={() => {
              signOut()
              navigate('/login')
            }}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-line text-sm font-medium"
          >
            <LogOut className="size-4" /> {t('nav.sign_out')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function NetworkPill({ compact }: { compact?: boolean }) {
  const net = useNetwork()
  const user = useSession((s) => s.user)
  const { t } = useTranslation()
  const meta = {
    online: { label: t('sync.online'), dot: 'bg-brand', text: 'text-brand-ink' },
    syncing: { label: t('sync.syncing'), dot: 'bg-info animate-pulse', text: 'text-info-ink' },
    offline: { label: t('sync.offline'), dot: 'bg-steel', text: 'text-muted' },
    error: { label: t('sync.error'), dot: 'bg-critical', text: 'text-critical-ink' },
  }[net.status]
  const to = user?.role === 'DRIVER' ? '/driver/sync' : user?.role === 'LOADER' ? '/loader/sync' : undefined
  const body = (
    <span className={cn('inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3 text-xs font-semibold', meta.text)}>
      <span className={cn('size-2 rounded-full', meta.dot)} />
      {(!compact || net.status !== 'online') && meta.label}
      {net.pending > 0 && (
        <span className="inline-flex items-center gap-1 text-muted">
          <CloudOff className="size-3.5" /> {net.pending}
        </span>
      )}
    </span>
  )
  return to ? (
    <Link to={to} aria-label={`${meta.label}. ${t('sync.queued', { count: net.pending })}`}>
      {body}
    </Link>
  ) : (
    body
  )
}

/** The operation clock: the demo can run the 03:30 Fresh window at any hour of the day. */
function ClockChip({ full }: { full?: boolean }) {
  const now = useNow(15_000)
  const { t } = useTranslation()
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold tabular-nums text-muted" title={t('shell.clock')}>
      <Clock className="size-3.5" />
      {full && <span className="hidden xl:inline">{fmtDate(now, { weekday: 'short', day: 'numeric', month: 'short' })} ·</span>}
      {fmtClock(now)}
    </span>
  )
}

function TopBar({ user, onSearch, onNotifications }: { user: User; onSearch: () => void; onNotifications: () => void }) {
  const d = useView()
  const now = useNow(60_000)
  const { t } = useTranslation()
  const unread = visibleNotifications(d.notifications, user).filter((n) => !n.readBy.includes(user.role)).length
  const { pref, setPref } = useTheme()
  const next = pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light'
  const ThemeIcon = pref === 'light' ? Sun : pref === 'dark' ? Moon : SunMoon
  const searchable = user.role === 'DISPATCHER' || user.role === 'STORE_MANAGER'
  const field = isField(user.role)
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
        <Link to={HOME[user.role]} className="lg:hidden">
          <Logo className="!text-[15px]" />
        </Link>
        <div className="hidden min-w-0 lg:block">
          <div className="text-sm font-semibold">{user.role === 'STORE_MANAGER' ? byOutlet(d, user.assignedOutlet) : `${user.depot} Operations`}</div>
          <div className="text-xs text-muted">
            {fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' })} · deliveries for {fmtDate(d.deliveryDate, { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
        </div>
        {searchable && (
          <button onClick={onSearch} className="ml-4 hidden h-9 w-64 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm text-faint transition hover:border-line-strong md:flex">
            <Search className="size-4" />
            <span className="flex-1 truncate text-left">Search ORD, OUT, VEH…</span>
            <kbd className="rounded border border-line bg-surface px-1.5 font-mono text-[10px]">⌘K</kbd>
          </button>
        )}
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {searchable && (
            <IconButton label="Search" onClick={onSearch} className="md:hidden">
              <Search className="size-[18px]" />
            </IconButton>
          )}
          {field && (
            <span className="hidden sm:inline-flex">
              <LanguageSwitch compact />
            </span>
          )}
          <span className="hidden sm:inline-flex">
            <ClockChip full={!field} />
          </span>
          <NetworkPill compact={field} />
          <IconButton label={`${t('nav.notifications')}${unread ? ` (${unread})` : ''}`} onClick={onNotifications}>
            <Bell className="size-[18px]" />
            {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-attention-fill px-1 text-[9px] font-bold leading-4 text-white">{unread > 9 ? '9+' : unread}</span>}
          </IconButton>
          <IconButton label={`Theme: ${pref}. Switch to ${next}`} onClick={() => setPref(next)}>
            <ThemeIcon className="size-[18px]" />
          </IconButton>
        </div>
      </div>
    </header>
  )
}

const byOutlet = (d: ReturnType<typeof useView>, id?: string) => {
  const o = d.outlets.find((x) => x.id === id)
  return o ? `${o.name} · ${o.id}` : 'Store'
}

/** Persistent strip whenever the device is offline, syncing or needs attention. */
function ConnectivityStrip({ role }: { role: Role }) {
  const net = useNetwork()
  const { t } = useTranslation()
  const to = role === 'DRIVER' ? '/driver/sync' : role === 'LOADER' ? '/loader/sync' : undefined
  if (net.status === 'online') return null
  const cfg = {
    offline: {
      cls: 'bg-ink text-bg',
      icon: <CloudOff className="size-4" />,
      text: (
        <>
          <b>{t('shell.offline')}</b> {isField(role) ? t('shell.offline_field') : t('shell.offline_office')}
          {net.pending > 0 && <span className="ml-1 opacity-80">{t('shell.waiting', { count: net.pending })}</span>}
        </>
      ),
    },
    syncing: { cls: 'bg-info-fill text-white', icon: <RefreshCw className="size-4 animate-spin" />, text: <>{t('shell.syncing', { count: net.pending })}</> },
    error: {
      cls: 'bg-critical-fill text-white',
      icon: <TriangleAlert className="size-4" />,
      text: (
        <>
          <b>{t('shell.attention')}</b> {t('shell.failed', { count: net.failed })}
        </>
      ),
    },
  }[net.status]
  const inner = (
    <div className="flex items-center gap-2.5 px-4 py-2 text-[13px] sm:px-6 lg:px-8" role="status">
      {cfg.icon}
      <span className="flex-1">{cfg.text}</span>
      {to && <ChevronRight className="size-4 opacity-70" />}
    </div>
  )
  return <div className={cfg.cls}>{to ? <Link to={to}>{inner}</Link> : inner}</div>
}

/** After reconnecting, a route change stays visible until the driver has reviewed it. */
function ConflictBanner() {
  const net = useNetwork()
  const loc = useLocation()
  const { t } = useTranslation()
  if (!net.conflict || loc.pathname === '/driver/reconcile') return null
  return (
    <Link to="/driver/reconcile" className="flex items-center gap-2.5 bg-attention-fill px-4 py-2.5 text-[13px] text-white sm:px-6 lg:px-8">
      <RouteIcon className="size-4 shrink-0" />
      <span className="flex-1">
        <b>{t('driver.changes_title')}</b> {t('driver.changes_body')}
      </span>
      <span className="font-semibold underline">{t('driver.changes_cta')}</span>
    </Link>
  )
}

function useConflictRedirect(role: Role) {
  const net = useNetwork()
  const navigate = useNavigate()
  const seen = useRef(net.conflict?.at)
  useEffect(() => {
    if (role !== 'DRIVER' || !net.conflict || seen.current === net.conflict.at) return
    seen.current = net.conflict.at
    navigate('/driver/reconcile')
  }, [net.conflict, role, navigate])
}

function useSyncToasts(role: Role) {
  const net = useNetwork()
  const { t } = useTranslation()
  const prev = useRef(net.status)
  useEffect(() => {
    const was = prev.current
    prev.current = net.status
    if (was === net.status || !isField(role)) return
    if (net.status === 'offline') toast(t('shell.toast_offline'), { tone: 'neutral', body: t('shell.toast_offline_body') })
    if (was === 'syncing' && net.status === 'online') toast(t('shell.toast_synced'), { body: t('shell.toast_synced_body', { time: fmtClock(Date.now()) }) })
    if (was === 'offline' && net.status === 'online') toast(t('shell.toast_restored'), { tone: 'info' })
    if (net.status === 'error') toast(t('shell.toast_attention'), { tone: 'critical', body: t('shell.toast_attention_body') })
  }, [net.status, role, t])
}

function NotificationsDrawer({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const d = useView()
  const now = useNow()
  const { t } = useTranslation()
  const list = useMemo(() => visibleNotifications(d.notifications, user), [d.notifications, user])
  const navigate = useNavigate()
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => ops('markRead', user.role), 1200)
    return () => clearTimeout(timer)
  }, [open, user.role])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal aria-label={t('nav.notifications')}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md animate-rise flex-col border-l border-line bg-surface shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{t('nav.notifications')}</h2>
            <p className="text-xs text-muted">{t('shell.unread', { count: list.filter((n) => !n.readBy.includes(user.role)).length })}</p>
          </div>
          <IconButton label={t('common.close')} onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto">
          {list.length === 0 && <p className="p-8 text-center text-sm text-muted">{t('shell.all_caught_up')}</p>}
          {list.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (n.link) navigate(n.link)
                onClose()
              }}
              className={cn('flex w-full gap-3 border-b border-line px-5 py-3.5 text-left transition hover:bg-surface-2', !n.readBy.includes(user.role) && 'bg-brand-soft/40')}
            >
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', toneDot[severityTone[n.severity]])} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-faint">{timeAgo(n.at, now)}</span>
                </span>
                <span className="block text-sm text-muted">{n.body}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
