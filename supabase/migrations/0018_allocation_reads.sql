-- Phase 13 (cont.): get_open_so_lines() follows the same pattern as
-- get_wip_stock()/get_fg_stock() — gated by has_permission('allocation',
-- 'view') alone, so allocating stock doesn't also require separate
-- view permissions on sales_orders/customers/master_data.
create or replace function get_open_so_lines()
returns table (
  so_line_id uuid,
  so_id uuid,
  so_no text,
  customer_code text,
  site_id uuid,
  item_id uuid,
  part_no text,
  qty numeric,
  allocated_qty numeric,
  remaining_qty numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sol.id, so.id, so.so_no, c.code, so.site_id, i.id, i.part_no,
    sol.qty,
    coalesce(a.allocated_qty, 0),
    sol.qty - coalesce(a.allocated_qty, 0)
  from sales_order_lines sol
  join sales_orders so on so.id = sol.so_id
  join customers c on c.id = so.customer_id
  join items i on i.id = sol.item_id
  left join (
    select so_line_id, sum(qty) as allocated_qty
    from allocations
    where status = 'ACTIVE'
    group by so_line_id
  ) a on a.so_line_id = sol.id
  where so.status = 'OPEN'
    and sol.qty > coalesce(a.allocated_qty, 0)
    and has_permission('allocation', 'view');
$$;
