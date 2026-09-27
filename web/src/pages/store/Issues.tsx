import { MessageSquareWarning } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, EmptyState, PageHeader, SeverityBadge } from '../../components/ui'
import { timeAgo } from '@core/time'
import { storeOrders } from '../../lib/select'
import { useSession, useView } from '../../store'
import { ReportIssueModal } from './shared'

export function Issues() {
  const d = useView()
  const user = useSession((s) => s.user)!
  const mine = new Set(storeOrders(d, user.assignedOutlet).map((o) => o.id))
  const issues = d.issues.filter((i) => i.orderIds?.some((id) => mine.has(id)) && (i.kind === 'STORE_ISSUE' || i.kind === 'DELIVERY_FAILED'))
  const reportable = storeOrders(d, user.assignedOutlet).find((o) => ['DELIVERED', 'PARTIAL', 'RECEIVED', 'FAILED'].includes(o.status))
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Issues"
        actions={
          reportable && (
            <Button icon={<MessageSquareWarning className="size-4" />} onClick={() => setOpen(true)}>
              Report delivery issue
            </Button>
          )
        }
      />
      {issues.length === 0 ? (
        <Card>
          <EmptyState icon={<MessageSquareWarning className="size-5" />} title="No reported issues" body="Missing, damaged or wrong goods can be reported from any delivered order." />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {issues.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <SeverityBadge s={i.severity} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{i.title}</div>
                <div className="text-sm text-muted">{i.detail}</div>
              </div>
              {i.resolved ? <Badge tone="success">{i.resolved.decision}</Badge> : <Badge tone="warning">With dispatcher</Badge>}
              <span className="text-xs text-faint">{timeAgo(i.createdAt, Date.now())}</span>
            </div>
          ))}
        </Card>
      )}
      <ReportIssueModal o={reportable} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
