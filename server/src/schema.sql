-- Kairon data model. Idempotent: safe to run on every boot.
--
-- Reference tables mirror the competition CSVs column for column (outlets.csv, vehicles.csv, calendar.csv,
-- district_travel.csv, service_allowance.csv). Operational tables keep typed columns for querying and
-- reporting plus a `doc` JSONB column with the full domain object, so the shared core can evolve without
-- a migration for every nested field.

create table if not exists app_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- Reference data ----------

create table if not exists outlets (
  outlet_id text primary key,
  brand text not null check (brand in ('Fresh', 'Style', 'Tech')),
  district text not null,
  depot text not null check (depot in ('Peliyagoda', 'Kandy')),
  dock_type text not null check (dock_type in ('rear_dock', 'street', 'mall_bay')),
  parking_constraint text not null check (parking_constraint in ('normal', 'van_only', 'mall_dock')),
  mall_window text not null default '',
  window_open_time text not null,
  window_close_time text not null,
  doc jsonb not null
);

create table if not exists vehicles (
  vehicle_id text primary key,
  type text not null check (type in ('truck', 'van')),
  temp text not null check (temp in ('reefer', 'ambient')),
  weight_cap_kg numeric not null,
  volume_cap_m3 numeric not null,
  fuel_type text not null,
  km_per_l numeric not null,
  weekly_fuel_quota_l numeric not null,
  depot text not null,
  status text not null,
  reserve boolean not null default false,
  doc jsonb not null
);

create table if not exists district_travel (
  district text primary key,
  depot text not null,
  road_class text not null,
  free_flow_kmh numeric not null,
  depot_to_district_km numeric not null,
  depot_to_district_freeflow_min numeric not null,
  inter_stop_km numeric not null,
  inter_stop_freeflow_min numeric not null
);

create table if not exists service_allowance (
  brand text not null,
  dock_type text not null,
  service_allowance_min numeric not null,
  primary key (brand, dock_type)
);

create table if not exists calendar (
  date date primary key,
  dow int not null,
  dow_name text not null,
  is_weekend int not null,
  iso_year int not null,
  iso_week int not null,
  is_payday int not null,
  festival text not null default '',
  festival_ramp numeric not null default 0,
  is_holiday int not null,
  monsoon int not null,
  is_operating int not null
);

-- ---------- Operation ----------

create table if not exists orders (
  id text primary key,
  outlet_id text not null references outlets (outlet_id),
  brand text not null,
  temp text not null check (temp in ('CHILLED', 'AMBIENT')),
  delivery_date date not null,
  status text not null,
  trip_id text,
  priority int not null,
  units int not null,
  volume_m3 numeric not null,
  weight_kg numeric not null,
  doc jsonb not null
);
create index if not exists orders_day_status on orders (delivery_date, status);
create index if not exists orders_outlet on orders (outlet_id);

create table if not exists trips (
  id text primary key,
  vehicle_id text not null references vehicles (vehicle_id),
  number int not null,
  brand text not null,
  district text not null,
  departure_min int not null,
  status text not null,
  doc jsonb not null
);
create index if not exists trips_vehicle on trips (vehicle_id);

create table if not exists issues (
  id text primary key,
  kind text not null,
  severity text not null,
  created_at timestamptz not null,
  resolved boolean not null default false,
  doc jsonb not null
);

create table if not exists notifications (
  id text primary key,
  at timestamptz not null,
  doc jsonb not null
);

create table if not exists audit_events (
  id text primary key,
  entity text not null,
  at timestamptz not null,
  actor text not null,
  text text not null
);
create index if not exists audit_entity on audit_events (entity, at);

create table if not exists sync_reports (
  id text primary key,
  email text not null,
  synced_at timestamptz not null,
  doc jsonb not null
);

-- Every field event a device sent, keyed by the device-generated id: replaying the same outbox twice is a no-op.
create table if not exists field_events (
  id text primary key,
  user_email text not null,
  actor text not null,
  type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  result text not null,
  message text
);
create index if not exists field_events_user on field_events (user_email, received_at);

create table if not exists users (
  email text primary key,
  name text not null,
  role text not null check (role in ('DISPATCHER', 'LOADER', 'DRIVER', 'STORE_MANAGER')),
  depot text not null,
  assigned_vehicle text,
  assigned_outlet text,
  password_hash text not null
);

-- Proof-of-delivery photos and signatures, stored outside the order document.
create table if not exists media (
  id text primary key,
  order_id text,
  kind text not null,
  content_type text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
