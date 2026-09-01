-- Phase 11: FG Stock
-- Read-only view (get_fg_stock(), same pattern as Phase 8's
-- get_wip_stock()) plus reserved_qty on stock_balance so
-- Available Qty = qty - reserved_qty is meaningful once Phase 13
-- (Stock Allocation) starts writing to it — it stays 0 until then.
--
-- Also implements "เข้า FG Stock ได้เฉพาะที่ผ่าน FG Inspection แล้วเท่านั้น
-- (บังคับผ่าน DB constraint)" as an actual trigger-enforced invariant,
-- not just "nothing else happens to call it that way": any row landing
-- in an FG-zone location must have a corresponding FG_PASS ledger
-- entry for that same (lot, location), checked at the DB level
-- regardless of which code path attempts the write.

alter table stock_balance add column reserved_qty numeric not null default 0;
alter table stock_balance add constraint stock_balance_reserved_qty_check check (reserved_qty >= 0 and reserved_qty <= qty);

create or replace function enforce_fg_stock_origin()
returns trigger
language plpgsql
as $$
declare
  v_zone text;
begin
  select zone_type into v_zone from locations where id = new.location_id;

  if v_zone = 'FG' then
    if not exists (
      select 1 from stock_transactions
      where lot_id = new.lot_id and location_id = new.location_id and txn_type = 'FG_PASS'
    ) then
      raise exception 'Stock may only enter an FG location via an FG_PASS transaction (FG Inspection)';
    end if;
  end if;

  return new;
end;
$$;

create trigger check_fg_stock_origin
  before insert or update on stock_balance
  for each row execute function enforce_fg_stock_origin();

-- Re-create confirm_fg_inspection() with the stock_transactions insert
-- moved BEFORE the stock_balance insert for each disposition, so the
-- trigger above sees the FG_PASS ledger entry already committed in
-- this same transaction when it validates the stock_balance write.
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
  v_fg_no text;
  v_lot_no text;
  v_new_lot_id uuid;
  v_fg_id uuid;
  v_char jsonb;
  v_defect jsonb;
  v_zone text;
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

  select * into v_plan from get_sample_size_plan(v_wr.item_id, v_wr.requested_qty::integer);

  v_fg_no := generate_document_number('fg_inspection');
  v_lot_no := generate_document_number('lot');

  insert into lots (lot_no, item_id) values (v_lot_no, v_wr.item_id) returning id into v_new_lot_id;

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
-- get_fg_stock: same pattern as Phase 8's get_wip_stock() — gated by
-- has_permission('fg_stock', 'view') alone, not the underlying tables'
-- own module permissions.
-- ---------------------------------------------------------------------
create or replace function get_fg_stock()
returns table (
  lot_id uuid,
  lot_no text,
  item_id uuid,
  part_no text,
  location_id uuid,
  location_code text,
  qty numeric,
  reserved_qty numeric,
  available_qty numeric,
  fg_inspection_id uuid,
  fg_no text,
  inspected_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sb.lot_id, l.lot_no, l.item_id, i.part_no,
    sb.location_id, loc.code, sb.qty, sb.reserved_qty, sb.qty - sb.reserved_qty,
    fgi.id, fgi.fg_no, fgi.completed_at
  from stock_balance sb
  join lots l on l.id = sb.lot_id
  join items i on i.id = l.item_id
  join locations loc on loc.id = sb.location_id
  left join fg_inspections fgi on fgi.new_lot_id = sb.lot_id
  where loc.zone_type = 'FG'
    and sb.qty > 0
    and has_permission('fg_stock', 'view');
$$;
