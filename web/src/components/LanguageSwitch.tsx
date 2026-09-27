import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, type Language } from '../i18n'
import { cn } from './ui'

/** EN · සිං · த — each label is written in its own script so any user can find theirs. */
export function LanguageSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  return (
    <div className={cn('inline-flex items-center gap-1.5', className)} role="radiogroup" aria-label={t('language.label')}>
      {!compact && <Languages className="size-4 text-muted" aria-hidden />}
      <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
        {LANGUAGES.map((lng: Language) => (
          <button
            key={lng}
            type="button"
            role="radio"
            aria-checked={i18n.language === lng}
            lang={lng}
            onClick={() => void i18n.changeLanguage(lng)}
            className={cn('min-w-9 rounded-md px-2 py-1 text-xs font-semibold transition', i18n.language === lng ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
          >
            {t(`language.${lng}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
