-- Phase 19: Forecast Accuracy
-- Compares Forecast vs Actual Order vs Actual Shipment, per
-- (customer, item, forecast month). A live SECURITY DEFINER function,
-- not a cached/materialized view like Phase 4/18 — the doc says
-- "หลัง Shipment ทุกครั้ง" (after every shipment), and a plain query
-- against current data is inherently always up to date after the
-- latest shipment without needing an extra refresh trigger.
--
-- "ป้อนกลับเข้า Phase 4" is implemented as: this data is available for
-- Planning to look at alongside the Phase 4 dashboard. It deliberately
-- does NOT auto-adjust Phase 4's shortage/surplus formula — changing
-- that calculation's behavior based on historical accuracy is a real
-- business-logic decision, not something to assume silently.
--
-- All three quantities are bucketed by the sales order line's own
-- delivery_date month, not by when things happened to post (order
-- date, shipped_at) — that keeps forecast/actual-order/actual-shipment
-- anchored to the same "need period" the customer originally named,
-- which is what a forecast accuracy comparison is supposed to measure.

create or replace function get_forecast_accuracy()
returns table (
  customer_id uuid,
  customer_code text,
  item_id uuid,
  part_no text,
  forecast_month date,
  forecast_qty numeric,
  actual_order_qty numeric,
  actual_shipment_qty numeric,
  accuracy_pct numeric,
  bias_pct numeric,
  variance_qty numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with latest_forecast_line as (
    select distinct on (fl.item_id, fl.forecast_month, fb.customer_id)
      fl.item_id, fl.forecast_month, fb.customer_id, fl.forecast_qty
    from forecast_lines fl
    join forecast_batches fb on fb.id = fl.batch_id
    where fb.status in ('SUBMITTED', 'APPROVED')
    order by fl.item_id, fl.forecast_month, fb.customer_id, fl.version desc
  ),
  actual_orders as (
    select so.customer_id, sol.item_id, date_trunc('month', sol.delivery_date)::date as month, sum(sol.qty) as qty
    from sales_order_lines sol
    join sales_orders so on so.id = sol.so_id
    where sol.delivery_date is not null
    group by so.customer_id, sol.item_id, date_trunc('month', sol.delivery_date)
  ),
  actual_shipments as (
    select so.customer_id, sol.item_id, date_trunc('month', sol.delivery_date)::date as month, sum(a.qty) as qty
    from allocations a
    join sales_order_lines sol on sol.id = a.so_line_id
    join sales_orders so on so.id = sol.so_id
    where a.status = 'SHIPPED' and sol.delivery_date is not null
    group by so.customer_id, sol.item_id, date_trunc('month', sol.delivery_date)
  ),
  keys as (
    select customer_id, item_id, forecast_month as month from latest_forecast_line
    union
    select customer_id, item_id, month from actual_orders
    union
    select customer_id, item_id, month from actual_shipments
  )
  select
    k.customer_id,
    c.code,
    k.item_id,
    i.part_no,
    k.month,
    coalesce(lf.forecast_qty, 0),
    coalesce(ao.qty, 0),
    coalesce(asx.qty, 0),
    case when coalesce(lf.forecast_qty, 0) > 0
      then greatest(0, round(100 - abs(coalesce(asx.qty, 0) - lf.forecast_qty) / lf.forecast_qty * 100, 1))
      else null end as accuracy_pct,
    case when coalesce(lf.forecast_qty, 0) > 0
      then round((coalesce(asx.qty, 0) - lf.forecast_qty) / lf.forecast_qty * 100, 1)
      else null end as bias_pct,
    coalesce(asx.qty, 0) - coalesce(lf.forecast_qty, 0) as variance_qty
  from keys k
  join customers c on c.id = k.customer_id
  join items i on i.id = k.item_id
  left join latest_forecast_line lf on lf.customer_id = k.customer_id and lf.item_id = k.item_id and lf.forecast_month = k.month
  left join actual_orders ao on ao.customer_id = k.customer_id and ao.item_id = k.item_id and ao.month = k.month
  left join actual_shipments asx on asx.customer_id = k.customer_id and asx.item_id = k.item_id and asx.month = k.month
  where has_permission('planning', 'view')
  order by k.month desc, c.code, i.part_no;
$$;
