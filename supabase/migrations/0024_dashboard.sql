-- Phase 18: Dashboard
-- Management/QC/Warehouse/Planning dashboards, backed by materialized
-- views refreshed on a schedule (pg_cron, same pattern as Phase 4),
-- never a live query against transaction tables.
--
-- Materialized views cannot have RLS policies in Postgres, and their
-- REFRESH runs with no request/JWT context (has_permission() would
-- always return false during a refresh, silently producing empty
-- results if baked into the view query) — so each view is computed
-- unconditionally from raw tables, kept unreadable to authenticated/anon
-- directly, and exposed only through a SECURITY DEFINER wrapper
-- function gated by has_permission('dashboard', 'view'), the same
-- pattern used for every queue-reading function since Phase 8.

create materialized view mv_warehouse_dashboard as
select
  (select coalesce(sum(sb.qty), 0) from stock_balance sb join locations loc on loc.id = sb.location_id where loc.zone_type = 'WIP') as wip_qty,
  (select coalesce(sum(sb.qty), 0) from stock_balance sb join locations loc on loc.id = sb.location_id where loc.zone_type = 'FG') as fg_qty,
  (select coalesce(sum(sb.qty), 0) from stock_balance sb join locations loc on loc.id = sb.location_id where loc.zone_type = 'HOLD') as hold_qty,
  (select coalesce(sum(sb.qty), 0) from stock_balance sb join locations loc on loc.id = sb.location_id where loc.zone_type = 'NG') as ng_qty,
  (select count(*) from wip_requests where status = 'PENDING') as pending_wip_requests,
  (
    select count(distinct a.id)
    from allocations a
    where a.status = 'ACTIVE'
  ) as pending_allocations,
  (
    select count(distinct pk.id)
    from pickings pk
    where not exists (select 1 from oqc_inspections oi where oi.picking_id = pk.id)
  ) as pending_oqc,
  (
    select count(distinct a.id)
    from allocations a
    join picking_lines pl on pl.allocation_id = a.id
    join oqc_inspections oi on oi.picking_id = pl.picking_id and oi.result = 'PASS'
    where a.status = 'PICKED'
  ) as ready_to_ship,
  now() as refreshed_at;

create materialized view mv_qc_dashboard as
select
  (
    select count(distinct sb.lot_id)
    from stock_balance sb
    join locations loc on loc.id = sb.location_id
    where loc.zone_type = 'INCOMING' and sb.qty > 0
  ) as pending_iqc_lots,
  (
    select count(*)
    from wip_requests wr
    where wr.status = 'CONFIRMED'
      and not exists (select 1 from fg_inspections fgi where fgi.wip_request_id = wr.id)
  ) as pending_fg_inspection,
  (
    select count(distinct pk.id)
    from pickings pk
    where not exists (select 1 from oqc_inspections oi where oi.picking_id = pk.id)
  ) as pending_oqc,
  (select coalesce(sum(qty_pass), 0) from iqc_inspections where inspected_at >= now() - interval '30 days') as iqc_pass_qty_30d,
  (select coalesce(sum(qty_hold), 0) from iqc_inspections where inspected_at >= now() - interval '30 days') as iqc_hold_qty_30d,
  (select coalesce(sum(qty_ng), 0) from iqc_inspections where inspected_at >= now() - interval '30 days') as iqc_ng_qty_30d,
  (select coalesce(sum(qty_pass), 0) from fg_inspections where completed_at >= now() - interval '30 days') as fg_pass_qty_30d,
  (select coalesce(sum(qty_hold), 0) from fg_inspections where completed_at >= now() - interval '30 days') as fg_hold_qty_30d,
  (select coalesce(sum(qty_ng), 0) from fg_inspections where completed_at >= now() - interval '30 days') as fg_ng_qty_30d,
  (select count(*) from oqc_inspections where result = 'PASS' and inspected_at >= now() - interval '30 days') as oqc_pass_count_30d,
  (select count(*) from oqc_inspections where result <> 'PASS' and inspected_at >= now() - interval '30 days') as oqc_fail_count_30d,
  now() as refreshed_at;

create materialized view mv_planning_dashboard as
select
  count(*) filter (where status = 'GREEN') as green_count,
  count(*) filter (where status = 'YELLOW') as yellow_count,
  count(*) filter (where status = 'RED') as red_count,
  coalesce(sum(purchase_requirement_qty), 0) as total_purchase_requirement_qty,
  now() as refreshed_at
from stock_planning_snapshot;

create materialized view mv_management_dashboard as
select
  (select count(*) from purchase_orders where status not in ('COMPLETED', 'CANCELLED')) as open_po_count,
  (
    select coalesce(sum(pol.qty * pol.unit_price), 0)
    from purchase_order_lines pol
    join purchase_orders po on po.id = pol.po_id
    where po.status not in ('COMPLETED', 'CANCELLED')
  ) as open_po_value,
  (select count(*) from sales_orders where status = 'OPEN') as open_so_count,
  (select coalesce(sum(sb.qty), 0) from stock_balance sb join locations loc on loc.id = sb.location_id where loc.zone_type = 'FG') as total_fg_qty,
  (select count(*) from shipments where shipped_at >= now() - interval '30 days') as shipments_30d_count,
  (
    select case when sum(qty_pass + qty_hold + qty_ng) > 0
      then round(100.0 * sum(qty_pass) / sum(qty_pass + qty_hold + qty_ng), 1)
      else null end
    from iqc_inspections where inspected_at >= now() - interval '30 days'
  ) as iqc_pass_rate_30d,
  (
    select case when count(*) > 0
      then round(100.0 * count(*) filter (where result = 'PASS') / count(*), 1)
      else null end
    from oqc_inspections where inspected_at >= now() - interval '30 days'
  ) as oqc_pass_rate_30d,
  now() as refreshed_at
from (select 1) as _one;

revoke all on mv_warehouse_dashboard from public, anon, authenticated;
revoke all on mv_qc_dashboard from public, anon, authenticated;
revoke all on mv_planning_dashboard from public, anon, authenticated;
revoke all on mv_management_dashboard from public, anon, authenticated;

create or replace function refresh_dashboards()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view mv_warehouse_dashboard;
  refresh materialized view mv_qc_dashboard;
  refresh materialized view mv_planning_dashboard;
  refresh materialized view mv_management_dashboard;
end;
$$;

revoke execute on function refresh_dashboards from public, anon;
grant execute on function refresh_dashboards to authenticated;

select refresh_dashboards();

create or replace function get_warehouse_dashboard()
returns setof mv_warehouse_dashboard
language sql
stable
security definer
set search_path = public
as $$
  select * from mv_warehouse_dashboard where has_permission('dashboard', 'view');
$$;

create or replace function get_qc_dashboard()
returns setof mv_qc_dashboard
language sql
stable
security definer
set search_path = public
as $$
  select * from mv_qc_dashboard where has_permission('dashboard', 'view');
$$;

create or replace function get_planning_dashboard()
returns setof mv_planning_dashboard
language sql
stable
security definer
set search_path = public
as $$
  select * from mv_planning_dashboard where has_permission('dashboard', 'view');
$$;

create or replace function get_management_dashboard()
returns setof mv_management_dashboard
language sql
stable
security definer
set search_path = public
as $$
  select * from mv_management_dashboard where has_permission('dashboard', 'view');
$$;

-- Hourly refresh, same cadence as Phase 4's stock planning snapshot.
select cron.schedule(
  'refresh-dashboards-hourly',
  '5 * * * *',
  $$select refresh_dashboards();$$
);
