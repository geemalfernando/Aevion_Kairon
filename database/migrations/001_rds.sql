-- RDS PostgreSQL: run with the dedicated migration task, never the runtime role.
begin;
create table if not exists public.kairon_users (
 id uuid primary key,
 email text not null unique check (email = lower(email)),
 password_hash text not null,
 app_metadata jsonb not null,
 disabled boolean not null default false,
 email_verified boolean not null default false,
 created_at timestamptz not null default now(),
 check (app_metadata->>'role' in ('DISPATCHER','LOADER','DRIVER','STORE_MANAGER')),
 check (app_metadata->>'depot' in ('Peliyagoda','Kandy')),
 check (length(app_metadata->>'name') > 0)
);
create table if not exists public.kairon_sessions (
 id uuid primary key,
 user_id uuid not null references public.kairon_users(id),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.kairon_refresh_tokens (
 token_hash text primary key,
 session_id uuid not null references public.kairon_sessions(id),
 used_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists kairon_sessions_user on public.kairon_sessions(user_id);
create index if not exists kairon_refresh_session on public.kairon_refresh_tokens(session_id);
create table if not exists public.kairon_schema_migrations(version text primary key, applied_at timestamptz not null default now());
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
  data text,
  object_key text,
  created_at timestamptz not null default now()
);
-- Snapshot, offline-event receipts and delivery proof are committed atomically.
-- Optimistic version check prevents multiple API instances overwriting each other.
create or replace function public.kairon_commit_state(expected_version bigint, next_state jsonb, new_events jsonb default '[]', new_media jsonb default '[]')
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
  insert into public.kairon_media(id, content_type, data, object_key)
    select id, content_type, data, object_key from jsonb_to_recordset(new_media) as m(id text, content_type text, data text, object_key text);
  insert into public.kairon_state(id, version, data) values (1, expected_version + 1, next_state)
    on conflict (id) do update set version = excluded.version, data = excluded.data, updated_at = now();
end;
$$;
create table if not exists public.kairon_contacts (
  user_id text primary key,
  email text not null,
  role text not null check (role in ('DISPATCHER', 'LOADER', 'DRIVER', 'STORE_MANAGER')),
  depot text not null check (depot in ('Peliyagoda', 'Kandy')),
  assigned_vehicle text,
  assigned_outlet text,
  -- Administrators set encrypted_phone ONLY after verifying ownership/consent; clients cannot set a number.
  encrypted_phone text,
  suppressed_email boolean not null default false,
  preferences jsonb not null default '{"push":false,"email":false,"sms":false,"criticalOnly":false}'
);
create table if not exists public.kairon_push_devices (
  id text primary key,
  user_id text not null references public.kairon_contacts(user_id) on delete cascade,
  encrypted_subscription text not null,
  kind text not null default 'web' check (kind in ('web','fcm')),
  updated_at timestamptz not null default now()
);
create table if not exists public.kairon_notification_outbox (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  published_at timestamptz,
  lease_until timestamptz,
  lease_owner text,
  attempts integer not null default 0
);
create index if not exists kairon_outbox_pending on public.kairon_notification_outbox(created_at) where published_at is null;
create table if not exists public.kairon_notification_deliveries (
  id text primary key,
  notification_id text not null references public.kairon_notification_outbox(id),
  user_id text not null,
  channel text not null check (channel in ('push','email','sms')),
  status text not null check (status in ('sending','sent','skipped','failed')),
  attempts integer not null default 0,
  lease_until timestamptz,
  lease_owner text,
  provider_id text,
  error_code text,
  updated_at timestamptz not null default now()
);
create table if not exists public.kairon_security_audit (
  id bigint generated always as identity primary key,
  user_id text,
  action text not null,
  outcome text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.kairon_operational_audit (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
do $$ begin
 if to_regprocedure('public.kairon_commit_state(bigint,jsonb,jsonb,jsonb)') is null then
  alter function public.kairon_commit(bigint,jsonb,jsonb,jsonb) rename to kairon_commit_state;
 end if;
end $$;
create or replace function public.kairon_commit(expected_version bigint, next_state jsonb, new_events jsonb default '[]', new_media jsonb default '[]')
returns void language plpgsql set search_path = '' as $$
declare prior jsonb;
begin
  perform pg_advisory_xact_lock(781492);
  select data into prior from public.kairon_state where id = 1 for update;
  perform public.kairon_commit_state(expected_version, next_state, new_events, new_media);
  insert into public.kairon_notification_outbox(id, payload)
    select n->>'id', n from jsonb_array_elements(coalesce(next_state->'notifications', '[]')) n
    where not exists (select 1 from jsonb_array_elements(coalesce(prior->'notifications', '[]')) old where old->>'id' = n->>'id')
      and n->>'depot' in ('Peliyagoda','Kandy')
    on conflict (id) do nothing;
  insert into public.kairon_operational_audit(id, data)
    select a->>'id', a from jsonb_array_elements(coalesce(next_state->'audit', '[]')) a
    where not exists (select 1 from jsonb_array_elements(coalesce(prior->'audit', '[]')) old where old->>'id' = a->>'id')
    on conflict (id) do nothing;
end $$;

create or replace function public.kairon_claim_outbox(owner text, batch_size integer default 20)
returns setof public.kairon_notification_outbox language sql set search_path = '' as $$
  update public.kairon_notification_outbox set lease_until = now() + interval '60 seconds', lease_owner = owner, attempts = attempts + 1
  where id in (
    select id from public.kairon_notification_outbox
    where published_at is null and expires_at > now() and (lease_until is null or lease_until < now())
    order by created_at for update skip locked limit greatest(1, least(batch_size, 100))
  ) returning *;
$$;

create or replace function public.kairon_claim_delivery(delivery_id text, notification text, recipient text, delivery_channel text, owner text)
returns boolean language plpgsql set search_path = '' as $$
declare claimed text;
begin
  insert into public.kairon_notification_deliveries(id, notification_id, user_id, channel, status, attempts, lease_until, lease_owner)
  values (delivery_id, notification, recipient, delivery_channel, 'sending', 1, now() + interval '90 seconds', owner)
  on conflict (id) do update set status = 'sending', attempts = public.kairon_notification_deliveries.attempts + 1,
    lease_until = now() + interval '90 seconds', lease_owner = owner, updated_at = now()
  where public.kairon_notification_deliveries.status not in ('sent','skipped')
    and (public.kairon_notification_deliveries.lease_until is null or public.kairon_notification_deliveries.lease_until < now())
  returning id into claimed;
  return claimed is not null;
end $$;

insert into public.kairon_schema_migrations(version) values ('001_rds') on conflict do nothing;
commit;
