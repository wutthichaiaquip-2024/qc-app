-- Phase 5: Purchase Order
-- PO header + lines, created atomically via RPC (po_no from Phase 0's
-- document numbering). Status workflow only covers the transitions a
-- person triggers manually here — PARTIAL_RECEIVED/COMPLETED are set
-- by Phase 6 (Receiving) once goods actually arrive against a line,
-- not reachable through update_purchase_order_status().

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_no text not null unique,
  supplier_id uuid not null references suppliers (id),
  po_date date not null default current_date,
  currency text not null default 'THB',
  delivery_date date,
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'SUBMITTED', 'CONFIRMED', 'PARTIAL_RECEIVED', 'COMPLETED', 'CANCELLED'
  )),
  created_by uuid references user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger purchase_orders_set_updated_at
  before update on purchase_orders
  for each row execute function set_updated_at();

create trigger audit_purchase_orders
  after insert or update or delete on purchase_orders
  for each row execute function audit_trigger_fn();

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders (id),
  line_no integer not null,
  item_id uuid not null references items (id),
  qty numeric not null check (qty > 0),
  unit text not null,
  unit_price numeric not null check (unit_price >= 0),
  required_date date,
  eta date,
  technical_spec text,
  created_at timestamptz not null default now(),
  unique (po_id, line_no)
);

create trigger audit_purchase_order_lines
  after insert or update or delete on purchase_order_lines
  for each row execute function audit_trigger_fn();

create table purchase_order_line_attachments (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references purchase_order_lines (id),
  file_path text not null,
  file_name text not null,
  file_size bigint,
  content_type text,
  uploaded_by uuid references user_profiles (id),
  uploaded_at timestamptz not null default now()
);

create trigger audit_purchase_order_line_attachments
  after insert or update or delete on purchase_order_line_attachments
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- create_purchase_order: header + all lines in one transaction.
-- p_lines: jsonb array of {item_id, qty, unit, unit_price, required_date, eta, technical_spec}
-- ---------------------------------------------------------------------
create or replace function create_purchase_order(
  p_supplier_id uuid,
  p_po_date date,
  p_currency text,
  p_delivery_date date,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_po_no text;
  v_line jsonb;
  v_line_no integer := 0;
begin
  if not has_permission('purchase_orders', 'create') then
    raise exception 'Permission denied for purchase_orders.create';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'p_lines must contain at least one line';
  end if;

  v_po_no := generate_document_number('purchase_order');

  insert into purchase_orders (po_no, supplier_id, po_date, currency, delivery_date, created_by)
  values (v_po_no, p_supplier_id, p_po_date, coalesce(p_currency, 'THB'), p_delivery_date, auth.uid())
  returning id into v_po_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    insert into purchase_order_lines (po_id, line_no, item_id, qty, unit, unit_price, required_date, eta, technical_spec)
    values (
      v_po_id,
      v_line_no,
      (v_line ->> 'item_id')::uuid,
      (v_line ->> 'qty')::numeric,
      v_line ->> 'unit',
      (v_line ->> 'unit_price')::numeric,
      nullif(v_line ->> 'required_date', '')::date,
      nullif(v_line ->> 'eta', '')::date,
      nullif(v_line ->> 'technical_spec', '')
    );
  end loop;

  return v_po_id;
end;
$$;

-- ---------------------------------------------------------------------
-- update_purchase_order_status: only the manually-triggerable
-- transitions. PARTIAL_RECEIVED/COMPLETED are set by Phase 6.
-- ---------------------------------------------------------------------
create or replace function update_purchase_order_status(p_po_id uuid, p_new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_required_action text;
begin
  select status into v_current from purchase_orders where id = p_po_id;
  if not found then
    raise exception 'Purchase order not found';
  end if;

  v_required_action := case
    when v_current = 'DRAFT' and p_new_status = 'SUBMITTED' then 'edit'
    when v_current = 'DRAFT' and p_new_status = 'CANCELLED' then 'reject'
    when v_current = 'SUBMITTED' and p_new_status = 'CONFIRMED' then 'approve'
    when v_current = 'SUBMITTED' and p_new_status = 'DRAFT' then 'reject'
    when v_current = 'SUBMITTED' and p_new_status = 'CANCELLED' then 'reject'
    when v_current = 'CONFIRMED' and p_new_status = 'CANCELLED' then 'reject'
  end;

  if v_required_action is null then
    raise exception 'Illegal status transition: % -> %', v_current, p_new_status;
  end if;

  if not has_permission('purchase_orders', v_required_action) then
    raise exception 'Permission denied for purchase_orders.%', v_required_action;
  end if;

  update purchase_orders set status = p_new_status where id = p_po_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Storage bucket for PO line spec/drawing attachments. Kept separate
-- from QC photo storage (section 4 non-functional note) with its own
-- size/type limits — technical drawings run larger than QC photos.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'po-attachments',
  'po-attachments',
  false,
  20971520, -- 20MB
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/acad',       -- .dwg (no universally registered MIME type)
    'image/vnd.dwg',
    'application/dxf',
    'application/octet-stream' -- fallback for .dwg/.dxf browsers send generically
  ]
)
on conflict (id) do nothing;

create policy "View po-attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'po-attachments' and has_permission('purchase_orders', 'view'));

create policy "Upload po-attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'po-attachments' and has_permission('purchase_orders', 'create'));

create policy "Delete po-attachments" on storage.objects
  for delete to authenticated
  using (bucket_id = 'po-attachments' and has_permission('purchase_orders', 'delete'));

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;
alter table purchase_order_line_attachments enable row level security;

create policy "View purchase_orders" on purchase_orders
  for select to authenticated using (has_permission('purchase_orders', 'view'));

create policy "View purchase_order_lines" on purchase_order_lines
  for select to authenticated using (has_permission('purchase_orders', 'view'));

create policy "View po_line_attachments" on purchase_order_line_attachments
  for select to authenticated using (has_permission('purchase_orders', 'view'));

create policy "Create po_line_attachments" on purchase_order_line_attachments
  for insert to authenticated with check (has_permission('purchase_orders', 'create'));

create policy "Delete po_line_attachments" on purchase_order_line_attachments
  for delete to authenticated using (has_permission('purchase_orders', 'delete'));
