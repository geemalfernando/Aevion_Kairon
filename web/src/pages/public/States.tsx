import { ExternalLink, Monitor, Moon, Smartphone, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Card, Logo } from '../../components/ui'
import { PRESETS, type Preset } from '../../demo/presets'

const PHONE: Preset['role'][] = ['DRIVER', 'LOADER']

/** Every screen state, one link each — for judges' deep links and for importing frames into Figma (html.to.design). */
export function States() {
  const groups = ['Dispatcher', 'Loader', 'Driver', 'Store manager'] as const
  const url = (p: Preset, extra = '') => `${p.path}${p.path.includes('?') ? '&' : '?'}demo=${p.id}${extra}`
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/">
            <Logo />
          </Link>
          <Link to="/login" className="text-sm font-semibold text-brand-ink">
            Open the live app →
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="eyebrow">Design review</div>
        <h1 className="mt-1 text-3xl font-semibold">Screen states</h1>
        <p className="mt-2 max-w-3xl text-muted">
          Each link opens one screen in one state of the Waypoint delivery day, built by running the real planning rules on a sandboxed copy of the operation. Nothing is saved. Add <code className="rounded bg-surface-2 px-1">frame=1</code> to hide presenter
          chrome for Figma import; drivers and loaders are designed for 390 × 844, everything else for 1440 × 900.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Badge tone="attention">
            <TriangleAlert className="size-3" /> Degradation screen
          </Badge>
          <Badge>
            <Smartphone className="size-3" /> Phone frame
          </Badge>
          <Badge>
            <Monitor className="size-3" /> Desktop frame
          </Badge>
        </div>

        {groups.map((g) => (
          <section key={g} className="mt-10">
            <h2 className="mb-3 text-lg font-semibold">{g}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {PRESETS.filter((p) => p.group === g).map((p) => {
                const phone = PHONE.includes(p.role)
                return (
                  <Card key={p.id} className={p.degradation ? 'border-attention/60' : ''}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold">{p.title}</div>
                        {p.degradation && (
                          <Badge tone="attention">
                            <TriangleAlert className="size-3" /> Degradation
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted">{p.note}</p>
                      <div className="mt-2 font-mono text-[11px] text-faint">{url(p)}</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 border-t border-line bg-surface-2/60 px-4 py-3 text-xs font-semibold">
                      <a className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 hover:border-brand" href={url(p)} target="_blank" rel="noreferrer">
                        Open <ExternalLink className="size-3" />
                      </a>
                      <a className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 hover:border-brand" href={url(p, '&frame=1')} target="_blank" rel="noreferrer">
                        {phone ? <Smartphone className="size-3" /> : <Monitor className="size-3" />} Figma frame
                      </a>
                      {p.role === 'DRIVER' ? (
                        <a className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 hover:border-brand" href={url(p, '&frame=1&theme=light')} target="_blank" rel="noreferrer">
                          Light
                        </a>
                      ) : (
                        <a className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 hover:border-brand" href={url(p, '&frame=1&theme=dark')} target="_blank" rel="noreferrer">
                          <Moon className="size-3" /> Dark
                        </a>
                      )}
                      {phone && (
                        <>
                          <a lang="si" className="rounded-md border border-line bg-surface px-2 py-1 hover:border-brand" href={url(p, '&frame=1&lang=si')} target="_blank" rel="noreferrer">
                            සිං
                          </a>
                          <a lang="ta" className="rounded-md border border-line bg-surface px-2 py-1 hover:border-brand" href={url(p, '&frame=1&lang=ta')} target="_blank" rel="noreferrer">
                            த
                          </a>
                        </>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
