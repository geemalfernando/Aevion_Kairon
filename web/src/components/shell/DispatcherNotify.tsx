import { useState, type FormEvent } from 'react'
import type { DispatcherNotice, User } from '@core/types'
import { ops, PREVIEW, saveCommand, useView } from '../../store'
import { Button, Field, Input, Select, Textarea, toast } from '../ui'

/** Compose inside the existing notification drawer; delivery uses the normal inbox/outbox. */
export function DispatcherNotify({ user }: { user: User }) {
  const d = useView()
  const [open, setOpen] = useState(false)
  const [audience, setAudience] = useState<DispatcherNotice['audience']>('ALL')
  const [targetId, setTargetId] = useState('')
  const [severity, setSeverity] = useState<DispatcherNotice['severity']>('INFO')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const message: DispatcherNotice = { audience, targetId: targetId || undefined, depot: user.depot, severity, title, body }
    try {
      if (PREVIEW) ops('notifyUsers', message)
      else await saveCommand('notifyUsers', message)
      toast(PREVIEW ? 'Preview notification created' : 'Notification sent', { body: `Available in the selected users’ notification inbox.` })
      setTitle('')
      setBody('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send notification')
    } finally { setBusy(false) }
  }
  return (
    <div className="border-b border-line px-5 py-4">
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>{open ? 'Cancel message' : 'Notify users'}</Button>
      {open && <form onSubmit={submit} className="mt-4 space-y-3">
        <p className="text-xs text-muted">Send to users at {user.depot}.</p>
        <Field label="Audience">{id => <Select id={id} value={audience} onChange={e => { setAudience(e.target.value as DispatcherNotice['audience']); setTargetId('') }}>
          <option value="ALL">Loaders, drivers and stores</option><option value="LOADER">Loaders</option><option value="DRIVER">Drivers</option><option value="STORE_MANAGER">Stores</option>
        </Select>}</Field>
        {['DRIVER', 'STORE_MANAGER'].includes(audience) && <Field label="Recipient">{id => <Select id={id} value={targetId} onChange={e => setTargetId(e.target.value)}>
          <option value="">All {audience === 'DRIVER' ? 'drivers' : 'stores'}</option>
          {audience === 'DRIVER' ? d.vehicles.filter(v => v.depot === user.depot).map(v => <option key={v.id} value={v.id}>{v.id} · {v.driver}</option>) : d.outlets.filter(o => o.depot === user.depot).map(o => <option key={o.id} value={o.id}>{o.id} · {o.name}</option>)}
        </Select>}</Field>}
        <Field label="Priority">{id => <Select id={id} value={severity} onChange={e => setSeverity(e.target.value as DispatcherNotice['severity'])}>
          <option value="INFO">Info</option><option value="WARNING">Warning</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option>
        </Select>}</Field>
        <Field label="Title">{id => <Input id={id} required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} />}</Field>
        <Field label="Message">{id => <Textarea id={id} required maxLength={2000} value={body} onChange={e => setBody(e.target.value)} />}</Field>
        {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        <Button type="submit" size="sm" disabled={busy || !title.trim() || !body.trim()}>{busy ? 'Sending…' : 'Send notification'}</Button>
      </form>}
    </div>
  )
}
