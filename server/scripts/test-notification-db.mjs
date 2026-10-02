import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

// Isolated synthetic PostgreSQL; never connects to DATABASE_URL or the configured Supabase project.
const container = `kairon-notification-test-${process.pid}`
function docker(args, input) {
  return spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120000 })
}
function sql(input) {
  const result = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input)
  assert.equal(result.status, 0, result.stderr || result.error?.message)
}
const start = docker(['run', '--rm', '--detach', '--name', container, '-e', 'POSTGRES_PASSWORD=kairon-test-only', 'postgres:16-alpine'])
assert.equal(start.status, 0, start.stderr)
try {
  let ready = false
  for (let i = 0; i < 30; i++) {
    if (docker(['exec', container, 'pg_isready', '-U', 'postgres']).status === 0) { ready = true; break }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  assert.ok(ready, 'Test PostgreSQL did not become ready')
  sql(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, deleted_at timestamptz, banned_until timestamptz);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz);`)
  sql(readFileSync(new URL('../../supabase/migrations/202610010001_kairon.sql', import.meta.url), 'utf8'))
  const migration = readFileSync(new URL('../../supabase/migrations/202610020001_notifications_security.sql', import.meta.url), 'utf8')
  sql(migration)
  sql(migration) // Repeat application must preserve the state function and permissions.
  sql(`select public.kairon_commit(0, '{"version":1,"notifications":[{"id":"n-1","depot":"Peliyagoda","to":["DRIVER"]}],"audit":[{"id":"a-1","userId":"u-1"}]}');
    do $$ begin
      if (select count(*) from public.kairon_notification_outbox) <> 1 then raise exception 'Missing atomic notification'; end if;
      if (select count(*) from public.kairon_operational_audit) <> 1 then raise exception 'Missing durable audit'; end if;
      begin
        perform public.kairon_commit(1, '{"version":2,"notifications":[{"depot":"Peliyagoda","to":["DRIVER"]}],"audit":[]}');
        raise exception 'Expected invalid outbox insert to roll back';
      exception when not_null_violation then null;
      end;
      if (select version from public.kairon_state where id=1) <> 1 then raise exception 'State escaped outbox rollback'; end if;
      if (select count(*) from public.kairon_notification_outbox) <> 1 then raise exception 'Outbox escaped rollback'; end if;
    end $$;
    select public.kairon_commit(1, '{"version":2,"notifications":[{"id":"n-1","depot":"Peliyagoda","to":["DRIVER"]}],"audit":[{"id":"a-1"}]}');
    do $$ begin
      if (select count(*) from public.kairon_notification_outbox) <> 1 then raise exception 'Duplicate notification'; end if;
      if (select count(*) from public.kairon_claim_outbox('publisher-a')) <> 1 then raise exception 'Publisher could not claim'; end if;
      if (select count(*) from public.kairon_claim_outbox('publisher-b')) <> 0 then raise exception 'Concurrent publisher stole lease'; end if;
      update public.kairon_notification_outbox set lease_until = now() - interval '1 second';
      if (select count(*) from public.kairon_claim_outbox('publisher-b')) <> 1 then raise exception 'Expired publisher lease not recovered'; end if;
      if not public.kairon_claim_delivery('d-1','n-1','u-1','push','worker-a') then raise exception 'Missing delivery claim'; end if;
      if public.kairon_claim_delivery('d-1','n-1','u-1','push','worker-b') then raise exception 'Concurrent worker stole lease'; end if;
      update public.kairon_notification_deliveries set status='sent', lease_until=null;
      if public.kairon_claim_delivery('d-1','n-1','u-1','push','worker-b') then raise exception 'Completed delivery resent'; end if;
    end $$;
    insert into auth.users(id,email,raw_app_meta_data) values ('00000000-0000-0000-0000-000000000001','test@example.test','{"role":"DRIVER","depot":"Peliyagoda","name":"Test"}');
    insert into auth.sessions(id,user_id) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
    do $$ begin
      if public.kairon_session_identity('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001')->'app_metadata'->>'role' <> 'DRIVER' then raise exception 'Active identity missing'; end if;
      update auth.users set raw_app_meta_data='{"role":"LOADER"}';
      if public.kairon_session_identity('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001')->'app_metadata'->>'role' <> 'LOADER' then raise exception 'Stale metadata'; end if;
      delete from auth.sessions;
      if public.kairon_session_identity('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001') is not null then raise exception 'Revoked session accepted'; end if;
    end $$;`)
  for (const input of ['set role authenticated; select * from public.kairon_contacts;', "set role anon; select public.kairon_claim_outbox('attacker');", "set role authenticated; select public.kairon_session_identity(null,null);"]) {
    const result = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input)
    assert.notEqual(result.status, 0, 'Unprivileged database access was allowed')
    assert.match(result.stderr, /permission denied/)
  }
  console.log('PostgreSQL checks passed: atomic rollback, audit, idempotency, publisher/worker leases, fresh/revoked identity and restricted DB access.')
} finally {
  const cleanup = docker(['rm', '--force', container])
  assert.equal(cleanup.status, 0, cleanup.stderr)
}
