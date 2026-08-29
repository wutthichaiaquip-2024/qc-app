-- Phase 4: Demand & Stock Planning
-- Projected Stock / Coverage / Shortage / Surplus / Purchase Requirement,
-- refreshed as a scheduled job (pg_cron, hourly) rather than a live
-- query per page load, per section 3 note.
--
-- IMPORTANT: this system is only at Phase 4. Customer Order (Phase 12),
-- FG Stock (Phase 11), WIP Stock (Phase 8), Receiving/Incoming (Phase 6)
-- and Purchase Order (Phase 5) don't exist yet, so those five inputs
-- are hardcoded to 0 below with a TODO marking exactly which phase
-- replaces them with a real subquery. Forecast + Safety Stock + Lead
-- Time are real (Phase 2/3). Until those TODOs are resolved, every
-- number here is partial — the UI must say so, not present it as final.

create table stock_planning_snapshot (
  item_id uuid primary key references items (id),
  calculated_at timestamptz not null default now(),
  forecast_qty numeric not null default 0,
  customer_order_qty numeric not null default 0,
  fg_stock_qty numeric not null default 0,
  wip_stock_qty numeric not null default 0,
  incoming_qty numeric not null default 0,
  open_po_qty numeric not null default 0,
  safety_stock numeric not null default 0,
  lead_time_days integer,
  projected_stock numeric not null default 0,
  shortage_qty numeric not null default 0,
  surplus_qty numeric not null default 0,
  purchase_requirement_qty numeric not null default 0,
  status text not null check (status in ('GREEN', 'YELLOW', 'RED'))
);

create or replace function refresh_stock_planning()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from stock_planning_snapshot;

  insert into stock_planning_snapshot (
    item_id, forecast_qty, customer_order_qty, fg_stock_qty, wip_stock_qty,
    incoming_qty, open_po_qty, safety_stock, lead_time_days,
    projected_stock, shortage_qty, surplus_qty, purchase_requirement_qty, status
  )
  with latest_forecast_line as (
    -- latest version per (item, month, customer), from non-draft/non-cancelled batches only
    select distinct on (fl.item_id, fl.forecast_month, fb.customer_id)
      fl.item_id, fl.forecast_month, fl.forecast_qty
    from forecast_lines fl
    join forecast_batches fb on fb.id = fl.batch_id
    where fb.status in ('SUBMITTED', 'APPROVED')
    order by fl.item_id, fl.forecast_month, fb.customer_id, fl.version desc
  ),
  next_month_forecast as (
    select item_id, sum(forecast_qty) as forecast_qty
    from latest_forecast_line
    where forecast_month = date_trunc('month', current_date + interval '1 month')::date
    group by item_id
  ),
  components as (
    select
      i.id as item_id,
      coalesce(nmf.forecast_qty, 0) as forecast_qty,
      0::numeric as customer_order_qty,  -- TODO Phase 12 (Customer Order): sum reserved/open SO qty
      0::numeric as fg_stock_qty,        -- TODO Phase 11 (FG Stock): sum available qty
      0::numeric as wip_stock_qty,       -- TODO Phase 8 (WIP Stock): sum qty
      0::numeric as incoming_qty,        -- TODO Phase 6 (Receiving): qty pending IQC
      0::numeric as open_po_qty,         -- TODO Phase 5 (Purchase Order): sum open PO qty not yet received
      i.safety_stock,
      i.lead_time_days
    from items i
    left join next_month_forecast nmf on nmf.item_id = i.id
    where i.status = 'ACTIVE'
  )
  select
    item_id,
    forecast_qty,
    customer_order_qty,
    fg_stock_qty,
    wip_stock_qty,
    incoming_qty,
    open_po_qty,
    safety_stock,
    lead_time_days,
    (fg_stock_qty + wip_stock_qty + incoming_qty + open_po_qty - customer_order_qty - forecast_qty) as projected_stock,
    greatest(0, -(fg_stock_qty + wip_stock_qty + incoming_qty + open_po_qty - customer_order_qty - forecast_qty)) as shortage_qty,
    greatest(0, (fg_stock_qty + wip_stock_qty + incoming_qty + open_po_qty - customer_order_qty - forecast_qty) - safety_stock) as surplus_qty,
    greatest(0, safety_stock + forecast_qty - (fg_stock_qty + wip_stock_qty + incoming_qty + open_po_qty - customer_order_qty)) as purchase_requirement_qty,
    case
      when (fg_stock_qty + wip_stock_qty + incoming_qty + open_po_qty - customer_order_qty - forecast_qty) < 0 then 'RED'
      when (fg_stock_qty + wip_stock_qty + incoming_qty + open_po_qty - customer_order_qty - forecast_qty) < safety_stock then 'YELLOW'
      else 'GREEN'
    end
  from components;
end;
$$;

revoke execute on function refresh_stock_planning from public, anon;
grant execute on function refresh_stock_planning to authenticated;

-- Populate once immediately so the dashboard isn't empty before the
-- first scheduled run.
select refresh_stock_planning();

alter table stock_planning_snapshot enable row level security;

create policy "View stock_planning_snapshot" on stock_planning_snapshot
  for select to authenticated using (has_permission('planning', 'view'));

-- ---------------------------------------------------------------------
-- Hourly scheduled refresh via pg_cron (per section 3 note: this must
-- not be a live query on every page load).
-- ---------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'refresh-stock-planning-hourly',
  '0 * * * *',
  $$select refresh_stock_planning();$$
);
