import { buildApp } from './app'
import { config } from './config'
import { migrate, pool, waitForDb } from './db'

const { app, op } = await buildApp()

try {
  await waitForDb((m) => app.log.warn(m))
  await migrate()
  await op.init(config.reseedOnBoot)
  await app.listen({ port: config.port, host: config.host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received — shutting down`)
    await app.close()
    await pool.end()
    process.exit(0)
  })
}
