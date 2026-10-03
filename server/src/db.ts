/** Storage selected by BACKEND: private RDS/S3, legacy Supabase, or local demo PostgreSQL.
 * All backends keep versioned state and atomic offline-event receipts through kairon_commit.
 */
import { config } from './config'
import * as local from './db-postgres'
import * as hosted from './db-supabase'
import * as rds from './db-rds'

export type { StoredEvent, StoredMedia, Tx } from './db-supabase'
export { transaction } from './db-supabase'

const store = () => (config.backend === 'rds' ? rds : config.backend === 'supabase' ? hosted : local)

export const loadOps: typeof hosted.loadOps = () => store().loadOps()
export const persistState: typeof hosted.persistState = (before, after, tx) => store().persistState(before, after, tx)
export const seenEvents: typeof hosted.seenEvents = (ids) => store().seenEvents(ids)
export const loadMedia: typeof hosted.loadMedia = (id) => store().loadMedia(id)
