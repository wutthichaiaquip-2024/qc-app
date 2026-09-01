-- Phase 23 (cont.): small lookup so the Stock Adjustment request form
-- can offer a lot+location picker with real ids — Phase 21's
-- get_stock_report() deliberately only exposes human-readable
-- lot_no/location_code (it's an export/report, not a form data
-- source), so this is a separate function rather than changing an
-- already-shipped, already-tested one. Gated by stock_adjustments.create
-- specifically: if you can request an adjustment, you can see what
-- stock exists to adjust.
create or replace function get_stock_positions()
returns table (
  lot_id uuid,
  location_id uuid,
  lot_no text,
  part_no text,
  location_code text,
  qty numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select sb.lot_id, sb.location_id, l.lot_no, i.part_no, loc.code, sb.qty
  from stock_balance sb
  join lots l on l.id = sb.lot_id
  join items i on i.id = l.item_id
  join locations loc on loc.id = sb.location_id
  where has_permission('stock_adjustments', 'create')
  order by i.part_no, l.lot_no;
$$;

revoke execute on function get_stock_positions from public, anon;
grant execute on function get_stock_positions to authenticated;
