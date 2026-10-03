import fs from 'node:fs'
import path from 'node:path'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { Redis } from 'ioredis'
import { projectState } from '@core/access'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyRequest } from 'fastify'
import type { DemandForecastRow, ServicePredictionRow } from '@core/csv'
import { byId } from '@core/rules'
import type { QueuedEvent } from '@core/types'
import { login, logout, refreshSession, verifyToken, type Session } from './auth'
import { config, validateDeployment } from './config'
import { HttpError, Operation } from './operation'
import { publicSummary } from '@core/summary'
import { signProofs, verifyMedia } from './media-access'
import { contacts, registerPush, registerNativePush, securityAudit, subscriptionId, type Preferences } from './notifications/store'
import { closeRds } from './rds'
import { removeDevice, hasVerifiedPhone } from './notifications/repository'

export async function buildApp() {
  validateDeployment()
  const app = Fastify({ logger: { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'], serializers: { req: (req) => ({ method: req.method, url: req.url?.split('?')[0] }) } }, bodyLimit: 12 * 1024 * 1024, trustProxy: (_address, hop) => hop < config.trustProxy })
  await app.register(cors, { origin: config.webOrigins, credentials: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Mode'] })
  await app.register(cookie)
  const redis = config.redisUrl ? new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) : undefined
  redis?.on('error', () => app.log.warn('Rate-limit Redis unavailable'))
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute', redis, skipOnError: false, hook: 'preHandler' })
  app.addHook('onClose', async () => { redis?.disconnect(); if(config.backend==='rds') await closeRds() })
  const op = new Operation(app.log)
  const streams = new Set<import('node:http').ServerResponse>()
  app.addHook('preClose', async () => { for (const stream of streams) stream.end() })
  const view = (user: Session) => signProofs(projectState(op.data, user))
  const cookieMode = (req: FastifyRequest) => req.headers['x-session-mode'] === 'cookie' || !!req.headers.origin && !['https://localhost', 'capacitor://localhost'].includes(req.headers.origin)
  const originGuard = (req: FastifyRequest) => { if (!req.headers.origin || !config.webOrigins.includes(req.headers.origin)) throw new HttpError(403, 'Untrusted request origin') }
  const sessionResponse = (req: FastifyRequest, reply: import('fastify').FastifyReply, session: NonNullable<Awaited<ReturnType<typeof login>>>) => {
    if (!cookieMode(req)) return session
    reply.setCookie(config.sessionCookieName, session.refreshToken, { httpOnly: true, secure: ['staging', 'production'].includes(config.deploymentEnv) || !!process.env.VERCEL, sameSite: 'strict', path: '/api/auth', maxAge: 30 * 86400 })
    return { ...session, refreshToken: null }
  }

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY')
    reply.header('permissions-policy', 'camera=(self), microphone=(), geolocation=(self)')
    reply.header('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; font-src 'self'; connect-src 'self' https://tile.openstreetmap.org; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
    if (['staging', 'production'].includes(config.deploymentEnv)) reply.header('strict-transport-security', 'max-age=31536000')
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store')
  })

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err instanceof HttpError ? err.status : (err.statusCode ?? 500)
    if (status >= 500) req.log.error(err)
    reply.status(status).send({ error: status >= 500 ? 'Something went wrong on the server' : err.message })
  })

  const auth = async (req: FastifyRequest): Promise<Session> => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
    const s = await verifyToken(token)
    if (!s) throw new HttpError(401, 'Sign in again')
    return s
  }

  // ---------- Health & auth ----------

  app.get('/api/health', async () => ({ ok: true, version: op.data?.version ?? 0, demoMode: config.demoMode, dataSources: op.sources }))

  /** Landing page figures for visitors who are not signed in: aggregates only (see core/src/summary.ts). */
  app.get('/api/public/summary', async (_req, reply) => {
    await op.reload()
    reply.header('cache-control', 'public, max-age=30')
    return publicSummary(op.data)
  })

  app.post('/api/auth/login', { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (cookieMode(req)) originGuard(req)
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string }
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) throw new HttpError(400, 'Email and password are required')
    if (email.length > 254 || password.length > 1024) throw new HttpError(400, 'Invalid sign-in details')
    if (redis) {
      const key = `kairon:login:${(await import('node:crypto')).createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`
      const attempts = Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, key))
      if (attempts > 10) throw new HttpError(429, 'Too many sign-in attempts; try again shortly')
    }
    const r = await login(email, password)
    if (!r) { await securityAudit('login', undefined, 'denied'); throw new HttpError(401, 'That email and password don’t match an account') }
    const user = await verifyToken(r.token)
    if (!user) throw new HttpError(401, 'Sign in again')
    await contacts(user)
    await securityAudit('login', user.id)
    return sessionResponse(req, reply, r)
  })

  app.post('/api/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (cookieMode(req)) originGuard(req)
    const refreshToken = cookieMode(req) ? req.cookies[config.sessionCookieName] : (req.body as { refreshToken?: string } | undefined)?.refreshToken
    if (typeof refreshToken !== 'string' || !refreshToken) throw new HttpError(400, 'Refresh token required')
    const session = await refreshSession(refreshToken)
    if (!session) throw new HttpError(401, 'Sign in again')
    const expectedEmail = (req.body as { expectedEmail?: string } | undefined)?.expectedEmail
    if (expectedEmail && session.user.email !== expectedEmail) throw new HttpError(401, 'This tab belongs to another account; sign in again')
    return sessionResponse(req, reply, session)
  })

  app.post('/api/auth/logout', async (req, reply) => {
    if (cookieMode(req)) originGuard(req)
    let token = req.headers.authorization?.replace(/^Bearer /, '')
    let user = await verifyToken(token)
    if (!user && req.cookies[config.sessionCookieName]) {
      const renewed = await refreshSession(req.cookies[config.sessionCookieName]!)
      token = renewed?.token
      user = await verifyToken(token)
    }
    if (user && token) {
      await logout(token)
      if (config.backend !== 'postgres') await removeDevice(user.id)
      await securityAudit('logout', user.id)
    }
    reply.clearCookie(config.sessionCookieName, { path: '/api/auth' })
    return { ok: true }
  })

  app.get('/api/auth/me', async (req) => auth(req))

  // ---------- Operation ----------

  app.get('/api/state', async (req) => {
    const user = await auth(req)
    await op.reload()
    op.touch(user)
    return { version: op.data.version, data: view(user) }
  })

  app.post('/api/commands/:name', async (req) => {
    const user = await auth(req)
    const { name } = req.params as { name: string }
    const { args } = (req.body ?? {}) as { args?: unknown[] }
    await op.reload()
    const result = await op.command(user, name, Array.isArray(args) ? args : [])
    return { result, version: op.data.version, data: view(user) }
  })

  app.post('/api/events', async (req) => {
    const user = await auth(req)
    const { events, sync } = (req.body ?? {}) as { events?: QueuedEvent[]; sync?: { offlineFrom?: number; routeChanged?: boolean } }
    const results = await op.events(user, events ?? [], sync)
    return { results, version: op.data.version, data: view(user) }
  })

  /** Server-sent events: every device learns about a new version within a second. */
  app.get('/api/stream', async (req, reply) => {
    const user = await auth(req)
    reply.hijack()
    const res = reply.raw
    streams.add(res)
    for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) res.setHeader(name, value)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    const send = (version: number) => res.write(`event: version\ndata: ${JSON.stringify({ version })}\n\n`)
    res.write('retry: 3000\n\n')
    send(op.data.version)
    op.touch(user)
    let last = op.data.version
    const off = op.subscribe((v) => {
      last = v
      send(v)
    })
    const ping = setInterval(() => {
      op.touch(user)
      res.write(': ping\n\n')
      void verifyToken(req.headers.authorization?.slice(7)).then((current) => {
        if (!current || JSON.stringify([current.role, current.depot, current.assignedVehicle, current.assignedOutlet]) !== JSON.stringify([user.role, user.depot, user.assignedVehicle, user.assignedOutlet])) res.end()
      }).catch(() => res.end())
    }, 20_000)
    // Other instances (serverless, or several API machines) commit without notifying this one, so poll the version.
    const poll = setInterval(() => {
      op.reload().then(
        () => op.data.version !== last && send((last = op.data.version)),
        (err: unknown) => req.log.warn(err, 'stream reload failed'),
      )
    }, 3000)
    // Serverless functions have a time limit; end cleanly first and let EventSource reconnect.
    // An open connection must not outlive the verified access token.
    const remaining = Math.max(1, user.exp - Date.now())
    const limit = setTimeout(() => res.end(), config.streamMaxMs ? Math.min(config.streamMaxMs, remaining) : remaining)
    res.on('close', () => {
      streams.delete(res)
      clearInterval(ping)
      clearInterval(poll)
      clearTimeout(limit)
      off()
    })
  })

  /** Demo mode only: put the seeded delivery day back so a judge can run the walkthrough again. */
  app.post('/api/demo/reset', async (req) => {
    const user = await auth(req)
    if (user.role !== 'DISPATCHER') throw new HttpError(403, 'Only the dispatcher can reset the demo')
    await op.resetDemo()
    return { version: op.data.version, data: view(user) }
  })

  // ---------- Datathon outputs ----------

  /** Load Datathon model outputs (submission_task1 rows and Task 2A rows joined with their depot/brand/week). */
  app.post('/api/predictions', async (req) => {
    const user = await auth(req)
    const { service, demand, source } = (req.body ?? {}) as { service?: ServicePredictionRow[]; demand?: DemandForecastRow[]; source?: string }
    const byDelivery = Object.fromEntries((service ?? []).map((r) => [r.delivery_id, { pred_service_min: Number(r.pred_service_min), pred_late_prob: Math.min(1, Math.max(0, Number(r.pred_late_prob))) }]))
    await op.command(user, 'loadPredictions', [{ service: byDelivery, demand: demand ?? [], source: source ?? 'Datathon model' }])
    return { service: Object.keys(byDelivery).length, demand: demand?.length ?? 0 }
  })

  /** The current plan in the Task 2B submission shape (served/deferred, vehicle, trip). */
  app.get('/api/export/allocation.csv', async (req, reply) => {
    const user = await auth(req)
    if (user.role !== 'DISPATCHER') throw new HttpError(403, 'Only dispatchers can export allocations')
    await op.reload()
    const d = view(user)
    const rows = d.orders
      .filter((o) => o.deliveryDate === d.deliveryDate)
      .map((o) => {
        const t = byId(d.trips, o.tripId)
        return [d.deliveryDate, o.id, o.outletId, t ? 'served' : 'deferred', t?.vehicleId ?? '', t?.number ?? ''].join(',')
      })
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="allocation-${d.deliveryDate}.csv"`)
    return ['scenario,order_ref,outlet_id,decision,vehicle_id,trip_id', ...rows].join('\n')
  })

  // ---------- Media (proof of delivery) ----------

  // Signed URLs are issued only while projecting an authorized user's orders; they expire in ten minutes.
  app.get('/api/media/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, 'Not found')
    const query = req.query as { order?: string; expires?: string; signature?: string }
    if (!verifyMedia(id, query.order, query.expires, query.signature)) throw new HttpError(403, 'Proof link expired or invalid')
    const m = await op.media(id)
    if (!m) throw new HttpError(404, 'Not found')
    reply.header('content-type', m.content_type).header('cache-control', 'private, no-store')
    return m.data
  })

  app.get('/api/notifications/preferences', async (req) => ({ preferences: await contacts(await auth(req)), channels: { push: config.webPushEnabled, nativePush: config.fcmEnabled, email: config.emailEnabled, sms: config.smsEnabled }, publicKey: config.webPushEnabled ? config.vapidPublicKey : null }))
  app.post('/api/notifications/preferences', async (req) => {
    const user = await auth(req)
    const p = req.body as Preferences
    if (!p || Object.keys(p).some((key) => !['push', 'email', 'sms', 'criticalOnly'].includes(key)) || ['push', 'email', 'sms', 'criticalOnly'].some((key) => typeof p[key as keyof Preferences] !== 'boolean')) throw new HttpError(400, 'Invalid notification preferences')
    if (p.sms && config.backend !== 'postgres' && !await hasVerifiedPhone(user.id)) throw new HttpError(400, 'Ask an administrator to verify your phone first')
    await securityAudit('notification_preferences', user.id)
    return { preferences: await contacts(user, p) }
  })
  app.post('/api/notifications/push', async (req) => {
    if (!config.webPushEnabled) throw new HttpError(503, 'Push is not configured')
    const user = await auth(req)
    await registerPush(user, req.body)
    await securityAudit('push_registered', user.id)
    return { ok: true }
  })
  app.post('/api/notifications/push/remove', async (req) => {
    const user = await auth(req)
    const endpoint = (req.body as { endpoint?: string })?.endpoint
    if (typeof endpoint !== 'string') throw new HttpError(400, 'Endpoint required')
    if (config.backend !== 'postgres') await removeDevice(user.id,subscriptionId(endpoint))
    return { ok: true }
  })
  app.post('/api/notifications/native-push', async (req) => {
    if (!config.fcmEnabled) throw new HttpError(503, 'Native push is not configured')
    const user = await auth(req)
    await registerNativePush(user, (req.body as { token?: string })?.token)
    await securityAudit('native_push_registered', user.id)
    return { ok: true }
  })

  // ---------- Web app ----------

  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false, index: ['index.html'] })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html')
      reply.status(404).send({ error: 'Not found' })
    })
  } else {
    app.log.warn(`No web build at ${config.webDist} — serving the API only`)
  }

  return { app, op }
}
