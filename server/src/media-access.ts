import crypto from 'node:crypto'
import type { OpsData } from '@core/types'
import { config } from './config'

const fallback = crypto.randomBytes(32).toString('hex')
function signature(id: string, order: string, expires: string) {
  return crypto.createHmac('sha256', config.mediaSigningKey || config.authSecret || fallback).update(`${id}:${order}:${expires}`).digest('base64url')
}
export function signedMedia(id: string, order: string, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + 600)
  return `${config.publicApiUrl}/api/media/${id}?order=${encodeURIComponent(order)}&expires=${expires}&signature=${signature(id, order, expires)}`
}
export function verifyMedia(id: string, order: unknown, expires: unknown, sig: unknown, now = Date.now()) {
  if (typeof order !== 'string' || typeof expires !== 'string' || typeof sig !== 'string' || !/^\d+$/.test(expires) || Number(expires) <= now / 1000 || Number(expires) > now / 1000 + 601) return false
  const expected = Buffer.from(signature(id, order, expires))
  const supplied = Buffer.from(sig)
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}
export function signProofs(d: OpsData) {
  const sign = (value: string | undefined, order: string) => {
    const id = value?.match(/\/api\/media\/([a-f0-9]{32})(?:\?|$)/)?.[1]
    return id ? signedMedia(id, order) : undefined
  }
  for (const order of d.orders) {
    if (order.delivery) {
      order.delivery.photo = sign(order.delivery.photo, order.id)
      order.delivery.signature = sign(order.delivery.signature, order.id)
    }
  }
  return d
}
