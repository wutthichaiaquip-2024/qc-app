-- Phase 20: Notification & Automation
-- In-app notifications are fully built and testable here. Email is a
-- real, correct Edge Function (supabase/functions/send-notifications)
-- but is NOT deployed and NOT tested — there are no real SMTP/Resend
-- credentials to test against in this environment. LINE Notify/LINE OA
-- (confirmed in scope before Phase 0) additionally needs a per-user
-- linking mechanism that doesn't exist anywhere yet (LINE Notify
-- requires each user to individually authorize; LINE OA Messaging API
-- needs each user's LINE userId) — user_profiles.line_user_id below is
-- a placeholder column for that future linking flow, not a working
-- integration. See PROJECT_STATE.md for exactly what is and isn't real.

alter table user_profiles add column line_user_id text;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  role app_role not null,
  title text not null,
  message text not null,
  link text,
  condition_key text not null unique,
  created_at timestamptz not null default now()
);

create table notification_reads (
  notification_id uuid not null references notifications (id),
  user_id uuid not null references user_profiles (id),
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table notification_channel_log (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications (id),
  channel text not null check (channel in ('EMAIL', 'LINE')),
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- generate_notifications: checks one condition per role
-- (Planning/Purchasing/QC/Warehouse), dedup'd via condition_key's
-- unique constraint so re-running this hourly only ever creates one
-- notification per condition per day, not a fresh spam every run.
-- ---------------------------------------------------------------------
create or replace function generate_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today text := to_char(current_date, 'YYYYMMDD');
  v_red_count integer;
  v_purchase_req_qty numeric;
  v_qc_pending integer;
  v_wh_pending integer;
  v_notification_id uuid;
begin
  -- Planning: items currently RED in the stock planning snapshot
  select count(*) into v_red_count from stock_planning_snapshot where status = 'RED';
  if v_red_count > 0 then
    insert into notifications (role, title, message, link, condition_key)
    values (
      'PLANNING', 'Stock Shortage Alert',
      v_red_count || ' item(s) are RED (projected shortage) — please review Demand & Stock Planning.',
      '/planning', 'planning_red_' || v_today
    )
    on conflict (condition_key) do nothing
    returning id into v_notification_id;
    if v_notification_id is not null then
      insert into notification_channel_log (notification_id, channel) values (v_notification_id, 'EMAIL'), (v_notification_id, 'LINE');
    end if;
  end if;

  -- Purchasing: items needing purchase per the same snapshot
  select coalesce(sum(purchase_requirement_qty), 0) into v_purchase_req_qty
  from stock_planning_snapshot where purchase_requirement_qty > 0;
  if v_purchase_req_qty > 0 then
    insert into notifications (role, title, message, link, condition_key)
    values (
      'PURCHASING', 'Purchase Requirement Alert',
      'Total purchase requirement across items: ' || v_purchase_req_qty || ' — please review and raise POs.',
      '/planning', 'purchasing_req_' || v_today
    )
    on conflict (condition_key) do nothing
    returning id into v_notification_id;
    if v_notification_id is not null then
      insert into notification_channel_log (notification_id, channel) values (v_notification_id, 'EMAIL'), (v_notification_id, 'LINE');
    end if;
  end if;

  -- QC: anything pending IQC / FG Inspection / OQC
  select
    (select count(distinct sb.lot_id) from stock_balance sb join locations loc on loc.id = sb.location_id where loc.zone_type = 'INCOMING' and sb.qty > 0)
    + (select count(*) from wip_requests wr where wr.status = 'CONFIRMED' and not exists (select 1 from fg_inspections fgi where fgi.wip_request_id = wr.id))
    + (select count(distinct pk.id) from pickings pk where not exists (select 1 from oqc_inspections oi where oi.picking_id = pk.id))
  into v_qc_pending;
  if v_qc_pending > 0 then
    insert into notifications (role, title, message, link, condition_key)
    values (
      'QC', 'QC Queue Alert',
      v_qc_pending || ' item(s)/lot(s) are waiting on IQC, FG Inspection, or OQC.',
      '/iqc', 'qc_pending_' || v_today
    )
    on conflict (condition_key) do nothing
    returning id into v_notification_id;
    if v_notification_id is not null then
      insert into notification_channel_log (notification_id, channel) values (v_notification_id, 'EMAIL'), (v_notification_id, 'LINE');
    end if;
  end if;

  -- Warehouse: pending WIP requests + ready-to-ship allocations
  select
    (select count(*) from wip_requests where status = 'PENDING')
    + (select count(distinct a.id) from allocations a join picking_lines pl on pl.allocation_id = a.id join oqc_inspections oi on oi.picking_id = pl.picking_id and oi.result = 'PASS' where a.status = 'PICKED')
  into v_wh_pending;
  if v_wh_pending > 0 then
    insert into notifications (role, title, message, link, condition_key)
    values (
      'WAREHOUSE', 'Warehouse Action Alert',
      v_wh_pending || ' item(s) are waiting on WIP Request confirmation or are ready to ship.',
      '/wip-requests', 'warehouse_pending_' || v_today
    )
    on conflict (condition_key) do nothing
    returning id into v_notification_id;
    if v_notification_id is not null then
      insert into notification_channel_log (notification_id, channel) values (v_notification_id, 'EMAIL'), (v_notification_id, 'LINE');
    end if;
  end if;
end;
$$;

revoke execute on function generate_notifications from public, anon;
grant execute on function generate_notifications to authenticated;

select cron.schedule(
  'generate-notifications-hourly',
  '10 * * * *',
  $$select generate_notifications();$$
);

-- ---------------------------------------------------------------------
-- get_my_notifications / mark_notification_read: every authenticated
-- user can see notifications for their own role and mark them read
-- individually (role-targeted, but read status is per-user).
-- ---------------------------------------------------------------------
create or replace function get_my_notifications()
returns table (
  id uuid,
  title text,
  message text,
  link text,
  created_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.title, n.message, n.link, n.created_at, nr.read_at
  from notifications n
  left join notification_reads nr on nr.notification_id = n.id and nr.user_id = auth.uid()
  where n.role = requesting_role()
  order by n.created_at desc
  limit 50;
$$;

create or replace function mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_reads (notification_id, user_id)
  values (p_notification_id, auth.uid())
  on conflict (notification_id, user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table notifications enable row level security;
alter table notification_reads enable row level security;
alter table notification_channel_log enable row level security;

create policy "View own-role notifications" on notifications
  for select to authenticated using (role = requesting_role() or requesting_role() = 'ADMIN');

create policy "View own notification_reads" on notification_reads
  for select to authenticated using (user_id = auth.uid());

create policy "View notification_channel_log as admin" on notification_channel_log
  for select to authenticated using (requesting_role() = 'ADMIN');
-- No insert/update/delete policy on any of these: only
-- generate_notifications()/mark_notification_read() (security
-- definer) write them.
