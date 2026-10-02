/**
 * Storage, chosen by configuration: Supabase for the hosted deployment (SUPABASE_URL set), or a local PostgreSQL for
 * `docker compose up` (DATABASE_URL). Both keep the same model: one versioned state row, event receipts and delivery
 * proof, committed atomically by `kairon_commit`.
 */
import { config } from './config'
import * as local from './db-postgres'
import * as hosted from './db-supabase'

export type { StoredEvent, StoredMedia, Tx } from './db-supabase'
export { transaction } from './db-supabase'

const store = () => (config.backend === 'supabase' ? hosted : local)

export const loadOps: typeof hosted.loadOps = () => store().loadOps()
export const persistState: typeof hosted.persistState = (before, after, tx) => store().persistState(before, after, tx)
export const seenEvents: typeof hosted.seenEvents = (ids) => store().seenEvents(ids)
export const loadMedia: typeof hosted.loadMedia = (id) => store().loadMedia(id)
