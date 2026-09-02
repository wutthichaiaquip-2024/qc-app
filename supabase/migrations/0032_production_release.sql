-- Phase 24: Production Release.
-- Three genuinely buildable/testable pieces: an RLS coverage audit
-- (checkable and re-runnable, not a one-time manual pass), and the
-- Data Migration & Opening Balance import the spec calls for
-- (Master Data bulk import + Opening Stock Balance), both atomic
-- (whole CSV succeeds or none of it lands) matching "Data Validation
-- ก่อนเข้าตารางจริง". The rest of this phase (provisioning PITR,
-- monitoring/alerting, the actual Rollback/Cutover/Training plans) is
-- documented in PRODUCTION_RELEASE.md — it's infrastructure/process,
-- not code.

-- ---------------------------------------------------------------------
-- audit_rls_coverage: every table in `public`, whether RLS is on, and
-- how many policies it has. ADMIN-only (this is a security posture
-- tool, not tied to any one module's CRUD permissions) — re-runnable
-- any time, not just before go-live.
-- ---------------------------------------------------------------------
create or replace function audit_rls_coverage()
returns table (
  table_name text,
  rls_enabled boolean,
  policy_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname,
    c.relrowsecurity,
    coalesce(p.cnt, 0)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join (
    select tablename, count(*) as cnt from pg_policies where schemaname = 'public' group by tablename
  ) p on p.tablename = c.relname
  where n.nspname = 'public' and c.relkind = 'r'
    and requesting_role() = 'ADMIN'
  order by c.relname;
$$;

revoke execute on function audit_rls_coverage from public, anon;
grant execute on function audit_rls_coverage to authenticated;

-- ---------------------------------------------------------------------
-- Opening Balance: a distinct txn_type from ADJUSTMENT (Phase 23) —
-- establishing day-1 stock from the old system is a different kind of
-- event from correcting a mistake, and keeping them distinct keeps the
-- ledger's audit trail honest going forward.
-- ---------------------------------------------------------------------
alter table stock_transactions drop constraint stock_transactions_txn_type_check;
alter table stock_transactions add constraint stock_transactions_txn_type_check
  check (txn_type in (
    'RECEIPT', 'IQC_OUT', 'IQC_PASS', 'IQC_HOLD', 'IQC_NG', 'WIP_REQUEST_OUT',
    'FG_PASS', 'FG_HOLD', 'FG_NG', 'OQC_OUT', 'OQC_HOLD', 'OQC_NG', 'SHIPMENT_OUT',
    'ADJUSTMENT', 'OPENING_BALANCE'
  ));

-- ---------------------------------------------------------------------
-- import_customers / import_suppliers / import_items / import_locations:
-- bulk CSV import for Master Data migration. Same shape as Phase 3's
-- create_forecast_batch() — one call, one jsonb array, one transaction:
-- if any row fails, the whole batch rolls back rather than landing
-- partially. No SQL is built from the input (no dynamic table/column
-- names anywhere in this codebase, and this doesn't start) — one
-- function per entity.
-- ---------------------------------------------------------------------
create or replace function import_customers(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
begin
  if not has_permission('master_data', 'create') then
    raise exception 'Permission denied for master_data.create';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row ->> 'code', '') = '' or coalesce(v_row ->> 'name', '') = '' then
      raise exception 'customers row missing required code/name: %', v_row;
    end if;

    insert into customers (code, name, type, contact_name, contact_phone, contact_email)
    values (
      v_row ->> 'code', v_row ->> 'name', nullif(v_row ->> 'type', ''),
      nullif(v_row ->> 'contact_name', ''), nullif(v_row ->> 'contact_phone', ''), nullif(v_row ->> 'contact_email', '')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function import_suppliers(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
begin
  if not has_permission('master_data', 'create') then
    raise exception 'Permission denied for master_data.create';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row ->> 'code', '') = '' or coalesce(v_row ->> 'name', '') = '' then
      raise exception 'suppliers row missing required code/name: %', v_row;
    end if;

    insert into suppliers (code, name, contact_name, contact_phone, contact_email, lead_time_days)
    values (
      v_row ->> 'code', v_row ->> 'name',
      nullif(v_row ->> 'contact_name', ''), nullif(v_row ->> 'contact_phone', ''), nullif(v_row ->> 'contact_email', ''),
      nullif(v_row ->> 'lead_time_days', '')::integer
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function import_locations(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_site_id uuid;
begin
  if not has_permission('master_data', 'create') then
    raise exception 'Permission denied for master_data.create';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row ->> 'code', '') = '' or coalesce(v_row ->> 'zone_type', '') = '' then
      raise exception 'locations row missing required code/zone_type: %', v_row;
    end if;

    select id into v_site_id from sites where code = v_row ->> 'site_code';
    if v_site_id is null then
      raise exception 'Unknown site_code: %', v_row ->> 'site_code';
    end if;

    insert into locations (site_id, code, name, zone_type, physical_address)
    values (v_site_id, v_row ->> 'code', nullif(v_row ->> 'name', ''), v_row ->> 'zone_type', nullif(v_row ->> 'physical_address', ''));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function import_items(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_customer_id uuid;
  v_supplier_id uuid;
begin
  if not has_permission('master_data', 'create') then
    raise exception 'Permission denied for master_data.create';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row ->> 'part_no', '') = '' or coalesce(v_row ->> 'base_uom', '') = '' or coalesce(v_row ->> 'purchase_uom', '') = '' then
      raise exception 'items row missing required part_no/base_uom/purchase_uom: %', v_row;
    end if;

    v_customer_id := null;
    if coalesce(v_row ->> 'customer_code', '') <> '' then
      select id into v_customer_id from customers where code = v_row ->> 'customer_code';
      if v_customer_id is null then
        raise exception 'Unknown customer_code: %', v_row ->> 'customer_code';
      end if;
    end if;

    v_supplier_id := null;
    if coalesce(v_row ->> 'supplier_code', '') <> '' then
      select id into v_supplier_id from suppliers where code = v_row ->> 'supplier_code';
      if v_supplier_id is null then
        raise exception 'Unknown supplier_code: %', v_row ->> 'supplier_code';
      end if;
    end if;

    insert into items (part_no, description, base_uom, purchase_uom, uom_conversion_factor, customer_id, supplier_id, safety_stock, moq, lead_time_days)
    values (
      v_row ->> 'part_no', nullif(v_row ->> 'description', ''), v_row ->> 'base_uom', v_row ->> 'purchase_uom',
      coalesce(nullif(v_row ->> 'uom_conversion_factor', '')::numeric, 1),
      v_customer_id, v_supplier_id,
      coalesce(nullif(v_row ->> 'safety_stock', '')::numeric, 0),
      nullif(v_row ->> 'moq', '')::numeric,
      nullif(v_row ->> 'lead_time_days', '')::integer
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- import_opening_balance: creates a brand-new lot per row (this stock
-- was never received through Phase 6's Receiving flow, so there is no
-- existing lot to adjust) and writes a real OPENING_BALANCE ledger
-- entry + stock_balance, atomically. Gated by stock_adjustments.approve
-- rather than a plain create — this writes the ledger directly, no
-- separate request/approve step, so it needs approver-level trust, matching
-- section 3's "ผู้อนุมัติ" requirement for anything that establishes or
-- corrects stock outside the normal operational flow.
-- ---------------------------------------------------------------------
create or replace function import_opening_balance(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_item_id uuid;
  v_location_id uuid;
  v_lot_id uuid;
  v_lot_no text;
  v_qty numeric;
begin
  if not has_permission('stock_adjustments', 'approve') then
    raise exception 'Permission denied for stock_adjustments.approve (opening balance import requires approver-level access)';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    select id into v_item_id from items where part_no = v_row ->> 'part_no';
    if v_item_id is null then
      raise exception 'Unknown part_no: %', v_row ->> 'part_no';
    end if;

    select id into v_location_id from locations where code = v_row ->> 'location_code';
    if v_location_id is null then
      raise exception 'Unknown location_code: %', v_row ->> 'location_code';
    end if;

    v_qty := nullif(v_row ->> 'qty', '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'qty must be > 0 for part_no %', v_row ->> 'part_no';
    end if;

    v_lot_no := nullif(v_row ->> 'lot_no', '');
    if v_lot_no is null then
      v_lot_no := generate_document_number('lot');
    end if;

    insert into lots (lot_no, item_id) values (v_lot_no, v_item_id) returning id into v_lot_id;

    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (v_lot_id, v_location_id, v_qty, 'OPENING_BALANCE', 'data_migration', v_lot_id, auth.uid());

    insert into stock_balance (lot_id, location_id, qty)
    values (v_lot_id, v_location_id, v_qty)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function import_customers, import_suppliers, import_locations, import_items, import_opening_balance from public, anon;
grant execute on function import_customers, import_suppliers, import_locations, import_items, import_opening_balance to authenticated;
