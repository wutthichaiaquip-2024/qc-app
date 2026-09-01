-- Phase 15: OQC / Final QC
-- Final checklist-based inspection on already-picked goods, one overall
-- result per picking (not split-lot like IQC/FG — OQC is a final
-- visual/documentation check on the packed goods as a whole, not a
-- sampling-based quantity split). Part No./Customer/Quantity/Lot are
-- reference fields derived from the picking chain, not re-entered.
--
-- PASS: nothing changes — the allocation stays PICKED, ready for
-- Phase 16 to actually ship it.
-- HOLD/NG: "วนกลับเข้า Rework/Hold queue" is a real stock move, not
-- just a status label — stock physically moves out of the FG location
-- into HOLD/REWORK, and the allocation is released so the sales order
-- line can be re-fulfilled from other good stock.

create table oqc_inspections (
  id uuid primary key default gen_random_uuid(),
  oqc_no text not null unique,
  picking_id uuid not null unique references pickings (id),
  so_id uuid not null references sales_orders (id),
  result text not null check (result in ('PASS', 'HOLD', 'NG')),
  inspected_by uuid references user_profiles (id),
  inspected_at timestamptz not null default now()
);

create trigger audit_oqc_inspections
  after insert or update or delete on oqc_inspections
  for each row execute function audit_trigger_fn();

create table oqc_checklist_items (
  id uuid primary key default gen_random_uuid(),
  oqc_id uuid not null references oqc_inspections (id),
  item_name text not null check (item_name in (
    'APPEARANCE', 'PACKAGING', 'LABEL', 'CUSTOMER_REQUIREMENT', 'CERTIFICATE', 'PACKING_LIST'
  )),
  result text not null check (result in ('PASS', 'FAIL')),
  note text
);

create trigger audit_oqc_checklist_items
  after insert or update or delete on oqc_checklist_items
  for each row execute function audit_trigger_fn();

alter table stock_transactions drop constraint stock_transactions_txn_type_check;
alter table stock_transactions add constraint stock_transactions_txn_type_check
  check (txn_type in (
    'RECEIPT', 'IQC_OUT', 'IQC_PASS', 'IQC_HOLD', 'IQC_NG', 'WIP_REQUEST_OUT',
    'FG_PASS', 'FG_HOLD', 'FG_NG', 'OQC_OUT', 'OQC_HOLD', 'OQC_NG'
  ));

-- ---------------------------------------------------------------------
-- confirm_oqc: one result for the whole picking. p_checklist: jsonb
-- array of {item_name, result, note}.
-- ---------------------------------------------------------------------
create or replace function confirm_oqc(
  p_picking_id uuid,
  p_result text,
  p_checklist jsonb,
  p_target_location_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so_id uuid;
  v_oqc_no text;
  v_oqc_id uuid;
  v_item jsonb;
  v_line record;
  v_zone text;
begin
  if not has_permission('oqc', 'create') then
    raise exception 'Permission denied for oqc.create';
  end if;

  if p_result not in ('PASS', 'HOLD', 'NG') then
    raise exception 'Invalid result: %', p_result;
  end if;

  select so_id into v_so_id from pickings where id = p_picking_id;
  if not found then
    raise exception 'Picking not found';
  end if;
  if exists (select 1 from oqc_inspections where picking_id = p_picking_id) then
    raise exception 'This picking has already been OQC-inspected';
  end if;

  if p_result <> 'PASS' then
    if p_target_location_id is null then
      raise exception 'HOLD/NG result requires a target location';
    end if;
    select zone_type into v_zone from locations where id = p_target_location_id;
    if v_zone not in ('HOLD', 'REWORK') then
      raise exception 'Target location must be zone_type HOLD or REWORK (got %)', v_zone;
    end if;
  end if;

  v_oqc_no := generate_document_number('oqc');

  insert into oqc_inspections (oqc_no, picking_id, so_id, result, inspected_by)
  values (v_oqc_no, p_picking_id, v_so_id, p_result, auth.uid())
  returning id into v_oqc_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_checklist, '[]'::jsonb))
  loop
    insert into oqc_checklist_items (oqc_id, item_name, result, note)
    values (
      v_oqc_id,
      v_item ->> 'item_name',
      v_item ->> 'result',
      nullif(v_item ->> 'note', '')
    );
  end loop;

  if p_result <> 'PASS' then
    for v_line in
      select pl.allocation_id, a.lot_id, a.location_id, a.qty
      from picking_lines pl
      join allocations a on a.id = pl.allocation_id
      where pl.picking_id = p_picking_id
    loop
      -- Lock the row; no availability check needed — reserved_qty
      -- already covers this allocation's qty, this converts an
      -- existing reservation into a real move, not a new claim.
      perform 1 from stock_balance
      where lot_id = v_line.lot_id and location_id = v_line.location_id
      for update;

      update stock_balance
      set qty = qty - v_line.qty, reserved_qty = reserved_qty - v_line.qty
      where lot_id = v_line.lot_id and location_id = v_line.location_id;

      insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
      values (v_line.lot_id, v_line.location_id, -v_line.qty, 'OQC_OUT', 'oqc_inspection', v_oqc_id, auth.uid());

      insert into stock_balance (lot_id, location_id, qty)
      values (v_line.lot_id, p_target_location_id, v_line.qty)
      on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

      insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
      values (
        v_line.lot_id, p_target_location_id, v_line.qty,
        case when p_result = 'HOLD' then 'OQC_HOLD' else 'OQC_NG' end,
        'oqc_inspection', v_oqc_id, auth.uid()
      );

      update allocations set status = 'RELEASED' where id = v_line.allocation_id;
    end loop;
  end if;

  return v_oqc_id;
end;
$$;

-- ---------------------------------------------------------------------
-- get_oqc_queue: pickings not yet OQC-inspected, with reference fields
-- (Part No., Customer, Quantity, Lot) per line.
-- ---------------------------------------------------------------------
create or replace function get_oqc_queue()
returns table (
  picking_id uuid,
  picking_no text,
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
    p.id, p.picking_no, so.id, so.so_no, c.code,
    i.id, i.part_no, l.id, l.lot_no, loc.id, loc.code, a.qty
  from pickings p
  join sales_orders so on so.id = p.so_id
  join customers c on c.id = so.customer_id
  join picking_lines pl on pl.picking_id = p.id
  join allocations a on a.id = pl.allocation_id
  join lots l on l.id = a.lot_id
  join items i on i.id = l.item_id
  join locations loc on loc.id = a.location_id
  where not exists (select 1 from oqc_inspections oi where oi.picking_id = p.id)
    and has_permission('oqc', 'view');
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table oqc_inspections enable row level security;
alter table oqc_checklist_items enable row level security;

create policy "View oqc_inspections" on oqc_inspections for select to authenticated using (has_permission('oqc', 'view'));
create policy "View oqc_checklist_items" on oqc_checklist_items for select to authenticated using (has_permission('oqc', 'view'));
-- No insert/update/delete policy: only confirm_oqc() (security
-- definer) writes these tables.
