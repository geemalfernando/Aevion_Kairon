import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import webpush from 'web-push'
import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { config } from '../config'
import type { Subscription } from './store'

const ses = new SESv2Client({ maxAttempts: 1, requestHandler: { connectionTimeout: 10000, requestTimeout: 30000 } })
const sns = new SNSClient({ maxAttempts: 1, requestHandler: { connectionTimeout: 10000, requestTimeout: 30000 } })
export const genericMessage = 'You have a delivery update. Open Kairon to view it.'
export function safeError(error: unknown) {
  const e = error as { name?: string; statusCode?: number; $metadata?: { httpStatusCode?: number } }
  return `${String(e?.name ?? 'DeliveryError').replace(/[^A-Za-z0-9_]/g, '').slice(0, 60)}:${e?.statusCode ?? e?.$metadata?.httpStatusCode ?? 0}`
}
export async function sendPush(subscription: Subscription, id: string) {
  const result = await webpush.sendNotification(subscription, JSON.stringify({ title: 'Kairon', body: genericMessage, url: '/login', tag: id }), { TTL: 600, timeout: 15_000, vapidDetails: { subject: config.vapidSubject, publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey } })
  return String(result.statusCode)
}
export async function sendNativePush(token: string, id: string) {
  const app = getApps().find((app) => app.name === 'kairon-notifications') ?? initializeApp({ credential: cert(JSON.parse(config.firebaseServiceAccount)) }, 'kairon-notifications')
  try {
    return await getMessaging(app).send({ token, notification: { title: 'Kairon', body: genericMessage }, data: { url: '/login', notificationId: id }, android: { ttl: 600000, collapseKey: 'kairon-update' }, apns: { headers: { 'apns-expiration': String(Math.floor(Date.now() / 1000) + 600), 'apns-collapse-id': 'kairon-update' } } })
  } catch (error) {
    if (['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes((error as { code?: string }).code ?? '')) throw Object.assign(new Error('InvalidFcmToken'), { statusCode: 410 })
    throw error
  }
}
export async function sendEmail(email: string) {
  const result = await ses.send(new SendEmailCommand({ FromEmailAddress: config.sesFromEmail, Destination: { ToAddresses: [email] }, ConfigurationSetName: config.sesConfigurationSet || undefined,
    Content: { Simple: { Subject: { Data: 'Kairon delivery update', Charset: 'UTF-8' }, Body: { Text: { Data: `${genericMessage}\n${config.publicApiUrl}/login\n\nManage notification preferences in your Kairon profile.`, Charset: 'UTF-8' } } } } }))
  return result.MessageId ?? ''
}
export async function sendSms(phone: string) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('InvalidVerifiedPhone')
  const result = await sns.send(new PublishCommand({ PhoneNumber: phone, Message: `Kairon: ${genericMessage} ${config.publicApiUrl}/login`, MessageAttributes: { 'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' }, ...(config.smsSenderId ? { 'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: config.smsSenderId } } : {}) } }))
  return result.MessageId ?? ''
}
