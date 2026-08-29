-- Phase 1: User & Permission
-- Roles (7), site-scoped multi-site access, permission matrix (module x
-- View/Create/Edit/Approve/Reject/Delete), custom JWT claims (app_role +
-- site_ids), RLS on every table here, and a generic audit-log trigger
-- wired onto every table in this migration.

create type app_role as enum (
  'ADMIN', 'MANAGEMENT', 'PLANNING', 'PURCHASING', 'WAREHOUSE', 'QC', 'SALES'
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- sites (minimal here; Location Master in Phase 2 expands on this)
-- ---------------------------------------------------------------------
create table sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sites_set_updated_at
  before update on sites
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- user_profiles: one row per auth.users, created automatically on signup
-- with role = null / status = PENDING until an ADMIN assigns a role.
-- ---------------------------------------------------------------------
create table user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role app_role,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_set_updated_at
  before update on user_profiles
  for each row execute function set_updated_at();

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------
-- user_sites: which sites a user may access (multi-site support)
-- ---------------------------------------------------------------------
create table user_sites (
  user_id uuid not null references user_profiles (id) on delete cascade,
  site_id uuid not null references sites (id) on delete cascade,
  is_default boolean not null default false,
  primary key (user_id, site_id)
);

-- ---------------------------------------------------------------------
-- role_permissions: View/Create/Edit/Approve/Reject/Delete per module.
-- Seeded below with a safe default (ADMIN = full access, everyone else
-- = view-only) — this is a starting point, not a finished business
-- decision; refine per role with the real approval workflow owners.
-- ---------------------------------------------------------------------
create table role_permissions (
  role app_role not null,
  module text not null check (module in (
    'dashboard', 'forecast', 'planning', 'purchase_orders', 'receiving',
    'iqc', 'wip_stock', 'fg_inspection', 'oqc', 'fg_stock', 'sales_orders',
    'allocation', 'picking', 'shipping', 'traceability', 'reports',
    'master_data', 'users_permissions'
  )),
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_approve boolean not null default false,
  can_reject boolean not null default false,
  can_delete boolean not null default false,
  primary key (role, module)
);

insert into role_permissions (role, module, can_view, can_create, can_edit, can_approve, can_reject, can_delete)
select
  r,
  m,
  true,
  (r = 'ADMIN'),
  (r = 'ADMIN'),
  (r = 'ADMIN'),
  (r = 'ADMIN'),
  (r = 'ADMIN')
from unnest(enum_range(null::app_role)) as r
cross join unnest(array[
  'dashboard', 'forecast', 'planning', 'purchase_orders', 'receiving',
  'iqc', 'wip_stock', 'fg_inspection', 'oqc', 'fg_stock', 'sales_orders',
  'allocation', 'picking', 'shipping', 'traceability', 'reports',
  'master_data', 'users_permissions'
]) as m;

-- ---------------------------------------------------------------------
-- audit_log: generic append-only log, populated by trigger only.
-- ---------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,
  actor_role app_role,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);

create or replace function audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (table_name, operation, actor_id, actor_role, old_data, new_data)
  values (
    TG_TABLE_NAME,
    TG_OP,
    auth.uid(),
    nullif(auth.jwt() ->> 'app_role', '')::app_role,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );
  return coalesce(NEW, OLD);
end;
$$;

create trigger audit_sites
  after insert or update or delete on sites
  for each row execute function audit_trigger_fn();

create trigger audit_user_profiles
  after insert or update or delete on user_profiles
  for each row execute function audit_trigger_fn();

create trigger audit_user_sites
  after insert or update or delete on user_sites
  for each row execute function audit_trigger_fn();

create trigger audit_role_permissions
  after insert or update or delete on role_permissions
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- Custom Access Token Hook: injects app_role + site_ids into the JWT so
-- RLS policies (here and in every later phase) can check auth.jwt()
-- directly instead of joining back to user_profiles/user_sites on every
-- row. Must be enabled via `supabase config push` (see config.toml).
-- ---------------------------------------------------------------------
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_role app_role;
  v_site_ids uuid[];
begin
  select role into v_role
  from public.user_profiles
  where id = (event ->> 'user_id')::uuid;

  select coalesce(array_agg(site_id), '{}')
  into v_site_ids
  from public.user_sites
  where user_id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  if v_role is not null then
    claims := jsonb_set(claims, '{app_role}', to_jsonb(v_role::text));
  end if;

  claims := jsonb_set(claims, '{site_ids}', to_jsonb(v_site_ids));

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function custom_access_token_hook to supabase_auth_admin;
revoke execute on function custom_access_token_hook from authenticated, anon, public;

grant select on public.user_profiles to supabase_auth_admin;
grant select on public.user_sites to supabase_auth_admin;

-- ---------------------------------------------------------------------
-- RLS helper
-- ---------------------------------------------------------------------
create or replace function requesting_role()
returns app_role
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'app_role', '')::app_role
$$;

-- ---------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------
alter table sites enable row level security;
alter table user_profiles enable row level security;
alter table user_sites enable row level security;
alter table role_permissions enable row level security;
alter table audit_log enable row level security;

create policy "Auth admin can read profiles for claims" on user_profiles
  as permissive for select to supabase_auth_admin using (true);

create policy "Auth admin can read user_sites for claims" on user_sites
  as permissive for select to supabase_auth_admin using (true);

create policy "Authenticated users can view sites" on sites
  for select to authenticated using (true);

create policy "Admins manage sites" on sites
  for all to authenticated
  using (requesting_role() = 'ADMIN')
  with check (requesting_role() = 'ADMIN');

create policy "Users can view own profile" on user_profiles
  for select to authenticated
  using (id = auth.uid());

create policy "Admins and management can view all profiles" on user_profiles
  for select to authenticated
  using (requesting_role() in ('ADMIN', 'MANAGEMENT'));

create policy "Admins manage profiles" on user_profiles
  for insert to authenticated
  with check (requesting_role() = 'ADMIN');

create policy "Admins update profiles" on user_profiles
  for update to authenticated
  using (requesting_role() = 'ADMIN')
  with check (requesting_role() = 'ADMIN');

create policy "Admins delete profiles" on user_profiles
  for delete to authenticated
  using (requesting_role() = 'ADMIN');

create policy "Users can view own site assignments" on user_sites
  for select to authenticated
  using (user_id = auth.uid());

create policy "Admins manage user_sites" on user_sites
  for all to authenticated
  using (requesting_role() = 'ADMIN')
  with check (requesting_role() = 'ADMIN');

create policy "Authenticated users can view role_permissions" on role_permissions
  for select to authenticated using (true);

create policy "Admins manage role_permissions" on role_permissions
  for all to authenticated
  using (requesting_role() = 'ADMIN')
  with check (requesting_role() = 'ADMIN');

create policy "Admins and management can view audit_log" on audit_log
  for select to authenticated
  using (requesting_role() in ('ADMIN', 'MANAGEMENT'));
-- No insert/update/delete policy: audit_log is only ever written by
-- audit_trigger_fn (security definer), matching the append-only-ledger
-- principle used for stock_transactions later.
