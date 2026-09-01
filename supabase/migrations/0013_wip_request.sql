-- Phase 9: WIP Request / FG Inspection Request
-- Two-step: create_wip_request() records the request (no stock effect
-- yet); confirm_wip_request() is the one that actually "ตัด WIP" —
-- locks the source stock_balance row, validates qty, and deducts it.
-- There's no separate "FG Inspection Batch" table: a CONFIRMED
-- wip_requests row *is* the batch — Phase 10 will reference
-- wip_request_id directly when it creates the new FG Lot and its own
-- fg_inspection document number. Deducted qty has no destination
-- stock_balance row (it becomes an ephemeral batch in QC's hands,
-- not warehouse-tracked stock, until Phase 10 creates FG lots).

create table wip_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  item_id uuid not null references items (id),
  wip_lot_id uuid not null references lots (id),
  wip_location_id uuid not null references locations (id),
  requested_qty numeric not null check (requested_qty > 0),
  inspection_plan_id uuid references inspection_plans (id),
  purpose text,
  request_date date not null default current_date,
  requester uuid references user_profiles (id),
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'CANCELLED')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger wip_requests_set_updated_at
  before update on wip_requests
  for each row execute function set_updated_at();

create trigger audit_wip_requests
  after insert or update or delete on wip_requests
  for each row execute function audit_trigger_fn();

alter table stock_transactions drop constraint stock_transactions_txn_type_check;
alter table stock_transactions add constraint stock_transactions_txn_type_check
  check (txn_type in ('RECEIPT', 'IQC_OUT', 'IQC_PASS', 'IQC_HOLD', 'IQC_NG', 'WIP_REQUEST_OUT'));

create or replace function create_wip_request(
  p_item_id uuid,
  p_wip_lot_id uuid,
  p_wip_location_id uuid,
  p_requested_qty numeric,
  p_inspection_plan_id uuid,
  p_purpose text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_no text;
  v_id uuid;
  v_zone text;
begin
  if not has_permission('wip_stock', 'create') then
    raise exception 'Permission denied for wip_stock.create';
  end if;

  select zone_type into v_zone from locations where id = p_wip_location_id;
  if v_zone is distinct from 'WIP' then
    raise exception 'wip_location_id must be zone_type = WIP (got %)', v_zone;
  end if;

  v_request_no := generate_document_number('wip_request');

  insert into wip_requests (
    request_no, item_id, wip_lot_id, wip_location_id, requested_qty,
    inspection_plan_id, purpose, requester
  )
  values (
    v_request_no, p_item_id, p_wip_lot_id, p_wip_location_id, p_requested_qty,
    p_inspection_plan_id, p_purpose, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- confirm_wip_request: the actual "ตัด WIP" — row-locked, atomic.
-- ---------------------------------------------------------------------
create or replace function confirm_wip_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_lot_id uuid;
  v_location_id uuid;
  v_qty numeric;
  v_available numeric;
begin
  if not has_permission('wip_stock', 'approve') then
    raise exception 'Permission denied for wip_stock.approve';
  end if;

  select status, wip_lot_id, wip_location_id, requested_qty
  into v_status, v_lot_id, v_location_id, v_qty
  from wip_requests
  where id = p_request_id;

  if not found then
    raise exception 'WIP request not found';
  end if;
  if v_status <> 'PENDING' then
    raise exception 'WIP request is not PENDING (status = %)', v_status;
  end if;

  select qty into v_available
  from stock_balance
  where lot_id = v_lot_id and location_id = v_location_id
  for update;

  if not found or v_available < v_qty then
    raise exception 'Requested qty (%) exceeds available WIP stock (%)', v_qty, coalesce(v_available, 0);
  end if;

  update stock_balance
  set qty = qty - v_qty
  where lot_id = v_lot_id and location_id = v_location_id;

  insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
  values (v_lot_id, v_location_id, -v_qty, 'WIP_REQUEST_OUT', 'wip_request', p_request_id, auth.uid());

  update wip_requests
  set status = 'CONFIRMED', confirmed_at = now()
  where id = p_request_id;
end;
$$;

create or replace function cancel_wip_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('wip_stock', 'reject') then
    raise exception 'Permission denied for wip_stock.reject';
  end if;

  select status into v_status from wip_requests where id = p_request_id;
  if not found then
    raise exception 'WIP request not found';
  end if;
  if v_status <> 'PENDING' then
    raise exception 'WIP request is not PENDING (status = %)', v_status;
  end if;

  update wip_requests set status = 'CANCELLED' where id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table wip_requests enable row level security;

create policy "View wip_requests" on wip_requests
  for select to authenticated using (has_permission('wip_stock', 'view'));
-- No insert/update/delete policy: only the RPCs above (security
-- definer) write this table.
