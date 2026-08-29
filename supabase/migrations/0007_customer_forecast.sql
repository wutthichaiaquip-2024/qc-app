-- Phase 3: Customer Forecast
-- forecast_batches (one row per customer submission, forecast_no via
-- Phase 0's document numbering) + forecast_lines (append-only: every
-- edit is a NEW row with an incremented version, matching the
-- Stock-Ledger append-only principle from section 3 — never UPDATE or
-- DELETE a line). Both mutated only through RPCs so revision_no /
-- version are computed atomically server-side, never MAX(id)+1.

create table forecast_revision_counters (
  customer_id uuid primary key references customers (id),
  last_revision integer not null default 0
);

create table forecast_line_version_counters (
  customer_id uuid not null references customers (id),
  item_id uuid not null references items (id),
  forecast_month date not null,
  last_version integer not null default 0,
  primary key (customer_id, item_id, forecast_month)
);

create table forecast_batches (
  id uuid primary key default gen_random_uuid(),
  forecast_no text not null unique,
  customer_id uuid not null references customers (id),
  revision_no integer not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'REVISED', 'CANCELLED')),
  created_by uuid references user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger forecast_batches_set_updated_at
  before update on forecast_batches
  for each row execute function set_updated_at();

create trigger audit_forecast_batches
  after insert or update or delete on forecast_batches
  for each row execute function audit_trigger_fn();

create table forecast_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references forecast_batches (id),
  item_id uuid not null references items (id),
  forecast_month date not null,
  forecast_qty numeric not null check (forecast_qty >= 0),
  version integer not null,
  created_at timestamptz not null default now(),
  unique (batch_id, item_id, forecast_month)
);

create trigger audit_forecast_lines
  after insert or update or delete on forecast_lines
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- create_forecast_batch: one DB transaction creates the batch header +
-- every line, with forecast_no / revision_no / per-line version all
-- computed via atomic counters (same INSERT...ON CONFLICT pattern as
-- Phase 0's document numbering) so concurrent submissions never race.
-- p_lines: jsonb array of {item_id, forecast_month, forecast_qty}
-- ---------------------------------------------------------------------
create or replace function create_forecast_batch(p_customer_id uuid, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_forecast_no text;
  v_revision_no integer;
  v_line jsonb;
  v_version integer;
begin
  if not has_permission('forecast', 'create') then
    raise exception 'Permission denied for forecast.create';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'p_lines must contain at least one line';
  end if;

  v_forecast_no := generate_document_number('forecast');

  insert into forecast_revision_counters (customer_id, last_revision)
  values (p_customer_id, 1)
  on conflict (customer_id)
    do update set last_revision = forecast_revision_counters.last_revision + 1
  returning last_revision into v_revision_no;

  insert into forecast_batches (forecast_no, customer_id, revision_no, created_by)
  values (v_forecast_no, p_customer_id, v_revision_no, auth.uid())
  returning id into v_batch_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into forecast_line_version_counters (customer_id, item_id, forecast_month, last_version)
    values (p_customer_id, (v_line ->> 'item_id')::uuid, (v_line ->> 'forecast_month')::date, 1)
    on conflict (customer_id, item_id, forecast_month)
      do update set last_version = forecast_line_version_counters.last_version + 1
    returning last_version into v_version;

    insert into forecast_lines (batch_id, item_id, forecast_month, forecast_qty, version)
    values (
      v_batch_id,
      (v_line ->> 'item_id')::uuid,
      (v_line ->> 'forecast_month')::date,
      (v_line ->> 'forecast_qty')::numeric,
      v_version
    );
  end loop;

  return v_batch_id;
end;
$$;

-- ---------------------------------------------------------------------
-- update_forecast_batch_status: only legal transitions, each gated by
-- the permission action it most resembles in the role_permissions
-- matrix (submit=edit, approve=approve, revise=edit, cancel/send-back=reject).
-- ---------------------------------------------------------------------
create or replace function update_forecast_batch_status(p_batch_id uuid, p_new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_required_action text;
begin
  select status into v_current from forecast_batches where id = p_batch_id;
  if not found then
    raise exception 'Forecast batch not found';
  end if;

  v_required_action := case
    when v_current = 'DRAFT' and p_new_status = 'SUBMITTED' then 'edit'
    when v_current = 'SUBMITTED' and p_new_status = 'APPROVED' then 'approve'
    when v_current = 'SUBMITTED' and p_new_status = 'DRAFT' then 'reject'
    when v_current = 'SUBMITTED' and p_new_status = 'CANCELLED' then 'reject'
    when v_current = 'DRAFT' and p_new_status = 'CANCELLED' then 'reject'
    when v_current = 'APPROVED' and p_new_status = 'REVISED' then 'edit'
    when v_current = 'APPROVED' and p_new_status = 'CANCELLED' then 'reject'
  end;

  if v_required_action is null then
    raise exception 'Illegal status transition: % -> %', v_current, p_new_status;
  end if;

  if not has_permission('forecast', v_required_action) then
    raise exception 'Permission denied for forecast.%', v_required_action;
  end if;

  update forecast_batches set status = p_new_status where id = p_batch_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS — mutation only via the RPCs above (both SECURITY DEFINER, so
-- they bypass RLS after their own has_permission() check); no direct
-- INSERT/UPDATE/DELETE policies for authenticated on either table.
-- ---------------------------------------------------------------------
alter table forecast_batches enable row level security;
alter table forecast_lines enable row level security;

create policy "View forecast_batches" on forecast_batches
  for select to authenticated using (has_permission('forecast', 'view'));

create policy "View forecast_lines" on forecast_lines
  for select to authenticated using (has_permission('forecast', 'view'));
