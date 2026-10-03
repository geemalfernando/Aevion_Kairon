import crypto from 'node:crypto'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { config, validateDeployment } from '../config'
import { claimOutbox, ackOutbox } from './repository'
import { closeRds } from '../rds'

validateDeployment()
if (!['supabase','rds'].includes(config.backend) || !config.notificationQueueUrl) throw new Error('Publisher requires a hosted database and NOTIFICATION_QUEUE_URL')
const sqs = new SQSClient({ maxAttempts: 2 })
const owner = crypto.randomUUID()
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })
while (!stopping) {
  try {
    const data = await claimOutbox(owner)
    for (const row of data ?? []) {
      if (stopping) break
      await sqs.send(new SendMessageCommand({ QueueUrl: config.notificationQueueUrl, MessageBody: JSON.stringify({ notificationId: row.id }) }))
      await ackOutbox(row.id, owner)
    }
  } catch {
    console.error('Notification publisher attempt failed; leased rows will retry')
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, config.notificationPollMs))
}

await closeRds()
