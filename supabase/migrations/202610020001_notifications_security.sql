-- Apply after 202610010002. Atomic outbox, delivery leases and administrator-owned recipients.
begin;
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
do $$
declare tab text;
begin
  foreach tab in array array['kairon_contacts','kairon_push_devices','kairon_notification_outbox','kairon_notification_deliveries','kairon_security_audit','kairon_operational_audit'] loop
    execute format('alter table public.%I enable row level security', tab);
    execute format('revoke all on public.%I from anon, authenticated', tab);
    execute format('grant all on public.%I to service_role', tab);
  end loop;
  if to_regprocedure('public.kairon_commit_state(bigint,jsonb,jsonb,jsonb)') is null then
    alter function public.kairon_commit(bigint,jsonb,jsonb,jsonb) rename to kairon_commit_state;
  end if;
end $$;
grant usage, select on sequence public.kairon_security_audit_id_seq to service_role;

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
revoke all on function public.kairon_commit(bigint,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.kairon_commit_state(bigint,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.kairon_claim_outbox(text,integer) from public, anon, authenticated;
revoke all on function public.kairon_claim_delivery(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.kairon_commit(bigint,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.kairon_commit_state(bigint,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.kairon_claim_outbox(text,integer) to service_role;
grant execute on function public.kairon_claim_delivery(text,text,text,text,text) to service_role;

-- Fresh administrator metadata and active-session checks prevent revoked/changed JWT claims being reused.
create or replace function public.kairon_session_identity(session_id uuid, subject uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('email', u.email, 'app_metadata', u.raw_app_meta_data)
  from auth.users u join auth.sessions s on s.user_id = u.id
  where u.id = subject and s.id = session_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and (s.not_after is null or s.not_after > now());
$$;
revoke all on function public.kairon_session_identity(uuid,uuid) from public, anon, authenticated;
grant execute on function public.kairon_session_identity(uuid,uuid) to service_role;
commit;
