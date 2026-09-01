-- Phase 12: Customer Order
-- No price/value fields on the SO or its lines — confirmed scope
-- decision before Phase 0 (see PROJECT_STATE.md). Free Stock is
-- checked live during order entry (get_fg_free_stock), unlike Phase
-- 4's Demand & Stock Planning which is deliberately a scheduled job —
-- this is a real-time decision aid for the person taking the order,
-- not a dashboard refreshed hourly.

create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  so_no text not null unique,
  customer_id uuid not null references customers (id),
  order_date date not null default current_date,
  required_date date,
  status text not null default 'OPEN' check (status in ('OPEN', 'CANCELLED')),
  created_by uuid references user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sales_orders_set_updated_at
  before update on sales_orders
  for each row execute function set_updated_at();

create trigger audit_sales_orders
  after insert or update or delete on sales_orders
  for each row execute function audit_trigger_fn();

create table sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  so_id uuid not null references sales_orders (id),
  line_no integer not null,
  item_id uuid not null references items (id),
  qty numeric not null check (qty > 0),
  delivery_date date,
  created_at timestamptz not null default now(),
  unique (so_id, line_no)
);

create trigger audit_sales_order_lines
  after insert or update or delete on sales_order_lines
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- get_fg_free_stock: live Free Stock = sum(qty - reserved_qty) across
-- all FG-zone locations for an item. Called during order entry, not
-- cached — this is a small, cheap aggregate over already-indexed rows.
-- ---------------------------------------------------------------------
create or replace function get_fg_free_stock(p_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(sb.qty - sb.reserved_qty), 0)
  from stock_balance sb
  join lots l on l.id = sb.lot_id
  join locations loc on loc.id = sb.location_id
  where l.item_id = p_item_id
    and loc.zone_type = 'FG'
    and has_permission('fg_stock', 'view');
$$;

-- ---------------------------------------------------------------------
-- create_sales_order: header + lines in one transaction.
-- p_lines: jsonb array of {item_id, qty, delivery_date}
-- ---------------------------------------------------------------------
create or replace function create_sales_order(
  p_customer_id uuid,
  p_order_date date,
  p_required_date date,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so_id uuid;
  v_so_no text;
  v_line jsonb;
  v_line_no integer := 0;
begin
  if not has_permission('sales_orders', 'create') then
    raise exception 'Permission denied for sales_orders.create';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'p_lines must contain at least one line';
  end if;

  v_so_no := generate_document_number('sales_order');

  insert into sales_orders (so_no, customer_id, order_date, required_date, created_by)
  values (v_so_no, p_customer_id, coalesce(p_order_date, current_date), p_required_date, auth.uid())
  returning id into v_so_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    insert into sales_order_lines (so_id, line_no, item_id, qty, delivery_date)
    values (
      v_so_id,
      v_line_no,
      (v_line ->> 'item_id')::uuid,
      (v_line ->> 'qty')::numeric,
      nullif(v_line ->> 'delivery_date', '')::date
    );
  end loop;

  return v_so_id;
end;
$$;

create or replace function cancel_sales_order(p_so_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('sales_orders', 'reject') then
    raise exception 'Permission denied for sales_orders.reject';
  end if;

  select status into v_status from sales_orders where id = p_so_id;
  if not found then
    raise exception 'Sales order not found';
  end if;
  if v_status <> 'OPEN' then
    raise exception 'Sales order is not OPEN (status = %)', v_status;
  end if;

  update sales_orders set status = 'CANCELLED' where id = p_so_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table sales_orders enable row level security;
alter table sales_order_lines enable row level security;

create policy "View sales_orders" on sales_orders
  for select to authenticated using (has_permission('sales_orders', 'view'));

create policy "View sales_order_lines" on sales_order_lines
  for select to authenticated using (has_permission('sales_orders', 'view'));
-- No insert/update/delete policy: only the RPCs above (security
-- definer) write these tables.
