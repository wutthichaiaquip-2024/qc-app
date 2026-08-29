-- Phase 2: Master Data
-- Customer, Supplier, Item, Location masters + Inspection Plan
-- infrastructure (ISO 2859-1 / ANSI Z1.4 sample-size lookup, so sample
-- size is never typed in manually during an actual inspection).

-- ---------------------------------------------------------------------
-- Generic permission check, driven by Phase 1's role_permissions matrix
-- so every later table's RLS stays consistent with the actual matrix
-- instead of hardcoding role names per table.
-- ---------------------------------------------------------------------
create or replace function has_permission(p_module text, p_action text)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select case p_action
       when 'view' then can_view
       when 'create' then can_create
       when 'edit' then can_edit
       when 'approve' then can_approve
       when 'reject' then can_reject
       when 'delete' then can_delete
     end
     from role_permissions
     where role = requesting_role() and module = p_module),
    false
  );
$$;

-- ---------------------------------------------------------------------
-- Customer Master
-- ---------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text,
  contact_name text,
  contact_phone text,
  contact_email text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_set_updated_at
  before update on customers
  for each row execute function set_updated_at();

create trigger audit_customers
  after insert or update or delete on customers
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- Supplier Master
-- ---------------------------------------------------------------------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  rating smallint check (rating is null or rating between 1 and 5),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger suppliers_set_updated_at
  before update on suppliers
  for each row execute function set_updated_at();

create trigger audit_suppliers
  after insert or update or delete on suppliers
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- Item Master
-- custom_conversion is a structured {factor, rounding} object (never an
-- eval()-able formula string — see master prompt section 3.1).
-- ---------------------------------------------------------------------
create table items (
  id uuid primary key default gen_random_uuid(),
  part_no text not null unique,
  description text,
  brand text,
  category text,
  base_uom text not null,
  purchase_uom text not null,
  uom_conversion_factor numeric not null default 1 check (uom_conversion_factor > 0),
  custom_conversion jsonb,
  customer_id uuid references customers (id),
  supplier_id uuid references suppliers (id),
  safety_stock numeric not null default 0 check (safety_stock >= 0),
  moq numeric check (moq is null or moq >= 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  barcode_value text unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger items_set_updated_at
  before update on items
  for each row execute function set_updated_at();

create trigger audit_items
  after insert or update or delete on items
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- Location Master (site-scoped — multi-site decision from Phase 1)
-- ---------------------------------------------------------------------
create table locations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  code text not null,
  name text,
  zone_type text not null check (zone_type in (
    'INCOMING', 'WIP', 'FG', 'HOLD', 'NG', 'REWORK', 'RETURN'
  )),
  physical_address text,
  barcode_value text unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, code)
);

create trigger locations_set_updated_at
  before update on locations
  for each row execute function set_updated_at();

create trigger audit_locations
  after insert or update or delete on locations
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- Sample-size code letters (ISO 2859-1 / ANSI Z1.4 Table I — General
-- Inspection Levels I/II/III). Standard, stable reference values.
-- Special levels S-1..S-4 are not seeded yet; add rows if needed.
-- ---------------------------------------------------------------------
create table sample_size_code_letters (
  standard text not null check (standard in ('ISO_2859_1', 'ANSI_Z1_4')),
  lot_size_min integer not null,
  lot_size_max integer,
  inspection_level text not null check (inspection_level in ('S1', 'S2', 'S3', 'S4', 'I', 'II', 'III')),
  code_letter char(1) not null,
  primary key (standard, lot_size_min, inspection_level)
);

insert into sample_size_code_letters (standard, lot_size_min, lot_size_max, inspection_level, code_letter)
select s.standard, b.lot_size_min, b.lot_size_max, l.level, l.code_letter
from (values ('ISO_2859_1'), ('ANSI_Z1_4')) as s(standard)
cross join (values
  (2, 8),
  (9, 15),
  (16, 25),
  (26, 50),
  (51, 90),
  (91, 150),
  (151, 280),
  (281, 500),
  (501, 1200),
  (1201, 3200),
  (3201, 10000),
  (10001, 35000),
  (35001, 150000),
  (150001, 500000),
  (500001, null)
) as b(lot_size_min, lot_size_max)
cross join lateral (values
  ('I', case b.lot_size_min
     when 2 then 'A' when 9 then 'A' when 16 then 'B' when 26 then 'C' when 51 then 'C'
     when 91 then 'D' when 151 then 'E' when 281 then 'F' when 501 then 'G' when 1201 then 'H'
     when 3201 then 'J' when 10001 then 'K' when 35001 then 'L' when 150001 then 'M' when 500001 then 'N'
   end),
  ('II', case b.lot_size_min
     when 2 then 'A' when 9 then 'B' when 16 then 'C' when 26 then 'D' when 51 then 'E'
     when 91 then 'F' when 151 then 'G' when 281 then 'H' when 501 then 'J' when 1201 then 'K'
     when 3201 then 'L' when 10001 then 'M' when 35001 then 'N' when 150001 then 'P' when 500001 then 'Q'
   end),
  ('III', case b.lot_size_min
     when 2 then 'B' when 9 then 'C' when 16 then 'D' when 26 then 'E' when 51 then 'F'
     when 91 then 'G' when 151 then 'H' when 281 then 'J' when 501 then 'K' when 1201 then 'L'
     when 3201 then 'M' when 10001 then 'N' when 35001 then 'P' when 150001 then 'Q' when 500001 then 'R'
   end)
) as l(level, code_letter);

-- ---------------------------------------------------------------------
-- AQL sampling plans (ISO 2859-1 / ANSI Z1.4 Table II-A — sample size +
-- Accept/Reject numbers by code letter + AQL). Left EMPTY on purpose:
-- these numbers directly gate pass/fail decisions on real lots, so they
-- must be entered from your own official standard document, not
-- guessed. Fill in via QC's master-data screen once ready.
-- ---------------------------------------------------------------------
create table aql_sampling_plans (
  standard text not null check (standard in ('ISO_2859_1', 'ANSI_Z1_4')),
  code_letter char(1) not null,
  aql numeric not null,
  sample_size integer not null check (sample_size > 0),
  accept_no integer not null check (accept_no >= 0),
  reject_no integer not null check (reject_no > accept_no),
  primary key (standard, code_letter, aql)
);

create trigger audit_aql_sampling_plans
  after insert or update or delete on aql_sampling_plans
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- Inspection Plan: versioned per item (effective_date + revision_no),
-- results recorded later always reference the revision that was
-- actually effective on the day of inspection.
-- ---------------------------------------------------------------------
create table inspection_plans (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id),
  sampling_standard text not null check (sampling_standard in ('ISO_2859_1', 'ANSI_Z1_4')),
  inspection_level text not null check (inspection_level in ('S1', 'S2', 'S3', 'S4', 'I', 'II', 'III')),
  aql numeric not null,
  effective_date date not null,
  revision_no integer not null default 1,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, revision_no)
);

create trigger inspection_plans_set_updated_at
  before update on inspection_plans
  for each row execute function set_updated_at();

create trigger audit_inspection_plans
  after insert or update or delete on inspection_plans
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- Looks up the sample-size plan for an item + actual lot size, using
-- whichever inspection plan revision is ACTIVE as of today. Used from
-- Phase 7 (IQC) onward so nobody types sample size in by hand.
-- ---------------------------------------------------------------------
create or replace function get_sample_size_plan(p_item_id uuid, p_lot_size integer)
returns table (
  inspection_plan_id uuid,
  sampling_standard text,
  inspection_level text,
  aql numeric,
  code_letter char(1),
  sample_size integer,
  accept_no integer,
  reject_no integer
)
language sql
stable
as $$
  select
    ip.id,
    ip.sampling_standard,
    ip.inspection_level,
    ip.aql,
    ssc.code_letter,
    asp.sample_size,
    asp.accept_no,
    asp.reject_no
  from inspection_plans ip
  join sample_size_code_letters ssc
    on ssc.standard = ip.sampling_standard
   and ssc.inspection_level = ip.inspection_level
   and p_lot_size >= ssc.lot_size_min
   and (ssc.lot_size_max is null or p_lot_size <= ssc.lot_size_max)
  join aql_sampling_plans asp
    on asp.standard = ip.sampling_standard
   and asp.code_letter = ssc.code_letter
   and asp.aql = ip.aql
  where ip.item_id = p_item_id
    and ip.status = 'ACTIVE'
    and ip.effective_date <= current_date
  order by ip.effective_date desc, ip.revision_no desc
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- RLS — all gated through has_permission('master_data', <action>) so
-- Phase 1's role_permissions matrix is the single source of truth.
-- ---------------------------------------------------------------------
alter table customers enable row level security;
alter table suppliers enable row level security;
alter table items enable row level security;
alter table locations enable row level security;
alter table sample_size_code_letters enable row level security;
alter table aql_sampling_plans enable row level security;
alter table inspection_plans enable row level security;

create policy "View customers" on customers for select to authenticated using (has_permission('master_data', 'view'));
create policy "Create customers" on customers for insert to authenticated with check (has_permission('master_data', 'create'));
create policy "Edit customers" on customers for update to authenticated using (has_permission('master_data', 'edit')) with check (has_permission('master_data', 'edit'));
create policy "Delete customers" on customers for delete to authenticated using (has_permission('master_data', 'delete'));

create policy "View suppliers" on suppliers for select to authenticated using (has_permission('master_data', 'view'));
create policy "Create suppliers" on suppliers for insert to authenticated with check (has_permission('master_data', 'create'));
create policy "Edit suppliers" on suppliers for update to authenticated using (has_permission('master_data', 'edit')) with check (has_permission('master_data', 'edit'));
create policy "Delete suppliers" on suppliers for delete to authenticated using (has_permission('master_data', 'delete'));

create policy "View items" on items for select to authenticated using (has_permission('master_data', 'view'));
create policy "Create items" on items for insert to authenticated with check (has_permission('master_data', 'create'));
create policy "Edit items" on items for update to authenticated using (has_permission('master_data', 'edit')) with check (has_permission('master_data', 'edit'));
create policy "Delete items" on items for delete to authenticated using (has_permission('master_data', 'delete'));

create policy "View locations" on locations for select to authenticated using (has_permission('master_data', 'view'));
create policy "Create locations" on locations for insert to authenticated with check (has_permission('master_data', 'create'));
create policy "Edit locations" on locations for update to authenticated using (has_permission('master_data', 'edit')) with check (has_permission('master_data', 'edit'));
create policy "Delete locations" on locations for delete to authenticated using (has_permission('master_data', 'delete'));

create policy "View sample_size_code_letters" on sample_size_code_letters for select to authenticated using (has_permission('master_data', 'view'));
create policy "Manage sample_size_code_letters" on sample_size_code_letters for all to authenticated using (has_permission('master_data', 'edit')) with check (has_permission('master_data', 'edit'));

create policy "View aql_sampling_plans" on aql_sampling_plans for select to authenticated using (has_permission('master_data', 'view'));
create policy "Manage aql_sampling_plans" on aql_sampling_plans for all to authenticated using (has_permission('master_data', 'edit')) with check (has_permission('master_data', 'edit'));

create policy "View inspection_plans" on inspection_plans for select to authenticated using (has_permission('master_data', 'view'));
create policy "Create inspection_plans" on inspection_plans for insert to authenticated with check (has_permission('master_data', 'create'));
create policy "Edit inspection_plans" on inspection_plans for update to authenticated using (has_permission('master_data', 'edit')) with check (has_permission('master_data', 'edit'));
create policy "Delete inspection_plans" on inspection_plans for delete to authenticated using (has_permission('master_data', 'delete'));
