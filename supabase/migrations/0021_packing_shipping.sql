-- Phase 16: Packing & Shipping
-- This is where stock is finally, actually cut from the system — every
-- earlier phase only moved it between zones or reserved it. Shipment
-- confirm decrements both qty AND reserved_qty together for the exact
-- allocation being shipped: qty drops because the goods physically
-- left, reserved_qty drops because that specific reservation is now
-- discharged (not lingering as a phantom hold on stock that no longer
-- exists) — matches "ตัดสต็อกออกจากระบบจริงตอนนี้เอง" from the
-- operational workflow. Requires the allocation's picking to have
-- already passed OQC, per the doc's Picking -> OQC -> Shipping order.

alter table allocations drop constraint allocations_status_check;
alter table allocations add constraint allocations_status_check
  check (status in ('ACTIVE', 'PICKED', 'RELEASED', 'SHIPPED'));

alter table sales_orders drop constraint sales_orders_status_check;
alter table sales_orders add constraint sales_orders_status_check
  check (status in ('OPEN', 'SHIPPED', 'CANCELLED'));

alter table stock_transactions drop constraint stock_transactions_txn_type_check;
alter table stock_transactions add constraint stock_transactions_txn_type_check
  check (txn_type in (
    'RECEIPT', 'IQC_OUT', 'IQC_PASS', 'IQC_HOLD', 'IQC_NG', 'WIP_REQUEST_OUT',
    'FG_PASS', 'FG_HOLD', 'FG_NG', 'OQC_OUT', 'OQC_HOLD', 'OQC_NG', 'SHIPMENT_OUT'
  ));

create table shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_no text not null unique,
  so_id uuid not null references sales_orders (id),
  shipped_by uuid references user_profiles (id),
  shipped_at timestamptz not null default now()
);

create trigger audit_shipments
  after insert or update or delete on shipments
  for each row execute function audit_trigger_fn();

create table shipment_boxes (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments (id),
  box_no integer not null,
  unique (shipment_id, box_no)
);

create trigger audit_shipment_boxes
  after insert or update or delete on shipment_boxes
  for each row execute function audit_trigger_fn();

create table shipment_box_lines (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references shipment_boxes (id),
  allocation_id uuid not null unique references allocations (id),
  qty numeric not null check (qty > 0)
);

create trigger audit_shipment_box_lines
  after insert or update or delete on shipment_box_lines
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- confirm_shipment: header + every box + every line's real stock cut,
-- in one transaction. p_boxes: jsonb array of
-- {box_no, allocation_ids: uuid[]}
-- ---------------------------------------------------------------------
create or replace function confirm_shipment(p_so_id uuid, p_boxes jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so_status text;
  v_shipment_no text;
  v_shipment_id uuid;
  v_box jsonb;
  v_box_id uuid;
  v_alloc_id uuid;
  v_alloc record;
  v_oqc_passed boolean;
  v_all_shipped boolean;
begin
  if not has_permission('shipping', 'create') then
    raise exception 'Permission denied for shipping.create';
  end if;

  select status into v_so_status from sales_orders where id = p_so_id;
  if not found then
    raise exception 'Sales order not found';
  end if;
  if v_so_status <> 'OPEN' then
    raise exception 'Sales order is not OPEN (status = %)', v_so_status;
  end if;

  if jsonb_array_length(p_boxes) = 0 then
    raise exception 'p_boxes must contain at least one box';
  end if;

  v_shipment_no := generate_document_number('shipment');

  insert into shipments (shipment_no, so_id, shipped_by)
  values (v_shipment_no, p_so_id, auth.uid())
  returning id into v_shipment_id;

  for v_box in select * from jsonb_array_elements(p_boxes)
  loop
    insert into shipment_boxes (shipment_id, box_no)
    values (v_shipment_id, (v_box ->> 'box_no')::integer)
    returning id into v_box_id;

    for v_alloc_id in select * from jsonb_array_elements_text(v_box -> 'allocation_ids')
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
      if v_alloc.status <> 'PICKED' then
        raise exception 'Allocation % is not PICKED (status = %)', v_alloc_id, v_alloc.status;
      end if;

      select exists (
        select 1 from picking_lines pl
        join oqc_inspections oi on oi.picking_id = pl.picking_id
        where pl.allocation_id = v_alloc_id and oi.result = 'PASS'
      ) into v_oqc_passed;

      if not v_oqc_passed then
        raise exception 'Allocation % has not passed OQC — cannot ship', v_alloc_id;
      end if;

      -- lock the source row before cutting it for real
      perform 1 from stock_balance
      where lot_id = v_alloc.lot_id and location_id = v_alloc.location_id
      for update;

      update stock_balance
      set qty = qty - v_alloc.qty, reserved_qty = reserved_qty - v_alloc.qty
      where lot_id = v_alloc.lot_id and location_id = v_alloc.location_id;

      insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
      values (v_alloc.lot_id, v_alloc.location_id, -v_alloc.qty, 'SHIPMENT_OUT', 'shipment', v_shipment_id, auth.uid());

      insert into shipment_box_lines (box_id, allocation_id, qty)
      values (v_box_id, v_alloc_id, v_alloc.qty);

      update allocations set status = 'SHIPPED' where id = v_alloc_id;
    end loop;
  end loop;

  -- auto-advance the SO to SHIPPED once every line is fully covered by
  -- SHIPPED allocations — mirrors the PARTIAL_RECEIVED/COMPLETED
  -- auto-roll pattern from Phase 6's confirm_goods_receipt().
  select bool_and(coalesce(shipped.qty, 0) >= sol.qty)
  into v_all_shipped
  from sales_order_lines sol
  left join (
    select so_line_id, sum(qty) as qty
    from allocations
    where status = 'SHIPPED'
    group by so_line_id
  ) shipped on shipped.so_line_id = sol.id
  where sol.so_id = p_so_id;

  if v_all_shipped then
    update sales_orders set status = 'SHIPPED' where id = p_so_id;
  end if;

  return v_shipment_id;
end;
$$;

-- ---------------------------------------------------------------------
-- get_shipping_queue: PICKED allocations whose picking has passed OQC,
-- ready to pack and ship.
-- ---------------------------------------------------------------------
create or replace function get_shipping_queue()
returns table (
  allocation_id uuid,
  so_id uuid,
  so_no text,
  customer_code text,
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
    a.id, so.id, so.so_no, c.code, i.id, i.part_no,
    l.id, l.lot_no, loc.id, loc.code, a.qty
  from allocations a
  join sales_order_lines sol on sol.id = a.so_line_id
  join sales_orders so on so.id = sol.so_id
  join customers c on c.id = so.customer_id
  join items i on i.id = sol.item_id
  join lots l on l.id = a.lot_id
  join locations loc on loc.id = a.location_id
  join picking_lines pl on pl.allocation_id = a.id
  join oqc_inspections oi on oi.picking_id = pl.picking_id and oi.result = 'PASS'
  where a.status = 'PICKED'
    and so.status = 'OPEN'
    and has_permission('shipping', 'view');
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table shipments enable row level security;
alter table shipment_boxes enable row level security;
alter table shipment_box_lines enable row level security;

create policy "View shipments" on shipments for select to authenticated using (has_permission('shipping', 'view'));
create policy "View shipment_boxes" on shipment_boxes for select to authenticated using (has_permission('shipping', 'view'));
create policy "View shipment_box_lines" on shipment_box_lines for select to authenticated using (has_permission('shipping', 'view'));
-- No insert/update/delete policy: only confirm_shipment() (security
-- definer) writes these tables.
