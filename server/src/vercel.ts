/** Vercel serverless entry: the same Fastify app, handed Node's request/response instead of listening on a port. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildApp } from './app'

const ready = buildApp().then(async ({ app, op }) => {
  await op.init()
  await app.ready()
  return app
})

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await ready
  app.server.emit('request', req, res)
}
