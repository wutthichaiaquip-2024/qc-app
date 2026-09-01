-- Phase 6: Receiving
-- First phase that touches physical stock, so the full set of
-- principles from section 3 applies: single DB transaction, row-locked
-- stock_balance, append-only stock_transactions ledger, sequence-based
-- document numbering, RLS per table.

insert into document_number_config (doc_type, prefix) values ('lot', 'LOT');

alter table purchase_orders add column barcode_value text unique;

create table lots (
  id uuid primary key default gen_random_uuid(),
  lot_no text not null unique,
  item_id uuid not null references items (id),
  barcode_value text unique,
  created_at timestamptz not null default now()
);

create trigger audit_lots
  after insert or update or delete on lots
  for each row execute function audit_trigger_fn();

-- One row per (lot, location): a lot's qty can be split across
-- locations (e.g. after IQC splits pass/hold/ng into different zones).
create table stock_balance (
  lot_id uuid not null references lots (id),
  location_id uuid not null references locations (id),
  qty numeric not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (lot_id, location_id)
);

create trigger stock_balance_set_updated_at
  before update on stock_balance
  for each row execute function set_updated_at();

create trigger audit_stock_balance
  after insert or update or delete on stock_balance
  for each row execute function audit_trigger_fn();

-- Append-only ledger. txn_type grows as later phases add more kinds of
-- stock movement (IQC split, WIP request, picking, shipment, ...) —
-- each phase widens this check constraint, never removes a value.
create table stock_transactions (
  id bigint generated always as identity primary key,
  lot_id uuid not null references lots (id),
  location_id uuid not null references locations (id),
  qty_delta numeric not null check (qty_delta <> 0),
  txn_type text not null check (txn_type in ('RECEIPT')),
  ref_type text not null,
  ref_id uuid not null,
  created_by uuid references user_profiles (id),
  created_at timestamptz not null default now()
);

create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  gr_no text not null unique,
  po_id uuid not null references purchase_orders (id),
  received_date date not null default current_date,
  received_by uuid references user_profiles (id),
  created_at timestamptz not null default now()
);

create trigger audit_goods_receipts
  after insert or update or delete on goods_receipts
  for each row execute function audit_trigger_fn();

create table goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  gr_id uuid not null references goods_receipts (id),
  po_line_id uuid not null references purchase_order_lines (id),
  item_id uuid not null references items (id),
  qty_received numeric not null check (qty_received > 0),
  lot_id uuid not null references lots (id),
  location_id uuid not null references locations (id),
  created_at timestamptz not null default now()
);

create trigger audit_goods_receipt_lines
  after insert or update or delete on goods_receipt_lines
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- confirm_goods_receipt: header + every line's lot creation + stock
-- ledger entry, in one transaction. Each line must target a location
-- whose zone_type = 'INCOMING' (the doc's "status=INCOMING" rule),
-- enforced here rather than trusted to the UI. Also rolls the parent
-- PO's status forward to PARTIAL_RECEIVED/COMPLETED based on total
-- received vs. ordered qty across all its lines — deliberately NOT
-- going through update_purchase_order_status(), whose transition map
-- excludes those two statuses on purpose (see Phase 5).
-- p_lines: jsonb array of {po_line_id, qty_received, location_id}
-- ---------------------------------------------------------------------
create or replace function confirm_goods_receipt(p_po_id uuid, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_status text;
  v_gr_id uuid;
  v_gr_no text;
  v_line jsonb;
  v_po_line_id uuid;
  v_qty numeric;
  v_location_id uuid;
  v_zone_type text;
  v_item_id uuid;
  v_lot_id uuid;
  v_lot_no text;
  v_all_complete boolean;
  v_any_received boolean;
begin
  if not has_permission('receiving', 'create') then
    raise exception 'Permission denied for receiving.create';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'p_lines must contain at least one line';
  end if;

  select status into v_po_status from purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found';
  end if;
  if v_po_status not in ('CONFIRMED', 'PARTIAL_RECEIVED') then
    raise exception 'Cannot receive against a PO in status %', v_po_status;
  end if;

  v_gr_no := generate_document_number('goods_receipt');
  insert into goods_receipts (gr_no, po_id, received_by)
  values (v_gr_no, p_po_id, auth.uid())
  returning id into v_gr_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_po_line_id := (v_line ->> 'po_line_id')::uuid;
    v_qty := (v_line ->> 'qty_received')::numeric;
    v_location_id := (v_line ->> 'location_id')::uuid;

    select item_id into v_item_id from purchase_order_lines where id = v_po_line_id and po_id = p_po_id;
    if not found then
      raise exception 'PO line % does not belong to PO %', v_po_line_id, p_po_id;
    end if;

    select zone_type into v_zone_type from locations where id = v_location_id;
    if v_zone_type is distinct from 'INCOMING' then
      raise exception 'Receiving location must be zone_type = INCOMING (got %)', v_zone_type;
    end if;

    v_lot_no := generate_document_number('lot');
    insert into lots (lot_no, item_id) values (v_lot_no, v_item_id) returning id into v_lot_id;

    insert into goods_receipt_lines (gr_id, po_line_id, item_id, qty_received, lot_id, location_id)
    values (v_gr_id, v_po_line_id, v_item_id, v_qty, v_lot_id, v_location_id);

    -- fresh lot, so no concurrent writer could already hold this row —
    -- still use the same atomic upsert shape used everywhere else.
    insert into stock_balance (lot_id, location_id, qty)
    values (v_lot_id, v_location_id, v_qty)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (v_lot_id, v_location_id, v_qty, 'RECEIPT', 'goods_receipt_line',
            (select id from goods_receipt_lines where gr_id = v_gr_id and po_line_id = v_po_line_id order by created_at desc limit 1),
            auth.uid());
  end loop;

  -- roll PO status forward based on total received vs. ordered, per line
  select
    bool_and(coalesce(received.qty, 0) >= pol.qty),
    bool_or(coalesce(received.qty, 0) > 0)
  into v_all_complete, v_any_received
  from purchase_order_lines pol
  left join (
    select po_line_id, sum(qty_received) as qty
    from goods_receipt_lines
    group by po_line_id
  ) received on received.po_line_id = pol.id
  where pol.po_id = p_po_id;

  update purchase_orders
  set status = case when v_all_complete then 'COMPLETED' when v_any_received then 'PARTIAL_RECEIVED' else status end
  where id = p_po_id;

  return v_gr_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table lots enable row level security;
alter table stock_balance enable row level security;
alter table stock_transactions enable row level security;
alter table goods_receipts enable row level security;
alter table goods_receipt_lines enable row level security;

create policy "View lots" on lots for select to authenticated using (has_permission('receiving', 'view'));
create policy "View stock_balance" on stock_balance for select to authenticated using (has_permission('receiving', 'view'));
create policy "View stock_transactions" on stock_transactions for select to authenticated using (has_permission('receiving', 'view'));
create policy "View goods_receipts" on goods_receipts for select to authenticated using (has_permission('receiving', 'view'));
create policy "View goods_receipt_lines" on goods_receipt_lines for select to authenticated using (has_permission('receiving', 'view'));
-- No insert/update/delete policies anywhere here: everything is
-- written only by confirm_goods_receipt (security definer). lots,
-- stock_balance and stock_transactions have no direct mutation path at
-- all from the API, matching the append-only-ledger principle.
