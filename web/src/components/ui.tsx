import { Check, Cpu, Eye, EyeOff, FlaskConical, Leaf, Loader2, Shirt, Snowflake, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import type { Brand, OrderStatus, Severity, Temp } from '@core/types'

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'attention' | 'critical'

const toneSoft: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand-soft text-brand-ink',
  info: 'bg-info-soft text-info-ink',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  attention: 'bg-attention-soft text-attention-ink',
  critical: 'bg-critical-soft text-critical-ink',
}
export const toneDot: Record<Tone, string> = {
  neutral: 'bg-faint',
  brand: 'bg-brand',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  attention: 'bg-attention',
  critical: 'bg-critical',
}
export const toneText: Record<Tone, string> = {
  neutral: 'text-muted',
  brand: 'text-brand-ink',
  info: 'text-info-ink',
  success: 'text-success-ink',
  warning: 'text-warning-ink',
  attention: 'text-attention-ink',
  critical: 'text-critical-ink',
}
export const toneBorder: Record<Tone, string> = {
  neutral: 'border-line',
  brand: 'border-brand/40',
  info: 'border-info/40',
  success: 'border-success/40',
  warning: 'border-warning/50',
  attention: 'border-attention/50',
  critical: 'border-critical/50',
}

export const severityTone: Record<Severity, Tone> = { INFO: 'info', WARNING: 'warning', HIGH: 'attention', CRITICAL: 'critical' }

// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'attention' | 'inverse'
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg' | 'xl'
  icon?: ReactNode
  loading?: boolean
  block?: boolean
}

export function Button({ variant = 'primary', size = 'md', icon, loading, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-[background,color,box-shadow,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        {
          primary: 'bg-brand-fill text-on-brand shadow-sm hover:bg-brand-hover',
          secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
          ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
          danger: 'bg-critical-fill text-white hover:brightness-95',
          attention: 'bg-attention-fill text-white hover:brightness-95',
          inverse: 'bg-white text-teal hover:bg-platinum',
        }[variant],
        { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-[15px]', xl: 'h-14 px-6 text-base' }[size],
        block && 'w-full',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...rest} aria-label={label} title={label} className={cn('relative grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink', className)}>
      {children}
    </button>
  )
}

export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 whitespace-nowrap', toneSoft[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', toneDot[tone])} />}
      {children}
    </span>
  )
}

export function SeverityBadge({ s }: { s: Severity }) {
  return (
    <Badge tone={severityTone[s]} dot>
      {s}
    </Badge>
  )
}

/** One status vocabulary for all four roles: the same state has the same word and colour everywhere. */
export const orderStatusTone: Record<OrderStatus, Tone> = {
  CONFIRMED: 'neutral',
  PLANNED: 'brand',
  DEFERRED: 'attention',
  LOADED: 'info',
  IN_TRANSIT: 'info',
  ARRIVED: 'info',
  DELIVERED: 'success',
  PARTIAL: 'attention',
  FAILED: 'critical',
  RECEIVED: 'success',
}

export function StatusBadge({ s }: { s: OrderStatus }) {
  const { t } = useTranslation()
  return (
    <Badge tone={orderStatusTone[s]} dot>
      {t(`status.${s}`)}
    </Badge>
  )
}

const BRAND_ICON: Record<Brand, typeof Leaf> = { Fresh: Leaf, Style: Shirt, Tech: Cpu }

/** Brands are told apart by icon and name — never by colour (team decision). */
export function BrandTag({ brand, className, iconOnly }: { brand: Brand; className?: string; iconOnly?: boolean }) {
  const Icon = BRAND_ICON[brand]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px] font-medium text-muted', className)} title={brand}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {iconOnly ? <span className="sr-only">{brand}</span> : brand}
    </span>
  )
}

/** Chilled goods are always ocean blue with a snowflake. */
export function TempTag({ temp, className }: { temp: Temp; className?: string }) {
  const { t } = useTranslation()
  if (temp !== 'CHILLED') return null
  return (
    <Badge tone="info" className={className}>
      <Snowflake className="size-3" aria-hidden /> {t('temp.chilled')}
    </Badge>
  )
}

/** Marks a value that will come from the Datathon models (placeholder until they're loaded). */
export function ModelChip({ source = 'placeholder', className }: { source?: 'model' | 'placeholder'; className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted', className)} title={source === 'model' ? t('risk.model') : t('risk.placeholder')}>
      <FlaskConical className="size-3" aria-hidden />
      {t('risk.model')}
    </span>
  )
}

export function Card({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <As {...rest} className={cn('rounded-xl border border-line bg-surface shadow-card', className)}>
      {children}
    </As>
  )
}

export function CardHeader({ title, eyebrow, action, className }: { title: ReactNode; eyebrow?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h3 className="truncate text-[15px] font-semibold">{title}</h3>
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, tone = 'neutral', icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {icon && <span className={cn('grid size-7 place-items-center rounded-md', toneSoft[tone])}>{icon}</span>}
      </div>
      <div className={cn('mt-2 font-display text-[28px] font-semibold leading-none tabular-nums', tone !== 'neutral' && toneText[tone])}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </Card>
  )
}

/** Capacity bar: teal while healthy, orange near the limit, red over it. */
export function Meter({ value, max, label, detail, warnAt = 0.9, className }: { value: number; max: number; label?: string; detail?: ReactNode; warnAt?: number; className?: string }) {
  const r = max ? value / max : 0
  const color = r > 1 ? 'bg-critical' : r >= warnAt ? 'bg-attention' : 'bg-brand'
  return (
    <div className={className}>
      {(label || detail) && (
        <div className="mb-1 flex justify-between gap-2 text-xs">
          <span className="text-muted">{label}</span>
          <span className={cn('font-medium tabular-nums', r > 1 && 'text-critical-ink')}>{detail}</span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.min(100, r * 100)}%` }} />
      </div>
    </div>
  )
}

export function CheckRow({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className={cn('grid size-5 shrink-0 place-items-center rounded-full', ok ? 'bg-success-soft text-success-ink' : warn ? 'bg-warning-soft text-warning-ink' : 'bg-critical-soft text-critical-ink')}>
        {ok ? <Check className="size-3" strokeWidth={3} /> : warn ? <span className="text-[11px] font-bold">!</span> : <X className="size-3" strokeWidth={3} />}
      </span>
      <span className="flex-1">{label}</span>
      {detail && <span className="text-right text-xs text-muted tabular-nums">{detail}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function Modal({ open, onClose, title, eyebrow, children, footer, tone, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; children: ReactNode; footer?: ReactNode; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-auto max-h-[92dvh] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/50 backdrop:backdrop-blur-[2px]',
        { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' }[size],
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className={cn('flex items-start justify-between gap-4 border-b border-line px-6 py-5', tone && tone !== 'neutral' && toneSoft[tone])}>
            <div>
              {eyebrow && <div className={cn('eyebrow mb-1', tone && toneText[tone])}>{eyebrow}</div>}
              <h2 className="text-xl font-semibold">{title}</h2>
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="scroll-thin overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/60 px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint transition focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20'

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(inputCls, 'h-11', className)} />
/** Password field with a show/hide toggle, so people can check what they typed on a phone keyboard. */
export function PasswordInput({ className, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input {...p} type={visible ? 'text' : 'password'} className={cn(inputCls, 'h-11 pr-11', className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/20"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cn(inputCls, 'min-h-20 py-2.5', className)} />
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cn(inputCls, 'h-10 pr-8', className)}>
    {children}
  </select>
)

/** Large tappable single-choice list — works with gloves on a phone. */
export function ChoiceList<T extends string>({ options, value, onChange, name, columns = 1 }: { options: { value: T; label: string; hint?: string }[]; value: T | null; onChange: (v: T) => void; name: string; columns?: 1 | 2 }) {
  return (
    <div role="radiogroup" aria-label={name} className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2')}>
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn('flex min-h-12 items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition', on ? 'border-brand bg-brand-soft' : 'border-line-strong hover:bg-surface-2')}
          >
            <span className={cn('grid size-4.5 shrink-0 place-items-center rounded-full border-2', on ? 'border-brand' : 'border-line-strong')}>{on && <span className="size-2 rounded-full bg-brand" />}</span>
            <span>
              <span className="font-medium">{o.label}</span>
              {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn('rounded-md font-medium transition', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-surface-2 text-muted">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Banner used across the degradation language: same shape, severity-coloured. */
export function Callout({ tone = 'info', icon, title, children, action, className }: { tone?: Tone; icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start gap-3 rounded-xl border p-4', toneSoft[tone], toneBorder[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        {children && <div className="mt-0.5 text-sm opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function Timeline({ items }: { items: { label: ReactNode; sub?: ReactNode; state: 'done' | 'current' | 'todo' | 'problem' }[] }) {
  return (
    <ol className="relative">
      {items.map((it, i) => (
        <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 && <span className={cn('absolute left-[9px] top-5 h-[calc(100%-12px)] w-0.5', it.state === 'done' ? 'bg-brand' : 'bg-line')} />}
          <span
            className={cn(
              'relative z-10 mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
              it.state === 'done' && 'border-brand bg-brand-fill text-white',
              it.state === 'current' && 'animate-pulse-dot border-info bg-surface text-info',
              it.state === 'todo' && 'border-line-strong bg-surface',
              it.state === 'problem' && 'border-attention bg-attention-fill text-white',
            )}
          >
            {it.state === 'done' && <Check className="size-3" strokeWidth={3} />}
            {it.state === 'current' && <span className="size-2 rounded-full bg-info" />}
            {it.state === 'problem' && <span className="text-[10px] font-bold">!</span>}
          </span>
          <div className="min-w-0">
            <div className={cn('text-sm', it.state === 'todo' ? 'text-muted' : 'font-medium')}>{it.label}</div>
            {it.sub && <div className="text-xs text-muted">{it.sub}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Logo({ className, mark = true, inverse }: { className?: string; mark?: boolean; inverse?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.12em]', inverse ? 'text-white' : 'text-ink', className)}>
      {mark && (
        <span className="inline-flex h-7 w-10 shrink-0" aria-hidden>
          <img src="/brand/route-logo-dark.svg" alt="" width="680" height="486" className={cn('h-full w-full object-contain', !inverse && 'hidden dark:block')} />
          {!inverse && <img src="/brand/route-logo-light.svg" alt="" width="680" height="486" className="h-full w-full object-contain dark:hidden" />}
        </span>
      )}
      KAIRON
    </span>
  )
}

// ---------------------------------------------------------------------------
// Toasts

interface Toast {
  id: number
  tone: Tone
  title: string
  body?: string
}
const useToasts = create<{ list: Toast[]; push: (t: Omit<Toast, 'id'>) => void; drop: (id: number) => void }>((set, get) => ({
  list: [],
  push(t) {
    const id = Date.now() + Math.random()
    set({ list: [...get().list.slice(-3), { ...t, id }] })
    setTimeout(() => get().drop(id), 4200)
  },
  drop: (id) => set({ list: get().list.filter((t) => t.id !== id) }),
}))
export const toast = (title: string, opts: { tone?: Tone; body?: string } = {}) => useToasts.getState().push({ title, tone: opts.tone ?? 'success', body: opts.body })

export function Toaster() {
  const list = useToasts((s) => s.list)
  const drop = useToasts((s) => s.drop)
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[72px] z-[60] flex flex-col items-center gap-2 px-4 lg:items-end lg:px-6">
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-pop">
          <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', toneDot[t.tone])} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t.title}</div>
            {t.body && <div className="text-xs text-muted">{t.body}</div>}
          </div>
          <button onClick={() => drop(t.id)} className="text-faint hover:text-ink" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
