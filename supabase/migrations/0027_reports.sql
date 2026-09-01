-- Phase 21: Reports
-- Five report types (Stock, QC, Supplier Quality, Forecast, Traceability)
-- plus CSV/PDF export that genuinely runs as a background job: a
-- report_jobs queue processed by a Supabase Edge Function
-- (supabase/functions/process-report-jobs), invoked every minute by
-- pg_cron via pg_net — the same asynchronous pattern as Phase 20's
-- notification generation, except this one IS deployed and IS tested,
-- since it only calls this project's own Storage API (no external
-- SMTP/LINE-style third-party credential is needed).
--
-- Forecast and Traceability reuse Phase 19/17's existing
-- get_forecast_accuracy() / get_lot_genealogy() rather than
-- duplicating that logic — this migration only adds what doesn't
-- already exist: Stock, QC, and Supplier Quality report queries.

-- ---------------------------------------------------------------------
-- get_stock_report: current balance across every zone/site (not just
-- WIP/FG like Phase 8/11's screens) — Reports is meant to cross-cut,
-- gated by has_permission('reports', 'view') alone.
-- ---------------------------------------------------------------------
create or replace function get_stock_report()
returns table (
  site_code text,
  location_code text,
  zone_type text,
  part_no text,
  description text,
  lot_no text,
  qty numeric,
  reserved_qty numeric,
  available_qty numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.code, loc.code, loc.zone_type,
    i.part_no, i.description,
    l.lot_no, sb.qty, sb.reserved_qty, sb.qty - sb.reserved_qty
  from stock_balance sb
  join lots l on l.id = sb.lot_id
  join items i on i.id = l.item_id
  join locations loc on loc.id = sb.location_id
  join sites s on s.id = loc.site_id
  where sb.qty > 0
    and has_permission('reports', 'view')
  order by s.code, loc.code, i.part_no;
$$;

-- ---------------------------------------------------------------------
-- get_qc_report: one row per inspection event across IQC / FG
-- Inspection / OQC in a date range. OQC has no split-lot quantity of
-- its own (Phase 15: one result for the whole picking), so its
-- qty/part_no are aggregated from the picking's lines.
-- ---------------------------------------------------------------------
create or replace function get_qc_report(p_from date, p_to date)
returns table (
  inspection_type text,
  doc_no text,
  inspected_at timestamptz,
  part_no text,
  lot_no text,
  qty_pass numeric,
  qty_hold numeric,
  qty_ng numeric,
  result text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    'IQC', iqc.iqc_no, iqc.inspected_at, i.part_no, l.lot_no,
    iqc.qty_pass, iqc.qty_hold, iqc.qty_ng,
    case when iqc.qty_ng > 0 then 'NG' when iqc.qty_hold > 0 then 'HOLD' else 'PASS' end
  from iqc_inspections iqc
  join lots l on l.id = iqc.lot_id
  join items i on i.id = l.item_id
  where iqc.inspected_at::date between p_from and p_to
    and has_permission('reports', 'view')

  union all

  select
    'FG_INSPECTION', fgi.fg_no, fgi.completed_at, i.part_no, l.lot_no,
    fgi.qty_pass, fgi.qty_hold, fgi.qty_ng,
    case when fgi.qty_ng > 0 then 'NG' when fgi.qty_hold > 0 then 'HOLD' else 'PASS' end
  from fg_inspections fgi
  join items i on i.id = fgi.item_id
  join lots l on l.id = fgi.new_lot_id
  where fgi.completed_at::date between p_from and p_to
    and has_permission('reports', 'view')

  union all

  select
    'OQC', oi.oqc_no, oi.inspected_at, pk_agg.part_nos, null::text,
    case when oi.result = 'PASS' then pk_agg.total_qty else 0 end,
    case when oi.result = 'HOLD' then pk_agg.total_qty else 0 end,
    case when oi.result = 'NG' then pk_agg.total_qty else 0 end,
    oi.result
  from oqc_inspections oi
  join lateral (
    select
      string_agg(distinct i.part_no, ', ') as part_nos,
      coalesce(sum(pl.qty_picked), 0) as total_qty
    from picking_lines pl
    join allocations a on a.id = pl.allocation_id
    join lots l on l.id = a.lot_id
    join items i on i.id = l.item_id
    where pl.picking_id = oi.picking_id
  ) pk_agg on true
  where oi.inspected_at::date between p_from and p_to
    and has_permission('reports', 'view');
$$;

-- ---------------------------------------------------------------------
-- get_supplier_quality_report: NG rate per supplier over a date range,
-- from goods received (Phase 6) and their IQC results (Phase 7).
-- Supplier CAR/claim closed-loop tracking was confirmed out of scope
-- before Phase 0 — this is aggregate defect-rate visibility only.
-- ---------------------------------------------------------------------
create or replace function get_supplier_quality_report(p_from date, p_to date)
returns table (
  supplier_code text,
  supplier_name text,
  lots_received bigint,
  qty_received numeric,
  lots_with_ng bigint,
  qty_ng numeric,
  ng_rate_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sup.code,
    sup.name,
    count(distinct grl.lot_id),
    sum(grl.qty_received),
    count(distinct grl.lot_id) filter (where coalesce(iqc_ng.qty_ng, 0) > 0),
    sum(coalesce(iqc_ng.qty_ng, 0)),
    case when sum(grl.qty_received) > 0
      then round(sum(coalesce(iqc_ng.qty_ng, 0)) / sum(grl.qty_received) * 100, 2)
      else 0 end
  from goods_receipt_lines grl
  join goods_receipts gr on gr.id = grl.gr_id
  join purchase_orders po on po.id = gr.po_id
  join suppliers sup on sup.id = po.supplier_id
  left join lateral (
    select sum(qty_ng) as qty_ng from iqc_inspections where lot_id = grl.lot_id
  ) iqc_ng on true
  where gr.received_date between p_from and p_to
    and has_permission('reports', 'view')
  group by sup.code, sup.name
  order by 7 desc;
$$;

-- ---------------------------------------------------------------------
-- report_jobs: the export queue. Only create_report_job() (checked)
-- and the worker Edge Function (service_role, bypasses RLS) write to
-- this table — no direct insert/update policy for authenticated.
-- ---------------------------------------------------------------------
create table report_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references user_profiles (id),
  report_type text not null check (report_type in ('STOCK', 'QC', 'SUPPLIER_QUALITY', 'FORECAST', 'TRACEABILITY')),
  format text not null check (format in ('CSV', 'PDF')),
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  file_path text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table report_jobs enable row level security;

create policy "View own report_jobs" on report_jobs
  for select to authenticated
  using (requested_by = auth.uid() or requesting_role() = 'ADMIN');

create or replace function create_report_job(p_report_type text, p_format text, p_filters jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not has_permission('reports', 'view') then
    raise exception 'Permission denied for reports.view';
  end if;
  if p_report_type not in ('STOCK', 'QC', 'SUPPLIER_QUALITY', 'FORECAST', 'TRACEABILITY') then
    raise exception 'Invalid report_type: %', p_report_type;
  end if;
  if p_format not in ('CSV', 'PDF') then
    raise exception 'Invalid format: %', p_format;
  end if;
  if p_report_type = 'TRACEABILITY' and coalesce(p_filters ->> 'lot_no', '') = '' then
    raise exception 'lot_no filter is required for a TRACEABILITY report';
  end if;

  insert into report_jobs (requested_by, report_type, format, filters)
  values (auth.uid(), p_report_type, p_format, p_filters)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function create_report_job from public, anon;
grant execute on function create_report_job to authenticated;

create or replace function get_my_report_jobs()
returns table (
  id uuid,
  report_type text,
  format text,
  status text,
  file_path text,
  error text,
  created_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, report_type, format, status, file_path, error, created_at, completed_at
  from report_jobs
  where requested_by = auth.uid()
  order by created_at desc
  limit 20;
$$;

-- ---------------------------------------------------------------------
-- get_report_export_data: the ONLY thing the worker calls. Runs with
-- no request/JWT context (called via the service_role key, same as
-- Phase 18's refresh_dashboards()), so it locally simulates an ADMIN
-- claim just for the duration of the call to satisfy the nested
-- has_permission() checks inside get_stock_report() etc. — the actual
-- authorization already happened once, for real, in create_report_job()
-- at enqueue time; this only fulfills a request that already passed
-- that check. Restricted to service_role so nothing else can call it.
-- ---------------------------------------------------------------------
create or replace function get_report_export_data(p_report_type text, p_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_from date;
  v_to date;
begin
  perform set_config('request.jwt.claims', '{"app_role":"ADMIN"}', true);

  v_from := coalesce((p_filters ->> 'from')::date, '1900-01-01'::date);
  v_to := coalesce((p_filters ->> 'to')::date, current_date);

  if p_report_type = 'STOCK' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_result from get_stock_report() r;
  elsif p_report_type = 'QC' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_result from get_qc_report(v_from, v_to) r;
  elsif p_report_type = 'SUPPLIER_QUALITY' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_result from get_supplier_quality_report(v_from, v_to) r;
  elsif p_report_type = 'FORECAST' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_result from get_forecast_accuracy() r;
  elsif p_report_type = 'TRACEABILITY' then
    select get_lot_genealogy(l.lot_id) into v_result from find_lot_by_no(p_filters ->> 'lot_no') l;
  else
    raise exception 'Unknown report_type: %', p_report_type;
  end if;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke execute on function get_report_export_data from public, anon, authenticated;
grant execute on function get_report_export_data to service_role;

-- ---------------------------------------------------------------------
-- Storage: private bucket, path = "<requested_by uuid>/<job id>.<ext>".
-- The worker (service_role) uploads there directly, bypassing RLS.
-- Client downloads use createSignedUrl() with the user's own session
-- (same pattern as item-documents/qc-photos in Phase 10/14) — the SELECT
-- policy below restricts that to the first path segment matching the
-- caller's own auth.uid(), since these are personal export files, not
-- module-wide data like the other buckets.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-exports', 'report-exports', false, 20971520, array['text/csv', 'application/pdf'])
on conflict (id) do nothing;

create policy "View own report-exports" on storage.objects
  for select to authenticated
  using (bucket_id = 'report-exports' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- pg_net + pg_cron: ping the process-report-jobs Edge Function every
-- minute. The anon key below is safe to commit (it's the same public
-- key already shipped to every browser as NEXT_PUBLIC_SUPABASE_ANON_KEY)
-- — it only gets the HTTP request past the API gateway; the Edge
-- Function does its actual DB work with its own service_role key.
-- ---------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'process-report-jobs-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://mmkprjuiiwzttalmuips.supabase.co/functions/v1/process-report-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ta3ByanVpaXd6dHRhbG11aXBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5ODc5MjcsImV4cCI6MjEwMzU2MzkyN30.aaISr4DVUzZUFKEiJ_C6hh1XWTc1aHBOMDcZot-bzSg'
    ),
    body := '{}'::jsonb
  );
  $$
);
