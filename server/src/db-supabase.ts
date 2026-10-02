/** Storage on Supabase (the hosted deployment): one versioned state row, event receipts and delivery proof. */
import type { OpsData } from '@core/types'
import { supabaseAdmin } from './supabase'

export interface StoredEvent { id: string; user_email: string; result: string; message?: string }
export interface StoredMedia { id: string; content_type: string; data: string }
export interface Tx { events: StoredEvent[]; media: StoredMedia[] }
export const transaction = (): Tx => ({ events: [], media: [] })
export async function loadOps(): Promise<OpsData | null> {
  const { data, error } = await supabaseAdmin().from('kairon_state').select('data').eq('id', 1).maybeSingle()
  if (error) throw new Error(`Cannot load operation. Run supabase/migrations/202610010001_kairon.sql in the SQL Editor. ${error.message}`)
  return data?.data as OpsData ?? null
}
export async function persistState(before: OpsData | null, after: OpsData, tx: Tx) {
  after.version = (before?.version ?? 0) + 1
  const { error } = await supabaseAdmin().rpc('kairon_commit', { expected_version: before?.version ?? 0, next_state: after, new_events: tx.events, new_media: tx.media })
  if (error) throw Object.assign(new Error(`Operation was not saved: ${error.message}`), { statusCode: error.code === '40001' ? 409 : 503 })
}
export async function seenEvents(ids: string[]) {
  if (!ids.length) return new Set<string>()
  const { data, error } = await supabaseAdmin().from('kairon_events').select('id').in('id', ids)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.id as string))
}
export async function loadMedia(id: string) {
  const { data, error } = await supabaseAdmin().from('kairon_media').select('content_type,data').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? { content_type: data.content_type as string, data: Buffer.from(data.data as string, 'base64') } : undefined
}
