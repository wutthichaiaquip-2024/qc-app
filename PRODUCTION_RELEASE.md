# AQUIP QC & Inventory System — Production Release (Phase 24)

This project (`mmkprjuiiwzttalmuips`) is now the production project — confirmed with the user rather than provisioning a separate one, since it already carries all schema/migrations and no other environment exists. What follows is what's actually done vs. what's still a manual step for the user, and the rollback/cutover/training plan.

## 1. RLS coverage audit — done, re-runnable

`audit_rls_coverage()` (ADMIN-only, `supabase/migrations/0032_production_release.sql`) enumerates every table in `public` with its RLS-enabled flag and policy count. Also exposed in the UI at `/data-migration` ("RLS Coverage Audit" section) so this can be re-checked any time, not just once before go-live.

**Run just before this session ended:** all 49 tables in `public` have `rls_enabled = true`. 45 have real policies. 4 have `policy_count = 0` by design, not by omission:

- `document_number_config`, `document_number_counters` (Phase 0)
- `forecast_revision_counters`, `forecast_line_version_counters` (Phase 3)

These are pure internal atomic counters with no per-row user-facing meaning — they're locked down via `REVOKE ALL FROM public` (checked in Phase 1/3) instead of policies, which combined with RLS-enabled-with-zero-policies is a stricter deny-by-default than most policy sets, not a gap. Only `generate_document_number()` (`SECURITY DEFINER`) can touch them.

**Not covered by this audit, covered separately:** Phase 18's 4 materialized views (`mv_management_dashboard` etc.) can't have RLS at all (a Postgres limitation on materialized views) — they're protected by `REVOKE ALL` from `anon`/`authenticated`/`public` instead, exposed only through checked `SECURITY DEFINER` wrapper functions. Verified when Phase 18 was built (`has_table_privilege()` confirmed `false` for `authenticated`); not re-verified in this pass.

## 2. Point-in-Time Recovery + Monitoring/Alerting

Checked directly in the Supabase Dashboard (logged in as the user, this session) rather than guessed at. Neither PITR nor a plan change is settable through SQL/CLI — both are dashboard/billing actions only the user can authorize.

**Confirmed current state:**
- Organization `wutthichai.aquip@gmail.com's Org` is on the **Free Plan** ($0/month).
- **Free-plan risk relevant to production**: free projects auto-pause after 1 week of inactivity. A production system that goes quiet (e.g., a slow week) risks getting paused. This should be tracked as a real risk regardless of the PITR decision below.
- **PITR**: Settings → Add-ons → Point in Time Recovery. Confirmed disabled, and confirmed it requires the **Pro Plan** (from $25/month + usage-based overages) before it can even be turned on. On top of Pro, the PITR add-on itself costs **$100/month (7-day retention)**, **$200/month (14-day)**, or **$400/month (28-day)** — billed at end of cycle, no immediate charge just from viewing the option.
- **Decision (2026-09-02, this session)**: user chose **not to upgrade yet** — cost decision deferred. PITR and the Pro-only compute/scaling options remain off. Revisit before real go-live, since §5's Cutover plan assumes PITR is live before step 6.
- **Monitoring — mostly already available for free**: Reports/Observability (`/dashboard/project/mmkprjuiiwzttalmuips/reports`) shows live Slow Queries, Peak Connections, Disk Usage/IO, Memory, CPU, and per-service health (API Gateway/Database/PostgREST/Auth/Edge Functions/Storage/Realtime) — no plan upgrade needed, nothing further to configure to get baseline visibility.
- **Proactive alerting (email/webhook on threshold breach)**: no self-service configuration page was found in this dashboard pass. The available paid option is **Log Drains** (Settings → Add-ons) at **+$60/drain/month**, also Pro-plan-only, to forward logs to an external monitoring tool (Datadog etc.) — not evaluated further since PITR/Pro was deferred.
- Consider an external uptime check against the deployed Next.js app itself regardless of plan — Supabase's monitoring only covers its own services, not the app.

**Unplanned but relevant finding from this pass**: Supabase's built-in Security Advisor (Dashboard → Advisors → Security, free on any plan) reports **109 warnings, 0 errors, 4 info suggestions** for this project. Not part of §1's table-RLS audit (which only checks tables, not function grants) — this is a different, real gap. Two categories seen: (a) **Function Search Path Mutable** — several functions predating the `set search_path = public` convention (`generate_document_number`, `set_updated_at`, `requesting_role`, `has_permission`, `get_sample_size_plan`, `enforce_fg_stock_origin`, `prevent_stock_transactions_mutation`) don't pin it, a real search-path-hijack surface; (b) **Public Can Execute SECURITY DEFINER Function** — functions like `allocate_stock`, `audit_trigger_fn`, `cancel_sales_order`, `cancel_wip_request` (and evidently many more, given the count) appear callable by `PUBLIC` even though they're meant to be `authenticated`-only, meaning an explicit `REVOKE ... FROM PUBLIC` was likely missing on these (an earlier-phase gap in the same "revoke public/anon, grant authenticated" pattern later phases followed consistently). **Not fixed in this session** — flagged for a follow-up pass since it's a genuinely separate piece of work from PITR/monitoring.

## 3. Data Migration & Opening Balance — done, tested against real data

`/data-migration`: CSV bulk import for Customers, Suppliers, Locations, Items (`import_customers`/`import_suppliers`/`import_locations`/`import_items`, all `master_data.create`-gated) and Opening Stock Balance (`import_opening_balance`, `stock_adjustments.approve`-gated — it writes the ledger directly, no separate request/approve step, so it needs approver-level trust). Every import is one DB transaction per file: if any row fails validation, nothing from that file lands, matching "Data Validation ก่อนเข้าตารางจริง" literally rather than just best-effort.

Verified against the real DB: imported customers/suppliers/locations/items with cross-references (item → customer_code/supplier_code, location → site_code) resolved correctly; confirmed atomicity by mixing one bad row (unknown `site_code`) into an otherwise-valid batch — zero rows landed, including the valid ones ahead of it; imported an opening balance row with no `lot_no` given — confirmed it auto-generated one (`LOT-2026-00001`) via the same `generate_document_number()` counter every other document type uses, wrote a real `OPENING_BALANCE` ledger entry and `stock_balance` row; confirmed the `stock_adjustments.approve` gate rejects a role without it.

**A side effect, same as Phase 23:** the Opening Balance import test wrote a real, permanent `stock_transactions` row (append-only, no bypass — see Phase 23's `TEST_PLAN.md`). Its FK chain (item `RPT24TEST-ITEM1`, lot `LOT-2026-00001`, location `RPT24TEST-LOC1`, site `RPT24TEST-SITE`, customer `RPT24TEST-CUST1`, supplier `RPT24TEST-SUP1`) can't be removed for the same reason. Everything else from this phase's testing that wasn't locked by that chain (an extra customer, two extra locations, a stray mistaken row) was deleted and confirmed gone. **Before real go-live**, either accept this and Phase 23's residue as permanently-tagged (`RPT23TEST-*`/`RPT24TEST-*`) harmless rows, or wipe and re-seed this project from a clean migration replay if a truly pristine production baseline is required — that replay is a real, deliberate action (drops all current data) and needs the user's explicit go-ahead, not something to do unprompted.

## 4. Rollback plan

Consistent with "every write goes through a checked `SECURITY DEFINER` function, in one transaction, with row locking" (section 3, applied since Phase 6) — a bad deploy has two very different failure shapes:

**Schema/migration rollback** (a bad migration applied to prod): Supabase migrations here are forward-only SQL files, no generated down-migration. Options in order of preference:
1. **PITR restore** to the timestamp just before the bad migration — the correct tool once §2 is done, since it undoes both schema and data cleanly.
2. **Hand-written reverse migration** for anything before PITR exists or for a narrow, well-understood mistake (e.g., a bad `alter table` that's trivially reversible) — write and test it against a scratch project first, never against prod directly.
3. **Never**: hand-editing prod schema outside a migration file, or disabling a trigger (like the append-only one) to "fix" something — Phase 23 exists specifically to prove that door stays shut even under time pressure.

**Application rollback** (Vercel/Next.js deploy): revert to the previous deployment (Vercel keeps every deploy addressable — "Promote to Production" on the prior one). This is independent of the database — the app and DB migrations aren't required to move in lockstep, since every DB change here is additive (new columns/tables/functions), not breaking, by construction so far.

**Data rollback** (bad data entered through normal use, not a bug): never delete/edit — per Phase 23, create a new, approved Stock Adjustment (or, for non-stock master data, a normal edit through the UI, which is already audit-logged).

## 5. Cutover plan

1. **Freeze the old system's write path** at a announced cutoff time — this system's Opening Balance import assumes it's importing a snapshot, not a moving target.
2. **Export Master Data** from the old system (Customers, Suppliers, Items, Locations) to the CSV shapes `/data-migration` expects (headers documented on each import panel). Import Customers/Suppliers first, then Locations (needs Sites to already exist — create Sites manually via `/master-data`, there's no bulk Site import since a company doesn't add sites often), then Items (needs Customers/Suppliers already imported, since it resolves them by code).
3. **Physical stock count** at cutover, reconciled against the old system's last known balance.
4. **Import Opening Balance** from that physical count via `/data-migration` — one `OPENING_BALANCE` ledger entry per lot/location, auto-numbered.
5. **Parallel Run** (explicitly required by the spec): run both systems side by side for a short, announced window — new transactions get entered in both, and at the end of each day compare this system's stock balance (`/reports`, Stock report) against the old system's for every part/location. Do not go live on this system alone until at least one full inventory cycle (however long that is for AQUIP's operation — a week, a month) shows the two matching. Any mismatch found during Parallel Run gets corrected via a real, approved Stock Adjustment with the reason recorded, not by silently re-importing.
6. **Go-live**: stop entering transactions in the old system. Keep it read-only/archived, not deleted, for historical lookup.
7. Re-run the RLS audit (§1) and confirm PITR is live (§2) before step 6, not after.

## 6. Training per role

Not built as in-app content — this is a genuine gap, listed here rather than skipped silently. What exists that training can be built from:
- Every phase's `PROJECT_STATE.md` entry describes what each screen does and why, in the order a user encounters it operationally (grouped in `nav-items.ts` by workflow, not by phase number).
- `TEST_PLAN.md`'s logical-unit groups double as a reasonable training curriculum shape: Master Data → Purchasing/Receiving/IQC → WIP/FG Inspection → Sales/Allocation/Picking/OQC/Shipping → Traceability/Reports.
- Recommended minimum before go-live: one short walkthrough per role (QC, Warehouse, Purchasing, Planning, Sales, Management, Admin) covering only the screens `role_permissions` actually grants that role — everyone doesn't need everyone else's screens explained.

## Known gaps carried into production

Everything listed in `TEST_PLAN.md`'s "Known gaps carried forward" still applies at go-live: no real user has clicked through any screen (no login credentials existed in this environment, ever, across all 24 phases); Phase 20 email/LINE delivery is real code, undeployed; Phase 22 label print CSS is unverified against real printer hardware; Phase 6/14 barcode scanning is unverified against real scanner hardware; the AQL Ac/Re table and defect codes are intentionally empty, owned by QC. None of these block a technical go-live, but all of them should be closed out — starting with a real human UAT pass per role — before this system is trusted as the sole source of truth.
