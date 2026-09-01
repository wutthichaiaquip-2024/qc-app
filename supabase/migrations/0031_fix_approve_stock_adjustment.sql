-- Phase 23 (bugfix, found by the UAT scenario it exists to satisfy):
-- approve_stock_adjustment()'s stock_balance write used the same
-- "insert ... on conflict do update" pattern every other confirm_*()
-- function uses when it only ever ADDS stock. That pattern breaks for
-- a negative qty_delta: Postgres validates the CHECK constraint
-- (qty >= 0) against the literal INSERT row *before* it even considers
-- redirecting to the ON CONFLICT UPDATE branch, so a negative delta on
-- an existing row raised stock_balance_qty_check even though the
-- final (post-update) qty would have been perfectly valid. Fixed by
-- branching explicitly on whether the row already exists (known from
-- the lock already taken above via `found`), instead of relying on
-- ON CONFLICT to do it implicitly.
create or replace function approve_stock_adjustment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adj record;
  v_row_exists boolean;
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

  v_row_exists := found;
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

  if v_row_exists then
    update stock_balance
    set qty = qty + v_adj.qty_delta
    where lot_id = v_adj.lot_id and location_id = v_adj.location_id;
  else
    insert into stock_balance (lot_id, location_id, qty)
    values (v_adj.lot_id, v_adj.location_id, v_adj.qty_delta);
  end if;

  update stock_adjustments
  set status = 'APPROVED', decided_by = auth.uid(), decided_at = now()
  where id = p_id;
end;
$$;
