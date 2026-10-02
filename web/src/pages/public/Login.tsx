import { Copyright } from '../../components/Copyright'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { DEMO_PASSWORD, DEMO_USERS } from '@core/demo'
import type { Role } from '@core/types'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { isStandalone } from '../../components/Pwa'
import { HOME, ROLE_LABEL } from '../../components/shell/nav'
import { Button, Callout, Field, Input, Logo, PasswordInput } from '../../components/ui'
import { DEMO } from '../../demo/mode'
import { signInWith, useSession } from '../../store'

export function Login() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = useSession((s) => s.user)
  const navigate = useNavigate()

  const signIn = async (email: string, password: string) => {
    setBusy(true)
    setError('')
    try {
      const user = await signInWith(email, password)
      navigate(HOME[user.role])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in')
    } finally { setBusy(false) }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void signIn(email, password)
  }

  // The installed app opens on /login; send signed-in people straight to work.
  if (current && isStandalone() && !params.get('role')) return <Navigate to={HOME[current.role]} replace />

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-[#0a1315] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-32 top-1/3 size-[480px] rounded-full bg-teal/40 blur-[120px]" />
        <Link to="/" className="relative">
          <Logo inverse />
        </Link>
        <div className="relative mt-auto">
          <h2 className="text-4xl font-bold leading-tight">
            One shared operation.
            <br />
            <span className="text-[#5fd0cf]">Four ways to see it.</span>
          </h2>
          <ul className="mt-8 space-y-3 text-white/70">
            <li>Dispatcher sees control.</li>
            <li>Loader sees what to prepare.</li>
            <li>Driver sees what to do next.</li>
            <li>Store manager sees what is happening to their order.</li>
          </ul>
        </div>
      </aside>

      <main className="flex flex-col px-4 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Back
          </Link>
          <Logo className="lg:hidden" />
        </div>
        <div className="mx-auto my-auto w-full max-w-md py-10">
          <h1 className="text-3xl font-bold">Welcome back</h1>
          <p className="mt-1 text-muted">Sign in to your Kairon workspace.</p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.lk" required />}</Field>
            <Field label="Password">{(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />}</Field>
            {error && <Callout tone="critical" title="Couldn’t sign you in">{error}</Callout>}
            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {DEMO && (
            <>
              <div className="my-8 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                <span className="h-px flex-1 bg-line" /> Demo accounts <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(DEMO_USERS) as Role[]).map((r) => (
                  <button key={r} disabled={busy} onClick={() => void signIn(DEMO_USERS[r].email, DEMO_PASSWORD)} className="group flex items-center gap-3 rounded-xl border border-line p-3 text-left transition hover:border-brand hover:bg-brand-soft">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
                      <span className="block truncate text-xs text-muted">{DEMO_USERS[r].email}</span>
                    </span>
                    <ArrowRight className="size-4 text-faint group-hover:text-brand-ink" />
                  </button>
                ))}
              </div>
              <p className="mt-4 text-center text-xs text-muted">
                Password for every demo account: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{DEMO_PASSWORD}</code>
              </p>
            </>
          )}
        </div>
        <footer className="text-center text-xs text-muted">
          <Copyright />
        </footer>
      </main>
    </div>
  )
}
