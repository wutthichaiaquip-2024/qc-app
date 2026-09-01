-- Phase 7: Incoming QC (IQC)
-- Resolves sample size from the Phase 2 lookup tables, records a
-- split-lot decision (qty_pass/qty_hold/qty_ng in one inspection —
-- never a forced single result for the whole lot), and moves stock
-- from the INCOMING location into WIP/HOLD/NG per the actual
-- disposition, atomically, with row locking on the source balance.

-- ---------------------------------------------------------------------
-- Defect codes: left EMPTY on purpose, same reasoning as the AQL table
-- in Phase 2 — this is the company's own QC defect taxonomy, not
-- something to invent. Managed by QC via the IQC screen.
-- ---------------------------------------------------------------------
create table defect_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now()
);

create trigger audit_defect_codes
  after insert or update or delete on defect_codes
  for each row execute function audit_trigger_fn();

-- ---------------------------------------------------------------------
-- IQC inspection header. Plan/sample-size fields are a snapshot of
-- whatever get_sample_size_plan() returned at inspection time — per
-- the Versioned Spec principle, results always reference what was
-- actually effective that day, not whatever the plan says now.
-- ---------------------------------------------------------------------
create table iqc_inspections (
  id uuid primary key default gen_random_uuid(),
  iqc_no text not null unique,
  lot_id uuid not null references lots (id),
  inspection_plan_id uuid references inspection_plans (id),
  lot_size numeric not null,
  sample_size integer,
  accept_no integer,
  reject_no integer,
  qty_pass numeric not null default 0 check (qty_pass >= 0),
  qty_hold numeric not null default 0 check (qty_hold >= 0),
  qty_ng numeric not null default 0 check (qty_ng >= 0),
  inspected_by uuid references user_profiles (id),
  inspected_at timestamptz not null default now()
);

create trigger audit_iqc_inspections
  after insert or update or delete on iqc_inspections
  for each row execute function audit_trigger_fn();

create table iqc_defects (
  id uuid primary key default gen_random_uuid(),
  iqc_id uuid not null references iqc_inspections (id),
  defect_code_id uuid not null references defect_codes (id),
  qty numeric not null check (qty > 0),
  condition_note text,
  created_at timestamptz not null default now()
);

create trigger audit_iqc_defects
  after insert or update or delete on iqc_defects
  for each row execute function audit_trigger_fn();

-- stock_transactions grows: IQC moves stock out of INCOMING and into
-- WIP/HOLD/NG per the split-lot decision.
alter table stock_transactions drop constraint stock_transactions_txn_type_check;
alter table stock_transactions add constraint stock_transactions_txn_type_check
  check (txn_type in ('RECEIPT', 'IQC_OUT', 'IQC_PASS', 'IQC_HOLD', 'IQC_NG'));

-- ---------------------------------------------------------------------
-- confirm_iqc_inspection: resolves the sample-size plan, locks the
-- source stock_balance row, validates qty_pass+qty_hold+qty_ng doesn't
-- exceed what's actually there, then moves stock in one transaction.
-- p_defects: jsonb array of {defect_code_id, qty, condition_note}
-- ---------------------------------------------------------------------
create or replace function confirm_iqc_inspection(
  p_lot_id uuid,
  p_incoming_location_id uuid,
  p_wip_location_id uuid,
  p_hold_location_id uuid,
  p_ng_location_id uuid,
  p_qty_pass numeric,
  p_qty_hold numeric,
  p_qty_ng numeric,
  p_defects jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_available_qty numeric;
  v_plan record;
  v_iqc_no text;
  v_iqc_id uuid;
  v_defect jsonb;
  v_zone text;
begin
  if not has_permission('iqc', 'create') then
    raise exception 'Permission denied for iqc.create';
  end if;

  if coalesce(p_qty_pass, 0) + coalesce(p_qty_hold, 0) + coalesce(p_qty_ng, 0) <= 0 then
    raise exception 'qty_pass + qty_hold + qty_ng must be greater than 0';
  end if;

  select qty into v_available_qty
  from stock_balance
  where lot_id = p_lot_id and location_id = p_incoming_location_id
  for update;

  if not found or v_available_qty <= 0 then
    raise exception 'No stock available for this lot at the given INCOMING location';
  end if;

  if (p_qty_pass + p_qty_hold + p_qty_ng) > v_available_qty then
    raise exception 'qty_pass + qty_hold + qty_ng (%) exceeds available qty (%)', p_qty_pass + p_qty_hold + p_qty_ng, v_available_qty;
  end if;

  select zone_type into v_zone from locations where id = p_incoming_location_id;
  if v_zone is distinct from 'INCOMING' then
    raise exception 'Source location must be zone_type = INCOMING (got %)', v_zone;
  end if;

  if p_qty_pass > 0 then
    select zone_type into v_zone from locations where id = p_wip_location_id;
    if v_zone is distinct from 'WIP' then
      raise exception 'Pass location must be zone_type = WIP (got %)', v_zone;
    end if;
  end if;

  if p_qty_hold > 0 then
    select zone_type into v_zone from locations where id = p_hold_location_id;
    if v_zone is distinct from 'HOLD' then
      raise exception 'Hold location must be zone_type = HOLD (got %)', v_zone;
    end if;
  end if;

  if p_qty_ng > 0 then
    select zone_type into v_zone from locations where id = p_ng_location_id;
    if v_zone is distinct from 'NG' then
      raise exception 'NG location must be zone_type = NG (got %)', v_zone;
    end if;
  end if;

  select item_id into v_item_id from lots where id = p_lot_id;

  select * into v_plan from get_sample_size_plan(v_item_id, v_available_qty::integer);

  v_iqc_no := generate_document_number('iqc');

  insert into iqc_inspections (
    iqc_no, lot_id, inspection_plan_id, lot_size, sample_size, accept_no, reject_no,
    qty_pass, qty_hold, qty_ng, inspected_by
  )
  values (
    v_iqc_no, p_lot_id, v_plan.inspection_plan_id, v_available_qty, v_plan.sample_size,
    v_plan.accept_no, v_plan.reject_no, coalesce(p_qty_pass, 0), coalesce(p_qty_hold, 0),
    coalesce(p_qty_ng, 0), auth.uid()
  )
  returning id into v_iqc_id;

  for v_defect in select * from jsonb_array_elements(coalesce(p_defects, '[]'::jsonb))
  loop
    insert into iqc_defects (iqc_id, defect_code_id, qty, condition_note)
    values (
      v_iqc_id,
      (v_defect ->> 'defect_code_id')::uuid,
      (v_defect ->> 'qty')::numeric,
      nullif(v_defect ->> 'condition_note', '')
    );
  end loop;

  -- move stock: out of INCOMING, into WIP/HOLD/NG per disposition
  update stock_balance
  set qty = qty - (p_qty_pass + p_qty_hold + p_qty_ng)
  where lot_id = p_lot_id and location_id = p_incoming_location_id;

  insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
  values (p_lot_id, p_incoming_location_id, -(p_qty_pass + p_qty_hold + p_qty_ng), 'IQC_OUT', 'iqc_inspection', v_iqc_id, auth.uid());

  if p_qty_pass > 0 then
    insert into stock_balance (lot_id, location_id, qty)
    values (p_lot_id, p_wip_location_id, p_qty_pass)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (p_lot_id, p_wip_location_id, p_qty_pass, 'IQC_PASS', 'iqc_inspection', v_iqc_id, auth.uid());
  end if;

  if p_qty_hold > 0 then
    insert into stock_balance (lot_id, location_id, qty)
    values (p_lot_id, p_hold_location_id, p_qty_hold)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (p_lot_id, p_hold_location_id, p_qty_hold, 'IQC_HOLD', 'iqc_inspection', v_iqc_id, auth.uid());
  end if;

  if p_qty_ng > 0 then
    insert into stock_balance (lot_id, location_id, qty)
    values (p_lot_id, p_ng_location_id, p_qty_ng)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (p_lot_id, p_ng_location_id, p_qty_ng, 'IQC_NG', 'iqc_inspection', v_iqc_id, auth.uid());
  end if;

  return v_iqc_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table defect_codes enable row level security;
alter table iqc_inspections enable row level security;
alter table iqc_defects enable row level security;

create policy "View defect_codes" on defect_codes for select to authenticated using (has_permission('iqc', 'view'));
create policy "Create defect_codes" on defect_codes for insert to authenticated with check (has_permission('iqc', 'create'));
create policy "Edit defect_codes" on defect_codes for update to authenticated using (has_permission('iqc', 'edit')) with check (has_permission('iqc', 'edit'));

create policy "View iqc_inspections" on iqc_inspections for select to authenticated using (has_permission('iqc', 'view'));
create policy "View iqc_defects" on iqc_defects for select to authenticated using (has_permission('iqc', 'view'));
-- iqc_inspections/iqc_defects have no insert/update/delete policy:
-- only confirm_iqc_inspection() (security definer) writes them.
