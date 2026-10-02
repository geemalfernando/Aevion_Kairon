import fs from 'node:fs'
import path from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyRequest } from 'fastify'
import type { DemandForecastRow, ServicePredictionRow } from '@core/csv'
import { byId } from '@core/rules'
import type { QueuedEvent } from '@core/types'
import { login, refreshSession, verifyToken, type Session } from './auth'
import { config } from './config'
import { HttpError, Operation } from './operation'

export async function buildApp() {
  const app = Fastify({ logger: { level: config.logLevel, redact: ['req.headers.authorization'], serializers: { req: (req) => ({ method: req.method, url: req.url?.split('?')[0] }) } }, bodyLimit: 12 * 1024 * 1024, trustProxy: true })
  await app.register(cors, { origin: config.webOrigins, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] })
  const op = new Operation(app.log)

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err instanceof HttpError ? err.status : (err.statusCode ?? 500)
    if (status >= 500) req.log.error(err)
    reply.status(status).send({ error: status >= 500 ? 'Something went wrong on the server' : err.message })
  })

  const auth = async (req: FastifyRequest): Promise<Session> => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query as { token?: string }).token
    const s = await verifyToken(token)
    if (!s) throw new HttpError(401, 'Sign in again')
    return s
  }

  // ---------- Health & auth ----------

  app.get('/api/health', async () => ({ ok: true, version: op.data?.version ?? 0, demoMode: config.demoMode, dataSources: op.sources }))

  app.post('/api/auth/login', async (req) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string }
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) throw new HttpError(400, 'Email and password are required')
    const r = await login(email, password)
    if (!r) throw new HttpError(401, 'That email and password don’t match an account')
    return r
  })

  app.post('/api/auth/refresh', async (req) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string }
    if (typeof refreshToken !== 'string' || !refreshToken) throw new HttpError(400, 'Refresh token required')
    const session = await refreshSession(refreshToken)
    if (!session) throw new HttpError(401, 'Sign in again')
    return session
  })

  app.get('/api/auth/me', async (req) => auth(req))

  // ---------- Operation ----------

  app.get('/api/state', async (req) => {
    const user = await auth(req)
    await op.reload()
    op.touch(user)
    return { version: op.data.version, data: op.data }
  })

  app.post('/api/commands/:name', async (req) => {
    const user = await auth(req)
    const { name } = req.params as { name: string }
    const { args } = (req.body ?? {}) as { args?: unknown[] }
    await op.reload()
    const result = await op.command(user, name, Array.isArray(args) ? args : [])
    return { result, version: op.data.version, data: op.data }
  })

  app.post('/api/events', async (req) => {
    const user = await auth(req)
    const { events, sync } = (req.body ?? {}) as { events?: QueuedEvent[]; sync?: { offlineFrom?: number; routeChanged?: boolean } }
    const results = await op.events(user, events ?? [], sync)
    return { results, version: op.data.version, data: op.data }
  })

  /** Server-sent events: every device learns about a new version within a second. */
  app.get('/api/stream', async (req, reply) => {
    const user = await auth(req)
    reply.hijack()
    const res = reply.raw
    for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) res.setHeader(name, value)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' })
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
    }, 20_000)
    // Other instances (serverless, or several API machines) commit without notifying this one, so poll the version.
    const poll = setInterval(() => {
      op.reload().then(
        () => op.data.version !== last && send((last = op.data.version)),
        (err: unknown) => req.log.warn(err, 'stream reload failed'),
      )
    }, 3000)
    // Serverless functions have a time limit; end cleanly first and let EventSource reconnect.
    const limit = config.streamMaxMs ? setTimeout(() => res.end(), config.streamMaxMs) : undefined
    req.raw.on('close', () => {
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
    return { version: op.data.version, data: op.data }
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
    await auth(req)
    const d = op.data
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

  // Media ids are 128-bit random capability URLs, so <img> tags can load them without a header.
  app.get('/api/media/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, 'Not found')
    const m = await op.media(id)
    if (!m) throw new HttpError(404, 'Not found')
    reply.header('content-type', m.content_type).header('cache-control', 'private, max-age=31536000, immutable')
    return m.data
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
