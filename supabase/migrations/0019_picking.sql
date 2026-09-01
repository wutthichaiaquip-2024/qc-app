-- Phase 14: Picking
-- Confirms physically pulling stock that Phase 13 already allocated.
-- Does NOT cut stock_balance — per the operational workflow in section
-- 2.1, physical stock is only actually cut at Shipping confirmation
-- (Phase 16); Picking just advances the allocation's lifecycle from
-- ACTIVE (reserved) to PICKED (physically pulled), which is why there
-- is no row-lock-and-mutate step here, unlike every earlier stock
-- phase — nothing in stock_balance changes.
--
-- "QC Status = PASS" is satisfied by construction, not a separate
-- check: allocations can only ever reference FG-zone stock_balance
-- rows, and Phase 11's trigger already guarantees those can only
-- exist via an FG_PASS transaction.

alter table allocations drop constraint allocations_status_check;
alter table allocations add constraint allocations_status_check
  check (status in ('ACTIVE', 'PICKED', 'RELEASED'));

create table pickings (
  id uuid primary key default gen_random_uuid(),
  picking_no text not null unique,
  so_id uuid not null references sales_orders (id),
  picked_by uuid references user_profiles (id),
  picked_at timestamptz not null default now()
);

create trigger audit_pickings
  after insert or update or delete on pickings
  for each row execute function audit_trigger_fn();

create table picking_lines (
  id uuid primary key default gen_random_uuid(),
  picking_id uuid not null references pickings (id),
  allocation_id uuid not null unique references allocations (id),
  qty_picked numeric not null check (qty_picked > 0)
);

create trigger audit_picking_lines
  after insert or update or delete on picking_lines
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- confirm_picking: validates every allocation belongs to this SO and
-- is still ACTIVE (Part/Lot/Location/Qty implicitly correct since the
-- client references the allocation record itself, not raw values —
-- "Order ถูกต้อง" is the SO-must-be-OPEN + allocation-must-belong-to-it
-- check below), then marks each PICKED.
-- p_allocation_ids: uuid[] of allocations to pick together
-- ---------------------------------------------------------------------
create or replace function confirm_picking(p_so_id uuid, p_allocation_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so_status text;
  v_picking_no text;
  v_picking_id uuid;
  v_alloc_id uuid;
  v_alloc record;
begin
  if not has_permission('picking', 'create') then
    raise exception 'Permission denied for picking.create';
  end if;

  if array_length(p_allocation_ids, 1) is null then
    raise exception 'p_allocation_ids must contain at least one allocation';
  end if;

  select status into v_so_status from sales_orders where id = p_so_id;
  if not found then
    raise exception 'Sales order not found';
  end if;
  if v_so_status <> 'OPEN' then
    raise exception 'Sales order is not OPEN (status = %)', v_so_status;
  end if;

  v_picking_no := generate_document_number('picking');

  insert into pickings (picking_no, so_id, picked_by)
  values (v_picking_no, p_so_id, auth.uid())
  returning id into v_picking_id;

  foreach v_alloc_id in array p_allocation_ids
  loop
    select a.*, sol.so_id into v_alloc
    from allocations a
    join sales_order_lines sol on sol.id = a.so_line_id
    where a.id = v_alloc_id;

    if not found then
      raise exception 'Allocation % not found', v_alloc_id;
    end if;
    if v_alloc.so_id <> p_so_id then
      raise exception 'Allocation % does not belong to this sales order', v_alloc_id;
    end if;
    if v_alloc.status <> 'ACTIVE' then
      raise exception 'Allocation % is not ACTIVE (status = %)', v_alloc_id, v_alloc.status;
    end if;

    insert into picking_lines (picking_id, allocation_id, qty_picked)
    values (v_picking_id, v_alloc_id, v_alloc.qty);

    update allocations set status = 'PICKED' where id = v_alloc_id;
  end loop;

  return v_picking_id;
end;
$$;

-- ---------------------------------------------------------------------
-- get_picking_queue: SO lines with ACTIVE (unpicked) allocations, one
-- row per allocation, following the same has_permission('picking',
-- 'view') pattern as earlier read functions.
-- ---------------------------------------------------------------------
create or replace function get_picking_queue()
returns table (
  allocation_id uuid,
  so_id uuid,
  so_no text,
  customer_code text,
  so_line_id uuid,
  item_id uuid,
  part_no text,
  lot_id uuid,
  lot_no text,
  location_id uuid,
  location_code text,
  qty numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id, so.id, so.so_no, c.code, sol.id, i.id, i.part_no,
    l.id, l.lot_no, loc.id, loc.code, a.qty
  from allocations a
  join sales_order_lines sol on sol.id = a.so_line_id
  join sales_orders so on so.id = sol.so_id
  join customers c on c.id = so.customer_id
  join items i on i.id = sol.item_id
  join lots l on l.id = a.lot_id
  join locations loc on loc.id = a.location_id
  where a.status = 'ACTIVE'
    and so.status = 'OPEN'
    and has_permission('picking', 'view');
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table pickings enable row level security;
alter table picking_lines enable row level security;

create policy "View pickings" on pickings for select to authenticated using (has_permission('picking', 'view'));
create policy "View picking_lines" on picking_lines for select to authenticated using (has_permission('picking', 'view'));
-- No insert/update/delete policy: only confirm_picking() (security
-- definer) writes these tables.
