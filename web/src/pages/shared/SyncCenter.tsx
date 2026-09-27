import { Check, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { describeEvent } from '@core/ops'
import { fmtClock, timeAgo } from '@core/time'
import { Badge, Button, Callout, Card, CardHeader, EmptyState, PageHeader } from '../../components/ui'
import { useDevice, useNetwork, useView } from '../../store'

/** The device outbox, in plain words — no mention of IndexedDB or queues. */
export function SyncCenter() {
  const net = useNetwork()
  const retry = useDevice((s) => s.retry)
  const sync = useDevice((s) => s.sync)
  const d = useView()
  const { t } = useTranslation()
  const failed = net.queue.filter((q) => q.status === 'failed')
  const total = net.queue.length
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow={t('sync_center.eyebrow')} title={t('sync_center.title')} subtitle={net.lastSync ? t('sync_center.last', { time: fmtClock(net.lastSync), ago: timeAgo(net.lastSync, Date.now()) }) : t('sync_center.first')} />

      {net.status === 'offline' && (
        <Callout tone="neutral" icon={<CloudOff className="size-5" />} title={t('sync_center.offline_title')} className="mb-4">
          {t('sync_center.offline_body', { count: net.pending })}
        </Callout>
      )}
      {net.status === 'syncing' && (
        <Callout tone="info" icon={<RefreshCw className="size-5 animate-spin" />} title={t('sync_center.syncing')} className="mb-4">
          {t('sync_center.sending', { count: net.pending })}
        </Callout>
      )}
      {failed.length > 0 && net.status !== 'syncing' && (
        <Callout
          tone="critical"
          icon={<TriangleAlert className="size-5" />}
          title={t('sync_center.attention')}
          className="mb-4"
          action={
            net.online && (
              <Button size="sm" onClick={() => retry()}>
                {t('sync_center.retry_all')}
              </Button>
            )
          }
        >
          {t('sync_center.failed', { count: failed.length })}
        </Callout>
      )}

      <Card>
        <CardHeader
          title={t('sync_center.waiting')}
          eyebrow={t('sync.queued', { count: total })}
          action={
            net.online &&
            net.pending > 0 && (
              <Button size="sm" variant="secondary" onClick={() => sync()}>
                {t('sync_center.sync_now')}
              </Button>
            )
          }
        />
        {total === 0 ? (
          <EmptyState icon={<Check className="size-5" />} title={t('sync_center.all_done')} body={net.lastSync ? t('sync.last_sync', { time: fmtClock(net.lastSync) }) : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {net.queue.map((q) => (
              <li key={q.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className={`grid size-6 place-items-center rounded-full ${q.status === 'failed' ? 'bg-critical-soft text-critical-ink' : 'bg-surface-2 text-muted'}`}>
                  {q.status === 'failed' ? <TriangleAlert className="size-3.5" /> : <Check className="size-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{describeEvent(q.event, d)}</div>
                  <div className="text-xs text-muted">{q.status === 'failed' ? t('sync_center.upload_failed', { error: q.error }) : t('sync_center.saved_at', { time: fmtClock(q.at) })}</div>
                </div>
                {q.status === 'failed' ? (
                  <Button size="sm" variant="secondary" disabled={!net.online} onClick={() => retry(q.id)}>
                    {t('common.retry')}
                  </Button>
                ) : (
                  <Badge>{net.online ? t('sync_center.sending_badge') : t('sync_center.waiting_badge')}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
