/** Run with migration/administrator DB credentials inside the VPC; password arrives on stdin. */
import { readFileSync } from 'node:fs'
import { storeDemoUsers } from '@core/demo'
import type { OpsData } from '@core/types'
import { config } from '../src/config'
import { closeRds, rdsTransaction } from '../src/rds'
import { provisionUsers } from './rds-users'

if (config.backend !== 'rds' || config.deploymentEnv !== 'staging') throw new Error('Store demo accounts are only provisioned for RDS staging')
const password = readFileSync(0, 'utf8').trim()
try {
  await rdsTransaction(async db => {
    const result = await db.query('select data from public.kairon_state where id=1')
    const data = result.rows[0]?.data as OpsData | undefined
    if (!data) throw new Error('Import the operation before provisioning store accounts')
    const users = storeDemoUsers(data.outlets)
    if (users.length !== 3) throw new Error('The operation must contain Fresh, Style and Tech outlets')
    await provisionUsers(db, users.map(user => ({ ...user, password })))
    for (const user of users) console.log(`${user.email} → ${user.assignedOutlet} (${user.depot}); existing accounts are preserved`)
  })
} finally { await closeRds() }
