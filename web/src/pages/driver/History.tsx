import { useTranslation } from 'react-i18next'
import { AuditTimeline } from '../../components/AuditTimeline'
import { Card, PageHeader } from '../../components/ui'
import { useView } from '../../store'

export function History() {
  const d = useView()
  const { t } = useTranslation()
  const events = d.audit.filter((e) => e.actor === 'DRIVER').sort((a, b) => a.at - b.at)
  return (
    <>
      <PageHeader title={t('driver.history.title')} />
      <Card className="p-5">
        <AuditTimeline events={events.map((e) => ({ ...e, text: `${e.entity} · ${e.text}` }))} empty={t('driver.history.empty')} />
      </Card>
    </>
  )
}
