import crypto from 'node:crypto'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { config, validateDeployment } from '../config'
import { supabaseAdmin } from '../supabase'

validateDeployment()
if (config.backend !== 'supabase' || !config.notificationQueueUrl) throw new Error('Publisher requires Supabase and NOTIFICATION_QUEUE_URL')
const sqs = new SQSClient({ maxAttempts: 2 })
const owner = crypto.randomUUID()
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })
while (!stopping) {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.rpc('kairon_claim_outbox', { owner, batch_size: 10 })
    if (error) throw new Error('OutboxClaimFailed')
    for (const row of data ?? []) {
      if (stopping) break
      await sqs.send(new SendMessageCommand({ QueueUrl: config.notificationQueueUrl, MessageBody: JSON.stringify({ notificationId: row.id }) }))
      const { error: markError } = await db.from('kairon_notification_outbox').update({ published_at: new Date().toISOString(), lease_until: null, lease_owner: null }).eq('id', row.id).eq('lease_owner', owner)
      if (markError) throw new Error('OutboxAcknowledgeFailed')
    }
  } catch {
    console.error('Notification publisher attempt failed; leased rows will retry')
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, config.notificationPollMs))
}
