-- Run once in the Supabase SQL Editor. No demo records or Auth users are inserted.
begin;
create table if not exists public.kairon_state (
  id integer primary key check (id = 1),
  version bigint not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.kairon_events (
  id text primary key,
  user_email text not null,
  result text not null,
  message text,
  created_at timestamptz not null default now()
);
create table if not exists public.kairon_media (
  id text primary key,
  content_type text not null,
  data text not null,
  created_at timestamptz not null default now()
);
alter table public.kairon_state enable row level security;
alter table public.kairon_events enable row level security;
alter table public.kairon_media enable row level security;
revoke all on public.kairon_state, public.kairon_events, public.kairon_media from anon, authenticated;
grant all on public.kairon_state, public.kairon_events, public.kairon_media to service_role;

-- Snapshot, offline-event receipts and delivery proof are committed atomically.
-- Optimistic version check prevents multiple API instances overwriting each other.
create or replace function public.kairon_commit(expected_version bigint, next_state jsonb, new_events jsonb default '[]', new_media jsonb default '[]')
returns void language plpgsql set search_path = '' as $$
declare current_version bigint;
begin
  perform pg_advisory_xact_lock(781492);
  select version into current_version from public.kairon_state where id = 1 for update;
  if coalesce(current_version, 0) <> expected_version then
    raise exception 'Operation changed on another device; refresh and retry' using errcode = '40001';
  end if;
  if expected_version is null or (next_state->>'version')::bigint is distinct from expected_version + 1 then
    raise exception 'Invalid operation version';
  end if;
  insert into public.kairon_events(id, user_email, result, message)
    select id, user_email, result, message from jsonb_to_recordset(new_events) as e(id text, user_email text, result text, message text);
  insert into public.kairon_media(id, content_type, data)
    select id, content_type, data from jsonb_to_recordset(new_media) as m(id text, content_type text, data text);
  insert into public.kairon_state(id, version, data) values (1, expected_version + 1, next_state)
    on conflict (id) do update set version = excluded.version, data = excluded.data, updated_at = now();
end;
$$;
revoke all on function public.kairon_commit(bigint, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kairon_commit(bigint, jsonb, jsonb, jsonb) to service_role;
commit;
