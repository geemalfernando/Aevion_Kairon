import crypto from 'node:crypto'
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs'
import type { Notification } from '@core/types'
import { config, validateDeployment } from '../config'
import * as repository from './repository'
import { closeRds } from '../rds'
import { profile } from '../auth'
import { deliver, eligible, type DeliveryPort } from './delivery'
import { decrypt, type Subscription } from './store'
import { sendEmail, sendPush, sendNativePush, sendSms } from './providers'

validateDeployment()
if (!['supabase','rds'].includes(config.backend) || !config.notificationQueueUrl || ![config.webPushEnabled, config.fcmEnabled, config.emailEnabled, config.smsEnabled].some(Boolean)) throw new Error('Worker requires a hosted database, a queue and at least one configured channel')
const sqs = new SQSClient({ maxAttempts: 2 })
const owner = crypto.randomUUID()
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })

async function processNotification(id: string) {
  const row = await repository.readOutbox(id)
  if (!row || Date.parse(row.expires_at) <= Date.now()) return
  const n = row.payload as Notification
  if (!n.depot || !Array.isArray(n.to)) throw new Error('InvalidNotification')
  let failed = false
  for (let offset = 0; ; offset += 100) {
    const recipients = await repository.recipients(n.depot,n.to,offset)
    for (const contact of recipients) {
      let current
      try { current = await repository.identity(contact.user_id) } catch { failed = true; continue }
      if (!current) continue
      const user = profile(current.email, current.app_metadata)
      const preferences = contact.preferences
      if (!user || !eligible(n, user, preferences)) continue
      const port: DeliveryPort = {
        claim: (deliveryId, channel) => repository.claimDelivery(deliveryId,id,contact.user_id,channel,owner),
        status: repository.deliveryStatus,
        finish: (deliveryId,status,code) => repository.finishDelivery(deliveryId,owner,status,code),
      }
      const jobs: (() => Promise<void>)[] = []
      if (config.emailEnabled && preferences.email && current.email_confirmed_at && !contact.suppressed_email) jobs.push(() => deliver(`${id}:${contact.user_id}:email`, 'email', () => sendEmail(user.email), port))
      const encryptedPhone = contact.encrypted_phone
      if (config.smsEnabled && preferences.sms && ['HIGH', 'CRITICAL'].includes(n.severity) && encryptedPhone) jobs.push(() => deliver(`${id}:${contact.user_id}:sms`, 'sms', () => sendSms(decrypt<string>(encryptedPhone!)), port))
      if ((config.webPushEnabled || config.fcmEnabled) && preferences.push) {
        const devices = await repository.devices(contact.user_id)
        for (const device of devices ?? []) {
          if (device.kind === 'fcm' ? !config.fcmEnabled : !config.webPushEnabled) continue
          jobs.push(() => deliver(`${id}:${contact.user_id}:push:${device.id}`, 'push', () => device.kind === 'fcm' ? sendNativePush(decrypt<{ token: string }>(device.encrypted_subscription).token, id) : sendPush(decrypt<Subscription>(device.encrypted_subscription), id), port, async () => {
          await repository.removeDevice(contact.user_id,device.id)
        }))
        }
      }
      const results = await Promise.allSettled(jobs.map((job) => job()))
      if (results.some((result) => result.status === 'rejected')) failed = true
    }
    if ((recipients?.length ?? 0) < 100) break
  }
  if (failed) throw new Error('SomeDeliveriesFailed')
}

async function processFeedback(value: { TopicArn?: string; Type?: string; Message?: string }) {
  if (!config.sesFeedbackTopicArn || value.TopicArn !== config.sesFeedbackTopicArn || value.Type !== 'Notification' || typeof value.Message !== 'string') throw new Error('UntrustedFeedback')
  const event = JSON.parse(value.Message) as { eventType?: string; notificationType?: string; bounce?: { bounceType?: string; bouncedRecipients?: { emailAddress: string }[] }; complaint?: { complainedRecipients?: { emailAddress: string }[] } }
  const type = event.eventType ?? event.notificationType
  const recipients = type === 'Complaint' ? event.complaint?.complainedRecipients : type === 'Bounce' && event.bounce?.bounceType === 'Permanent' ? event.bounce.bouncedRecipients : []
  for (const recipient of recipients ?? []) {
    await repository.suppressEmail(recipient.emailAddress)
  }
}

while (!stopping) {
  try {
    const result = await sqs.send(new ReceiveMessageCommand({ QueueUrl: config.notificationQueueUrl, WaitTimeSeconds: 20, MaxNumberOfMessages: 1, VisibilityTimeout: 120, MessageSystemAttributeNames: ['ApproximateReceiveCount'] }))
    for (const message of result.Messages ?? []) {
      if (stopping || !message.ReceiptHandle) break
      // A large recipient list can take longer than one visibility window. Keep this receipt leased.
      let extending = false
      let leaseFailed = false
      const heartbeat = setInterval(() => {
        if (extending) return
        extending = true
        void sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: config.notificationQueueUrl, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: 120 })).catch(() => { leaseFailed = true }).finally(() => { extending = false })
      }, 30_000)
      try {
        const payload = JSON.parse(message.Body ?? '{}') as { notificationId?: string; TopicArn?: string; Type?: string; Message?: string }
        if (payload.TopicArn) await processFeedback(payload)
        else {
          if (typeof payload.notificationId !== 'string' || payload.notificationId.length > 200) throw new Error('InvalidQueueMessage')
          await processNotification(payload.notificationId)
        }
        if (leaseFailed) throw new Error('QueueLeaseLost')
        await sqs.send(new DeleteMessageCommand({ QueueUrl: config.notificationQueueUrl, ReceiptHandle: message.ReceiptHandle }))
      } catch {
        console.error('Notification delivery attempt failed; SQS will retry or move it to the DLQ')
        const count = Number(message.Attributes?.ApproximateReceiveCount ?? 1)
        await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: config.notificationQueueUrl, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: Math.min(900, 30 * 2 ** Math.min(count, 5)) })).catch(() => undefined)
      } finally { clearInterval(heartbeat) }
    }
  } catch {
    console.error('Notification worker queue unavailable')
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

await closeRds()
