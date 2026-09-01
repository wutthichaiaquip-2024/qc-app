-- Phase 13: Stock Allocation
-- FIFO / FEFO / Manual selection, allocating only PASS FG stock, with
-- the lock-ordering discipline section 3 requires when a single
-- operation must lock multiple stock_balance rows: candidates are
-- chosen in FIFO/FEFO *priority* order via a window function (no lock
-- yet), then that specific candidate set is locked and applied in a
-- fixed lot_id order to prevent deadlocks against concurrent
-- allocations touching an overlapping set of lots.
--
-- Two schema gaps had to be filled in to make this real rather than
-- fake:
-- 1. FEFO needs an expiry date on the lot. There was nowhere to enter
--    one, so items get `shelf_life_days` (Master Data) and
--    confirm_fg_inspection() now computes the new FG lot's
--    expiry_date from it automatically at inspection time.
-- 2. Allocation needs to know which site's FG stock to draw from, but
--    sales_orders never got a site — added here (Phase 12 didn't need
--    it, Phase 13 can't work without it).

alter table items add column shelf_life_days integer check (shelf_life_days is null or shelf_life_days > 0);
alter table lots add column expiry_date date;
alter table sales_orders add column site_id uuid references sites (id);

-- ---------------------------------------------------------------------
-- Re-create confirm_fg_inspection(): only change is computing
-- expiry_date on the new lot from the item's shelf_life_days.
-- ---------------------------------------------------------------------
create or replace function confirm_fg_inspection(
  p_wip_request_id uuid,
  p_inspection_mode text,
  p_measurement_method text,
  p_fg_location_id uuid,
  p_hold_location_id uuid,
  p_ng_location_id uuid,
  p_qty_pass numeric,
  p_qty_hold numeric,
  p_qty_ng numeric,
  p_started_at timestamptz,
  p_characteristics jsonb,
  p_defects jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wr record;
  v_plan record;
  v_item record;
  v_fg_no text;
  v_lot_no text;
  v_new_lot_id uuid;
  v_fg_id uuid;
  v_char jsonb;
  v_defect jsonb;
  v_zone text;
  v_expiry date;
begin
  if not has_permission('fg_inspection', 'create') then
    raise exception 'Permission denied for fg_inspection.create';
  end if;

  select * into v_wr from wip_requests where id = p_wip_request_id for update;
  if not found then
    raise exception 'WIP request not found';
  end if;
  if v_wr.status <> 'CONFIRMED' then
    raise exception 'WIP request is not CONFIRMED (status = %)', v_wr.status;
  end if;
  if exists (select 1 from fg_inspections where wip_request_id = p_wip_request_id) then
    raise exception 'This WIP request has already been FG-inspected';
  end if;

  if coalesce(p_qty_pass, 0) + coalesce(p_qty_hold, 0) + coalesce(p_qty_ng, 0) <= 0 then
    raise exception 'qty_pass + qty_hold + qty_ng must be greater than 0';
  end if;
  if (p_qty_pass + p_qty_hold + p_qty_ng) > v_wr.requested_qty then
    raise exception 'qty_pass + qty_hold + qty_ng (%) exceeds requested qty (%)', p_qty_pass + p_qty_hold + p_qty_ng, v_wr.requested_qty;
  end if;

  if p_qty_pass > 0 then
    select zone_type into v_zone from locations where id = p_fg_location_id;
    if v_zone is distinct from 'FG' then
      raise exception 'Pass location must be zone_type = FG (got %)', v_zone;
    end if;
  end if;
  if p_qty_hold > 0 then
    select zone_type into v_zone from locations where id = p_hold_location_id;
    if v_zone is distinct from 'HOLD' then
      raise exception 'Hold location must be zone_type = HOLD (got %)', v_zone;
    end if;
  end if;
  if p_qty_ng > 0 then
    select zone_type into v_zone from locations where id = p_ng_location_id;
    if v_zone is distinct from 'NG' then
      raise exception 'NG location must be zone_type = NG (got %)', v_zone;
    end if;
  end if;

  select * into v_item from items where id = v_wr.item_id;
  select * into v_plan from get_sample_size_plan(v_wr.item_id, v_wr.requested_qty::integer);

  v_fg_no := generate_document_number('fg_inspection');
  v_lot_no := generate_document_number('lot');

  if v_item.shelf_life_days is not null then
    v_expiry := current_date + v_item.shelf_life_days;
  end if;

  insert into lots (lot_no, item_id, expiry_date) values (v_lot_no, v_wr.item_id, v_expiry) returning id into v_new_lot_id;

  insert into fg_inspections (
    fg_no, wip_request_id, item_id, new_lot_id, inspection_plan_id,
    inspection_mode, measurement_method, lot_size, sample_size, accept_no, reject_no,
    qty_pass, qty_hold, qty_ng, inspected_by, started_at
  )
  values (
    v_fg_no, p_wip_request_id, v_wr.item_id, v_new_lot_id, v_plan.inspection_plan_id,
    p_inspection_mode, p_measurement_method, v_wr.requested_qty, v_plan.sample_size,
    v_plan.accept_no, v_plan.reject_no, coalesce(p_qty_pass, 0), coalesce(p_qty_hold, 0),
    coalesce(p_qty_ng, 0), auth.uid(), p_started_at
  )
  returning id into v_fg_id;

  for v_char in select * from jsonb_array_elements(coalesce(p_characteristics, '[]'::jsonb))
  loop
    insert into fg_inspection_characteristics (fg_inspection_id, characteristic_name, spec_value, measured_value, unit, result)
    values (
      v_fg_id,
      v_char ->> 'characteristic_name',
      nullif(v_char ->> 'spec_value', ''),
      nullif(v_char ->> 'measured_value', '')::numeric,
      nullif(v_char ->> 'unit', ''),
      v_char ->> 'result'
    );
  end loop;

  for v_defect in select * from jsonb_array_elements(coalesce(p_defects, '[]'::jsonb))
  loop
    insert into fg_inspection_defects (fg_inspection_id, defect_code_id, qty, condition_note, photo_path)
    values (
      v_fg_id,
      (v_defect ->> 'defect_code_id')::uuid,
      (v_defect ->> 'qty')::numeric,
      nullif(v_defect ->> 'condition_note', ''),
      nullif(v_defect ->> 'photo_path', '')
    );
  end loop;

  if p_qty_pass > 0 then
    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (v_new_lot_id, p_fg_location_id, p_qty_pass, 'FG_PASS', 'fg_inspection', v_fg_id, auth.uid());

    insert into stock_balance (lot_id, location_id, qty)
    values (v_new_lot_id, p_fg_location_id, p_qty_pass)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;
  end if;

  if p_qty_hold > 0 then
    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (v_new_lot_id, p_hold_location_id, p_qty_hold, 'FG_HOLD', 'fg_inspection', v_fg_id, auth.uid());

    insert into stock_balance (lot_id, location_id, qty)
    values (v_new_lot_id, p_hold_location_id, p_qty_hold)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;
  end if;

  if p_qty_ng > 0 then
    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (v_new_lot_id, p_ng_location_id, p_qty_ng, 'FG_NG', 'fg_inspection', v_fg_id, auth.uid());

    insert into stock_balance (lot_id, location_id, qty)
    values (v_new_lot_id, p_ng_location_id, p_qty_ng)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;
  end if;

  return v_fg_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Re-create create_sales_order(): accepts + stores site_id.
-- ---------------------------------------------------------------------
create or replace function create_sales_order(
  p_customer_id uuid,
  p_order_date date,
  p_required_date date,
  p_site_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so_id uuid;
  v_so_no text;
  v_line jsonb;
  v_line_no integer := 0;
begin
  if not has_permission('sales_orders', 'create') then
    raise exception 'Permission denied for sales_orders.create';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'p_lines must contain at least one line';
  end if;

  v_so_no := generate_document_number('sales_order');

  insert into sales_orders (so_no, customer_id, order_date, required_date, site_id, created_by)
  values (v_so_no, p_customer_id, coalesce(p_order_date, current_date), p_required_date, p_site_id, auth.uid())
  returning id into v_so_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    insert into sales_order_lines (so_id, line_no, item_id, qty, delivery_date)
    values (
      v_so_id,
      v_line_no,
      (v_line ->> 'item_id')::uuid,
      (v_line ->> 'qty')::numeric,
      nullif(v_line ->> 'delivery_date', '')::date
    );
  end loop;

  return v_so_id;
end;
$$;

-- ---------------------------------------------------------------------
-- allocations: which SO line got reserved from which lot+location.
-- ---------------------------------------------------------------------
create table allocations (
  id uuid primary key default gen_random_uuid(),
  so_line_id uuid not null references sales_order_lines (id),
  lot_id uuid not null references lots (id),
  location_id uuid not null references locations (id),
  qty numeric not null check (qty > 0),
  method text not null check (method in ('FIFO', 'FEFO', 'MANUAL')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RELEASED')),
  allocated_by uuid references user_profiles (id),
  allocated_at timestamptz not null default now(),
  released_at timestamptz
);

create trigger audit_allocations
  after insert or update or delete on allocations
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- allocate_stock: FIFO/FEFO auto-selects (splitting across lots if one
-- isn't enough), MANUAL takes an explicit lot+location. Every path
-- only ever touches FG-zone locations.
-- ---------------------------------------------------------------------
create or replace function allocate_stock(
  p_so_line_id uuid,
  p_method text,
  p_qty numeric,
  p_manual_lot_id uuid default null,
  p_manual_location_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so_line record;
  v_so record;
  v_already_allocated numeric;
  v_remaining_on_line numeric;
  v_to_allocate numeric;
  v_available numeric;
  v_zone text;
  v_candidate record;
begin
  if not has_permission('allocation', 'create') then
    raise exception 'Permission denied for allocation.create';
  end if;

  if p_method not in ('FIFO', 'FEFO', 'MANUAL') then
    raise exception 'Invalid method: %', p_method;
  end if;
  if p_qty <= 0 then
    raise exception 'Allocation qty must be greater than 0';
  end if;

  select * into v_so_line from sales_order_lines where id = p_so_line_id;
  if not found then
    raise exception 'Sales order line not found';
  end if;

  select * into v_so from sales_orders where id = v_so_line.so_id;
  if v_so.status <> 'OPEN' then
    raise exception 'Sales order is not OPEN (status = %)', v_so.status;
  end if;
  if v_so.site_id is null then
    raise exception 'Sales order has no site_id set';
  end if;

  select coalesce(sum(qty), 0) into v_already_allocated
  from allocations where so_line_id = p_so_line_id and status = 'ACTIVE';

  v_remaining_on_line := v_so_line.qty - v_already_allocated;
  if p_qty > v_remaining_on_line then
    raise exception 'Requested qty (%) exceeds remaining unallocated qty on this line (%)', p_qty, v_remaining_on_line;
  end if;

  if p_method = 'MANUAL' then
    if p_manual_lot_id is null or p_manual_location_id is null then
      raise exception 'Manual allocation requires a lot and a location';
    end if;

    select zone_type into v_zone from locations where id = p_manual_location_id;
    if v_zone is distinct from 'FG' then
      raise exception 'Manual allocation location must be zone_type = FG (got %)', v_zone;
    end if;

    select qty - reserved_qty into v_available
    from stock_balance
    where lot_id = p_manual_lot_id and location_id = p_manual_location_id
    for update;

    if v_available is null or v_available < p_qty then
      raise exception 'Insufficient available FG stock for manual allocation (available %)', coalesce(v_available, 0);
    end if;

    update stock_balance set reserved_qty = reserved_qty + p_qty
    where lot_id = p_manual_lot_id and location_id = p_manual_location_id;

    insert into allocations (so_line_id, lot_id, location_id, qty, method, allocated_by)
    values (p_so_line_id, p_manual_lot_id, p_manual_location_id, p_qty, 'MANUAL', auth.uid());

    return;
  end if;

  -- FIFO / FEFO: pick candidates in priority order (no lock), then
  -- lock + apply that specific set in a fixed lot_id order.
  v_to_allocate := p_qty;

  for v_candidate in
    with priority_stock as (
      select
        sb.lot_id, sb.location_id, (sb.qty - sb.reserved_qty) as avail,
        sum(sb.qty - sb.reserved_qty) over (
          order by
            case when p_method = 'FEFO' then l.expiry_date end asc nulls last,
            case when p_method = 'FIFO' then l.created_at end asc,
            sb.lot_id
          rows unbounded preceding
        ) as running_total
      from stock_balance sb
      join lots l on l.id = sb.lot_id
      join locations loc on loc.id = sb.location_id
      where l.item_id = v_so_line.item_id
        and loc.zone_type = 'FG'
        and loc.site_id = v_so.site_id
        and (sb.qty - sb.reserved_qty) > 0
    )
    select lot_id, location_id, least(avail, greatest(0, p_qty - (running_total - avail))) as take_qty
    from priority_stock
    where running_total - avail < p_qty
    order by lot_id
  loop
    select qty - reserved_qty into v_available
    from stock_balance
    where lot_id = v_candidate.lot_id and location_id = v_candidate.location_id
    for update;

    if v_available < v_candidate.take_qty then
      raise exception 'FG stock availability changed concurrently — please retry allocation';
    end if;

    update stock_balance set reserved_qty = reserved_qty + v_candidate.take_qty
    where lot_id = v_candidate.lot_id and location_id = v_candidate.location_id;

    insert into allocations (so_line_id, lot_id, location_id, qty, method, allocated_by)
    values (p_so_line_id, v_candidate.lot_id, v_candidate.location_id, v_candidate.take_qty, p_method, auth.uid());

    v_to_allocate := v_to_allocate - v_candidate.take_qty;
  end loop;

  if v_to_allocate > 0 then
    raise exception 'Insufficient FG stock to allocate % (short by %)', p_qty, v_to_allocate;
  end if;
end;
$$;

create or replace function release_allocation(p_allocation_id uuid)
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
begin
  if not has_permission('allocation', 'delete') then
    raise exception 'Permission denied for allocation.delete';
  end if;

  select status, lot_id, location_id, qty into v_status, v_lot_id, v_location_id, v_qty
  from allocations where id = p_allocation_id;

  if not found then
    raise exception 'Allocation not found';
  end if;
  if v_status <> 'ACTIVE' then
    raise exception 'Allocation is not ACTIVE (status = %)', v_status;
  end if;

  update stock_balance set reserved_qty = reserved_qty - v_qty
  where lot_id = v_lot_id and location_id = v_location_id;

  update allocations set status = 'RELEASED', released_at = now() where id = p_allocation_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Re-create cancel_sales_order(): also releases any ACTIVE allocations
-- on the order's lines, so cancelling doesn't leave stock reserved
-- forever with nothing to fulfill it.
-- ---------------------------------------------------------------------
create or replace function cancel_sales_order(p_so_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_alloc record;
begin
  if not has_permission('sales_orders', 'reject') then
    raise exception 'Permission denied for sales_orders.reject';
  end if;

  select status into v_status from sales_orders where id = p_so_id;
  if not found then
    raise exception 'Sales order not found';
  end if;
  if v_status <> 'OPEN' then
    raise exception 'Sales order is not OPEN (status = %)', v_status;
  end if;

  for v_alloc in
    select a.id, a.lot_id, a.location_id, a.qty
    from allocations a
    join sales_order_lines sol on sol.id = a.so_line_id
    where sol.so_id = p_so_id and a.status = 'ACTIVE'
  loop
    update stock_balance set reserved_qty = reserved_qty - v_alloc.qty
    where lot_id = v_alloc.lot_id and location_id = v_alloc.location_id;

    update allocations set status = 'RELEASED', released_at = now() where id = v_alloc.id;
  end loop;

  update sales_orders set status = 'CANCELLED' where id = p_so_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table allocations enable row level security;

create policy "View allocations" on allocations
  for select to authenticated using (has_permission('allocation', 'view'));
-- No insert/update/delete policy: only allocate_stock()/release_allocation()
-- (security definer) write this table.
