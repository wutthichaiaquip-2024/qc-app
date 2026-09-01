-- Phase 23 (prerequisite gap found during Test/UAT planning): Adjustment
-- Transaction. Section 3 of the master spec requires this as a
-- consequence of the append-only ledger rule itself — "ผิดต้องสร้าง
-- Adjustment Transaction ใหม่พร้อมผู้อนุมัติ" (a mistake in
-- stock_transactions can never be UPDATE/DELETE'd, only corrected by a
-- NEW, approved adjustment transaction) — but no phase 1-22 actually
-- built it, and Phase 23 can't test an adjustment-transaction scenario
-- without it existing. Built now, ahead of the UAT scenarios that
-- exercise it.
--
-- Two-step, same shape as every other approval flow in this app
-- (PO status transitions, WIP request confirm): request (creates a
-- PENDING row, no stock movement yet) -> approve (the only step that
-- actually locks stock_balance and writes the ledger, atomically) or
-- reject (no stock movement, ever).

alter table role_permissions drop constraint role_permissions_module_check;
alter table role_permissions add constraint role_permissions_module_check
  check (module in (
    'dashboard', 'forecast', 'planning', 'purchase_orders', 'receiving',
    'iqc', 'wip_stock', 'fg_inspection', 'oqc', 'fg_stock', 'sales_orders',
    'allocation', 'picking', 'shipping', 'traceability', 'reports',
    'master_data', 'users_permissions', 'stock_adjustments'
  ));

insert into role_permissions (role, module, can_view, can_create, can_edit, can_approve, can_reject, can_delete)
select r, 'stock_adjustments', true, (r = 'ADMIN'), (r = 'ADMIN'), (r = 'ADMIN'), (r = 'ADMIN'), (r = 'ADMIN')
from unnest(enum_range(null::app_role)) as r;

alter table stock_transactions drop constraint stock_transactions_txn_type_check;
alter table stock_transactions add constraint stock_transactions_txn_type_check
  check (txn_type in (
    'RECEIPT', 'IQC_OUT', 'IQC_PASS', 'IQC_HOLD', 'IQC_NG', 'WIP_REQUEST_OUT',
    'FG_PASS', 'FG_HOLD', 'FG_NG', 'OQC_OUT', 'OQC_HOLD', 'OQC_NG', 'SHIPMENT_OUT',
    'ADJUSTMENT'
  ));

insert into document_number_config (doc_type, prefix) values ('stock_adjustment', 'ADJ');

create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_no text not null unique,
  lot_id uuid not null references lots (id),
  location_id uuid not null references locations (id),
  qty_delta numeric not null check (qty_delta <> 0),
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by uuid references user_profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references user_profiles (id),
  decided_at timestamptz,
  decision_note text
);

create trigger audit_stock_adjustments
  after insert or update or delete on stock_adjustments
  for each row execute function audit_trigger_fn();

alter table stock_adjustments enable row level security;

create policy "View stock_adjustments" on stock_adjustments
  for select to authenticated using (has_permission('stock_adjustments', 'view'));

-- ---------------------------------------------------------------------
-- request_stock_adjustment: no stock movement — just records the
-- request. qty_delta can be positive (found extra stock) or negative
-- (damage/loss/miscount write-off); zero is rejected by the table's
-- own check constraint.
-- ---------------------------------------------------------------------
create or replace function request_stock_adjustment(
  p_lot_id uuid,
  p_location_id uuid,
  p_qty_delta numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_no text;
begin
  if not has_permission('stock_adjustments', 'create') then
    raise exception 'Permission denied for stock_adjustments.create';
  end if;
  if coalesce(p_qty_delta, 0) = 0 then
    raise exception 'qty_delta must not be 0';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason is required';
  end if;
  if not exists (select 1 from lots where id = p_lot_id) then
    raise exception 'Lot not found';
  end if;
  if not exists (select 1 from locations where id = p_location_id) then
    raise exception 'Location not found';
  end if;

  v_no := generate_document_number('stock_adjustment');

  insert into stock_adjustments (adjustment_no, lot_id, location_id, qty_delta, reason, requested_by)
  values (v_no, p_lot_id, p_location_id, p_qty_delta, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function request_stock_adjustment from public, anon;
grant execute on function request_stock_adjustment to authenticated;

-- ---------------------------------------------------------------------
-- approve_stock_adjustment: the only place that actually moves stock.
-- Locks the adjustment row (must still be PENDING — no double-approve)
-- and the target stock_balance row, in that fixed order, before
-- writing the ledger — same lock-then-write discipline as every other
-- confirm_*() function since Phase 6.
-- ---------------------------------------------------------------------
create or replace function approve_stock_adjustment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adj record;
  v_current_qty numeric;
  v_reserved_qty numeric;
begin
  if not has_permission('stock_adjustments', 'approve') then
    raise exception 'Permission denied for stock_adjustments.approve';
  end if;

  select * into v_adj from stock_adjustments where id = p_id for update;
  if not found then
    raise exception 'Adjustment not found';
  end if;
  if v_adj.status <> 'PENDING' then
    raise exception 'Adjustment is not PENDING (status = %)', v_adj.status;
  end if;

  select qty, reserved_qty into v_current_qty, v_reserved_qty
  from stock_balance
  where lot_id = v_adj.lot_id and location_id = v_adj.location_id
  for update;

  v_current_qty := coalesce(v_current_qty, 0);
  v_reserved_qty := coalesce(v_reserved_qty, 0);

  if v_current_qty + v_adj.qty_delta < 0 then
    raise exception 'Adjustment would take qty below 0 (current %, delta %)', v_current_qty, v_adj.qty_delta;
  end if;
  if v_current_qty + v_adj.qty_delta < v_reserved_qty then
    raise exception 'Adjustment would take qty below already-reserved qty (current %, reserved %, delta %)',
      v_current_qty, v_reserved_qty, v_adj.qty_delta;
  end if;

  insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
  values (v_adj.lot_id, v_adj.location_id, v_adj.qty_delta, 'ADJUSTMENT', 'stock_adjustment', v_adj.id, auth.uid());

  insert into stock_balance (lot_id, location_id, qty)
  values (v_adj.lot_id, v_adj.location_id, v_adj.qty_delta)
  on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

  update stock_adjustments
  set status = 'APPROVED', decided_by = auth.uid(), decided_at = now()
  where id = p_id;
end;
$$;

revoke execute on function approve_stock_adjustment from public, anon;
grant execute on function approve_stock_adjustment to authenticated;

create or replace function reject_stock_adjustment(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('stock_adjustments', 'reject') then
    raise exception 'Permission denied for stock_adjustments.reject';
  end if;

  select status into v_status from stock_adjustments where id = p_id for update;
  if not found then
    raise exception 'Adjustment not found';
  end if;
  if v_status <> 'PENDING' then
    raise exception 'Adjustment is not PENDING (status = %)', v_status;
  end if;

  update stock_adjustments
  set status = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_id;
end;
$$;

revoke execute on function reject_stock_adjustment from public, anon;
grant execute on function reject_stock_adjustment to authenticated;

create or replace function get_stock_adjustments()
returns table (
  id uuid,
  adjustment_no text,
  lot_no text,
  part_no text,
  location_code text,
  qty_delta numeric,
  reason text,
  status text,
  requested_at timestamptz,
  decided_at timestamptz,
  decision_note text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sa.id, sa.adjustment_no, l.lot_no, i.part_no, loc.code,
    sa.qty_delta, sa.reason, sa.status, sa.requested_at, sa.decided_at, sa.decision_note
  from stock_adjustments sa
  join lots l on l.id = sa.lot_id
  join items i on i.id = l.item_id
  join locations loc on loc.id = sa.location_id
  where has_permission('stock_adjustments', 'view')
  order by sa.requested_at desc;
$$;
