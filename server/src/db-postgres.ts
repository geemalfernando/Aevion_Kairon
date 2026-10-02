/**
 * Storage on a local PostgreSQL (docker compose): the same model and commit function as the Supabase backend
 * (db-supabase.ts), reached with `pg` instead of the Supabase client.
 */
import pg from 'pg'
import type { OpsData } from '@core/types'
import { config } from './config'
import type { Tx } from './db-supabase'


/**
 * Same tables and commit function as supabase/migrations/202610010001_kairon.sql, without Supabase's roles and
 * row-level security. Idempotent: it runs on every boot.
 */
const SCHEMA = `
create table if not exists kairon_state (
  id integer primary key check (id = 1),
  version bigint not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- One row per field event a device sent, keyed by the device-generated id: replaying an outbox twice is a no-op.
create table if not exists kairon_events (
  id text primary key,
  user_email text not null,
  result text not null,
  message text,
  created_at timestamptz not null default now()
);

-- Proof-of-delivery photos and signatures (base64), kept out of the state document.
create table if not exists kairon_media (
  id text primary key,
  content_type text not null,
  data text not null,
  created_at timestamptz not null default now()
);

-- Snapshot, event receipts and delivery proof are committed atomically.
-- The optimistic version check stops two API instances overwriting each other.
create or replace function kairon_commit(expected_version bigint, next_state jsonb, new_events jsonb default '[]', new_media jsonb default '[]')
returns void language plpgsql as $$
declare current_version bigint;
begin
  perform pg_advisory_xact_lock(781492);
  select version into current_version from kairon_state where id = 1 for update;
  if coalesce(current_version, 0) <> expected_version then
    raise exception 'Operation changed on another device; refresh and retry' using errcode = '40001';
  end if;
  if expected_version is null or (next_state->>'version')::bigint is distinct from expected_version + 1 then
    raise exception 'Invalid operation version';
  end if;
  insert into kairon_events(id, user_email, result, message)
    select id, user_email, result, message from jsonb_to_recordset(new_events) as e(id text, user_email text, result text, message text)
    on conflict (id) do nothing;
  insert into kairon_media(id, content_type, data)
    select id, content_type, data from jsonb_to_recordset(new_media) as m(id text, content_type text, data text)
    on conflict (id) do nothing;
  insert into kairon_state(id, version, data) values (1, expected_version + 1, next_state)
    on conflict (id) do update set version = excluded.version, data = excluded.data, updated_at = now();
end;
$$;
`

let pool: pg.Pool | undefined
let ready: Promise<void> | undefined

function db() {
  if (!config.databaseUrl) throw new Error('Configure DATABASE_URL (local PostgreSQL) or SUPABASE_URL in .env')
  pool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 5 })
  return pool
}

/** Create the tables and the commit function on first use; retries while the database container starts. */
function migrated() {
  ready ??= (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await db().query(SCHEMA)
        return
      } catch (err) {
        if (attempt >= 30) throw err
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  })()
  return ready
}

export async function loadOps(): Promise<OpsData | null> {
  await migrated()
  const r = await db().query('select data from kairon_state where id = 1')
  return (r.rows[0]?.data as OpsData) ?? null
}

export async function persistState(before: OpsData | null, after: OpsData, tx: Tx) {
  await migrated()
  after.version = (before?.version ?? 0) + 1
  try {
    await db().query('select kairon_commit($1, $2, $3, $4)', [before?.version ?? 0, JSON.stringify(after), JSON.stringify(tx.events), JSON.stringify(tx.media)])
  } catch (err) {
    const code = (err as { code?: string }).code
    throw Object.assign(new Error(`Operation was not saved: ${(err as Error).message}`), { statusCode: code === '40001' ? 409 : 503 })
  }
}

export async function seenEvents(ids: string[]) {
  if (!ids.length) return new Set<string>()
  await migrated()
  const r = await db().query('select id from kairon_events where id = any($1)', [ids])
  return new Set(r.rows.map((x) => x.id as string))
}

export async function loadMedia(id: string) {
  await migrated()
  const r = await db().query('select content_type, data from kairon_media where id = $1', [id])
  const m = r.rows[0]
  return m ? { content_type: m.content_type as string, data: Buffer.from(m.data as string, 'base64') } : undefined
}
