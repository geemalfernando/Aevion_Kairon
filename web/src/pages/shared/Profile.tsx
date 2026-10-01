import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LanguageSwitch } from '../../components/LanguageSwitch'
import { ROLE_LABEL } from '../../components/shell/nav'
import { Button, Card, CardHeader, PageHeader, Segmented } from '../../components/ui'
import { useSession, useTheme, type ThemePref } from '../../store'

export function Profile() {
  const user = useSession((s) => s.user)!
  const signOut = useSession((s) => s.signOut)
  const { pref, setPref } = useTheme()
  const { t, i18n } = useTranslation()
  const [notify, setNotify] = useState<'all' | 'critical'>('all')
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={t('profile.eyebrow')} title={t('profile.title')} />
      <Card className="mb-4 flex items-center gap-4 p-5">
        <span className="grid size-14 place-items-center rounded-full bg-teal font-display text-xl font-semibold text-white">{user.name[0]}</span>
        <div>
          <div className="font-display text-xl font-semibold">{user.name}</div>
          <div className="text-sm text-muted">
            {ROLE_LABEL[user.role]} · {user.depot}
            {user.assignedVehicle ? ` · ${user.assignedVehicle}` : ''}
            {user.assignedOutlet ? ` · ${user.assignedOutlet}` : ''}
          </div>
          <div className="text-xs text-faint">{user.email}</div>
        </div>
      </Card>
      <Card>
        <CardHeader title={t('profile.preferences')} />
        <div className="divide-y divide-line">
          <Row label={t('profile.appearance')} hint={user.role === 'DRIVER' ? t('profile.default_dark') : undefined}>
            <Segmented<ThemePref>
              value={pref}
              onChange={setPref}
              options={[
                { value: 'light', label: t('profile.light') },
                { value: 'dark', label: t('profile.dark') },
                { value: 'system', label: t('profile.system') },
              ]}
            />
          </Row>
          <Row label={t('profile.notifications')}>
            <Segmented
              value={notify}
              onChange={setNotify}
              options={[
                { value: 'all', label: t('profile.all') },
                { value: 'critical', label: t('profile.critical') },
              ]}
            />
          </Row>
          <Row label={t('profile.language')} hint={i18n.language !== 'en' ? t('language.draft') : undefined}>
            <LanguageSwitch />
          </Row>
        </div>
      </Card>
      <Button
        variant="secondary"
        className="mt-6"
        icon={<LogOut className="size-4" />}
        onClick={() => {
          signOut()
          navigate('/login')
        }}
      >
        {t('nav.sign_out')}
      </Button>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="max-w-xs text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}
