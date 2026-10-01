-- Run once in the Supabase SQL Editor after 202610010001_kairon.sql.
-- Private bucket for photos. No anon/authenticated policies are added, so like the
-- kairon_* tables it is reachable only through the API (service_role) or the dashboard.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kairon-photos', 'kairon-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
commit;
