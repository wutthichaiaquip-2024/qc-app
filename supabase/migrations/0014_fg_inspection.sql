-- Phase 10: FG Inspection
-- Confirms a CONFIRMED wip_requests row (the "batch" from Phase 9)
-- into a brand new FG Lot via the same split-lot principle as IQC.
-- Genealogy: FG Lot -> FG Inspection -> WIP Lot -> IQC -> Receiving ->
-- PO -> Supplier is recorded in real foreign keys, not prose:
-- fg_inspections.new_lot_id is the FG Lot; fg_inspections.wip_request_id
-- -> wip_requests.wip_lot_id is the WIP Lot; from there Phase 8's
-- get_lot_traceability() already walks the rest of the chain.

create table item_documents (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id),
  doc_type text not null check (doc_type in ('WORK_INSTRUCTION', 'PACKING_STD')),
  title text not null,
  file_path text not null,
  file_name text not null,
  uploaded_by uuid references user_profiles (id),
  uploaded_at timestamptz not null default now()
);

create trigger audit_item_documents
  after insert or update or delete on item_documents
  for each row execute function audit_trigger_fn();

create table fg_inspections (
  id uuid primary key default gen_random_uuid(),
  fg_no text not null unique,
  wip_request_id uuid not null unique references wip_requests (id),
  item_id uuid not null references items (id),
  new_lot_id uuid not null references lots (id),
  inspection_plan_id uuid references inspection_plans (id),
  inspection_mode text not null check (inspection_mode in ('SAMPLING', 'FULL')),
  measurement_method text not null check (measurement_method in ('COUNT', 'WEIGHT')),
  lot_size numeric not null,
  sample_size integer,
  accept_no integer,
  reject_no integer,
  qty_pass numeric not null default 0 check (qty_pass >= 0),
  qty_hold numeric not null default 0 check (qty_hold >= 0),
  qty_ng numeric not null default 0 check (qty_ng >= 0),
  inspected_by uuid references user_profiles (id),
  started_at timestamptz,
  completed_at timestamptz not null default now()
);

create trigger audit_fg_inspections
  after insert or update or delete on fg_inspections
  for each row execute function audit_trigger_fn();

create table fg_inspection_characteristics (
  id uuid primary key default gen_random_uuid(),
  fg_inspection_id uuid not null references fg_inspections (id),
  characteristic_name text not null,
  spec_value text,
  measured_value numeric,
  unit text,
  result text not null check (result in ('PASS', 'NG')),
  created_at timestamptz not null default now()
);

create trigger audit_fg_inspection_characteristics
  after insert or update or delete on fg_inspection_characteristics
  for each row execute function audit_trigger_fn();

-- Reuses defect_codes from Phase 7 (same taxonomy for IQC and FG).
create table fg_inspection_defects (
  id uuid primary key default gen_random_uuid(),
  fg_inspection_id uuid not null references fg_inspections (id),
  defect_code_id uuid not null references defect_codes (id),
  qty numeric not null check (qty > 0),
  condition_note text,
  photo_path text,
  created_at timestamptz not null default now()
);

create trigger audit_fg_inspection_defects
  after insert or update or delete on fg_inspection_defects
  for each row execute function audit_trigger_fn();

alter table stock_transactions drop constraint stock_transactions_txn_type_check;
alter table stock_transactions add constraint stock_transactions_txn_type_check
  check (txn_type in (
    'RECEIPT', 'IQC_OUT', 'IQC_PASS', 'IQC_HOLD', 'IQC_NG', 'WIP_REQUEST_OUT',
    'FG_PASS', 'FG_HOLD', 'FG_NG'
  ));

-- ---------------------------------------------------------------------
-- Storage buckets. qc-photos is separate from po-attachments (Phase 5)
-- with its own limits per section 4's non-functional note (max 5MB per
-- QC photo). item-documents holds Work Instruction / Packing Std files
-- for the barcode lookup.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qc-photos', 'qc-photos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-documents', 'item-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "View qc-photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'qc-photos' and has_permission('fg_inspection', 'view'));

create policy "Upload qc-photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'qc-photos' and has_permission('fg_inspection', 'create'));

create policy "View item-documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-documents' and has_permission('fg_inspection', 'view'));

create policy "Upload item-documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'item-documents' and has_permission('fg_inspection', 'create'));

-- ---------------------------------------------------------------------
-- confirm_fg_inspection: creates the new FG Lot and moves stock into
-- FG/HOLD/NG per the split-lot decision. No source stock_balance to
-- decrement here — Phase 9's confirm_wip_request() already cut the WIP
-- side; this materializes the outcome as fresh stock under a new lot.
-- p_characteristics: jsonb array of {characteristic_name, spec_value, measured_value, unit, result}
-- p_defects: jsonb array of {defect_code_id, qty, condition_note, photo_path}
-- ---------------------------------------------------------------------
create or replace function confirm_fg_inspection(
  p_wip_request_id uuid,
  p_inspection_mode text,
  p_measurement_method text,
  p_fg_location_id uuid,
  p_hold_location_id uuid,
  p_ng_location_id uuid,
  p_qty_pass numeric,
  p_qty_hold numeric,
  p_qty_ng numeric,
  p_started_at timestamptz,
  p_characteristics jsonb,
  p_defects jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wr record;
  v_plan record;
  v_fg_no text;
  v_lot_no text;
  v_new_lot_id uuid;
  v_fg_id uuid;
  v_char jsonb;
  v_defect jsonb;
  v_zone text;
begin
  if not has_permission('fg_inspection', 'create') then
    raise exception 'Permission denied for fg_inspection.create';
  end if;

  select * into v_wr from wip_requests where id = p_wip_request_id for update;
  if not found then
    raise exception 'WIP request not found';
  end if;
  if v_wr.status <> 'CONFIRMED' then
    raise exception 'WIP request is not CONFIRMED (status = %)', v_wr.status;
  end if;
  if exists (select 1 from fg_inspections where wip_request_id = p_wip_request_id) then
    raise exception 'This WIP request has already been FG-inspected';
  end if;

  if coalesce(p_qty_pass, 0) + coalesce(p_qty_hold, 0) + coalesce(p_qty_ng, 0) <= 0 then
    raise exception 'qty_pass + qty_hold + qty_ng must be greater than 0';
  end if;
  if (p_qty_pass + p_qty_hold + p_qty_ng) > v_wr.requested_qty then
    raise exception 'qty_pass + qty_hold + qty_ng (%) exceeds requested qty (%)', p_qty_pass + p_qty_hold + p_qty_ng, v_wr.requested_qty;
  end if;

  if p_qty_pass > 0 then
    select zone_type into v_zone from locations where id = p_fg_location_id;
    if v_zone is distinct from 'FG' then
      raise exception 'Pass location must be zone_type = FG (got %)', v_zone;
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

  select * into v_plan from get_sample_size_plan(v_wr.item_id, v_wr.requested_qty::integer);

  v_fg_no := generate_document_number('fg_inspection');
  v_lot_no := generate_document_number('lot');

  insert into lots (lot_no, item_id) values (v_lot_no, v_wr.item_id) returning id into v_new_lot_id;

  insert into fg_inspections (
    fg_no, wip_request_id, item_id, new_lot_id, inspection_plan_id,
    inspection_mode, measurement_method, lot_size, sample_size, accept_no, reject_no,
    qty_pass, qty_hold, qty_ng, inspected_by, started_at
  )
  values (
    v_fg_no, p_wip_request_id, v_wr.item_id, v_new_lot_id, v_plan.inspection_plan_id,
    p_inspection_mode, p_measurement_method, v_wr.requested_qty, v_plan.sample_size,
    v_plan.accept_no, v_plan.reject_no, coalesce(p_qty_pass, 0), coalesce(p_qty_hold, 0),
    coalesce(p_qty_ng, 0), auth.uid(), p_started_at
  )
  returning id into v_fg_id;

  for v_char in select * from jsonb_array_elements(coalesce(p_characteristics, '[]'::jsonb))
  loop
    insert into fg_inspection_characteristics (fg_inspection_id, characteristic_name, spec_value, measured_value, unit, result)
    values (
      v_fg_id,
      v_char ->> 'characteristic_name',
      nullif(v_char ->> 'spec_value', ''),
      nullif(v_char ->> 'measured_value', '')::numeric,
      nullif(v_char ->> 'unit', ''),
      v_char ->> 'result'
    );
  end loop;

  for v_defect in select * from jsonb_array_elements(coalesce(p_defects, '[]'::jsonb))
  loop
    insert into fg_inspection_defects (fg_inspection_id, defect_code_id, qty, condition_note, photo_path)
    values (
      v_fg_id,
      (v_defect ->> 'defect_code_id')::uuid,
      (v_defect ->> 'qty')::numeric,
      nullif(v_defect ->> 'condition_note', ''),
      nullif(v_defect ->> 'photo_path', '')
    );
  end loop;

  if p_qty_pass > 0 then
    insert into stock_balance (lot_id, location_id, qty)
    values (v_new_lot_id, p_fg_location_id, p_qty_pass)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (v_new_lot_id, p_fg_location_id, p_qty_pass, 'FG_PASS', 'fg_inspection', v_fg_id, auth.uid());
  end if;

  if p_qty_hold > 0 then
    insert into stock_balance (lot_id, location_id, qty)
    values (v_new_lot_id, p_hold_location_id, p_qty_hold)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (v_new_lot_id, p_hold_location_id, p_qty_hold, 'FG_HOLD', 'fg_inspection', v_fg_id, auth.uid());
  end if;

  if p_qty_ng > 0 then
    insert into stock_balance (lot_id, location_id, qty)
    values (v_new_lot_id, p_ng_location_id, p_qty_ng)
    on conflict (lot_id, location_id) do update set qty = stock_balance.qty + excluded.qty;

    insert into stock_transactions (lot_id, location_id, qty_delta, txn_type, ref_type, ref_id, created_by)
    values (v_new_lot_id, p_ng_location_id, p_qty_ng, 'FG_NG', 'fg_inspection', v_fg_id, auth.uid());
  end if;

  return v_fg_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table item_documents enable row level security;
alter table fg_inspections enable row level security;
alter table fg_inspection_characteristics enable row level security;
alter table fg_inspection_defects enable row level security;

create policy "View item_documents" on item_documents for select to authenticated using (has_permission('fg_inspection', 'view'));
create policy "Create item_documents" on item_documents for insert to authenticated with check (has_permission('fg_inspection', 'create'));
create policy "Delete item_documents" on item_documents for delete to authenticated using (has_permission('fg_inspection', 'delete'));

create policy "View fg_inspections" on fg_inspections for select to authenticated using (has_permission('fg_inspection', 'view'));
create policy "View fg_inspection_characteristics" on fg_inspection_characteristics for select to authenticated using (has_permission('fg_inspection', 'view'));
create policy "View fg_inspection_defects" on fg_inspection_defects for select to authenticated using (has_permission('fg_inspection', 'view'));
-- No insert/update/delete policy on fg_inspections/characteristics/defects:
-- only confirm_fg_inspection() (security definer) writes them.
