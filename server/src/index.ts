import { buildApp } from './app'
import { config } from './config'
const { app, op } = await buildApp()
try {
  await op.init()
  await app.listen({ port: config.port, host: config.host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => { await app.close(); process.exit(0) })
}
