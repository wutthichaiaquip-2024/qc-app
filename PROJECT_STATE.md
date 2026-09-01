# PROJECT_STATE

อัปเดตท้ายทุก Phase ตามข้อ 5.3 ของ Master Prompt — อ่านไฟล์นี้แทนการสแกน repo/schema ใหม่ทั้งหมด

## Scope decisions (ยืนยันแล้วก่อน Phase 0)

- Multi-site/Multi-warehouse: **ใช่** — ต้องมี `site_id` ใน RLS และ Location Master ตั้งแต่ Phase 1-2
- Invoice/AP/VAT: **นอกสโคป**
- Customer Order (SO) pricing: **ไม่มีฟิลด์ราคาใน SO**
- Rework/Scrap: ของ Rework ต้องกลับเข้า FG Inspection ใหม่เสมอ, **QC/Management** เป็นผู้อนุมัติ Scrap
- Supplier CAR/Claim closed-loop tracking: **ยังไม่ทำ** (เก็บแค่ Defect Details)
- Notification channels: in-app + email + **LINE Notify/LINE OA**
- Document number format: `<PREFIX>-<YYYY>-<00001>` รีเซ็ตรายปีทุกประเภทเอกสาร (ดู `document_number_config`)
- Barcode symbology: **QR Code** (มือถือ scan ได้ง่ายกว่า, เก็บข้อมูลได้เยอะกว่า Code128). Payload เป็น JSON versioned: `{v, type: LOT|LOCATION|SHIPMENT, id (uuid, ใช้ query DB สด), code (human-readable), part_no, site}`. หลักการสำคัญ: field ที่เปลี่ยนได้หลังพิมพ์ป้าย (qty, QC status) **ห้าม**ฝังใน QR — แอปต้อง query DB สดด้วย `id` เสมอ, ห้ามเชื่อค่าที่ scan ได้ตัดสินใจ business logic
- Stock planning color thresholds: **RED** = Projected Stock < 0, **YELLOW** = 0 ≤ Projected Stock < Safety Stock, **GREEN** = Projected Stock ≥ Safety Stock (compares against Safety Stock only, not Lead Time)

## Phase 0 — Foundation: สถานะ **บางส่วน**

Done:
- Next.js 15 + TypeScript + Tailwind scaffold (`create-next-app`, App Router, `src/` dir)
- `@supabase/supabase-js` + `@supabase/ssr` installed
- Supabase client helpers: `src/lib/supabase/client.ts` (browser), `src/lib/supabase/server.ts` (server)
- `supabase/` project linked to cloud project `mmkprjuiiwzttalmuips` (this is being used as the **dev** project)
- Migration `supabase/migrations/0001_document_numbering.sql` applied via `supabase db push` and verified against the real database: `generate_document_number('purchase_order')` → `PO-2026-00001`, `PO-2026-00002`; `generate_document_number('sales_order')` → `SO-2026-00001`. Test rows cleared from `document_number_counters` after verification.
- `.env.local` populated with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the dev project (gitignored)
- Base layout: `Sidebar`, `Header`, dashboard shell (`src/app/layout.tsx`, `src/app/page.tsx`, `src/components/layout/`) — verified rendering in browser
- GitHub repo: [github.com/wutthichaiaquip-2024/qc-app](https://github.com/wutthichaiaquip-2024/qc-app), pushed as of Phase 0 commit
- Local git repo committed and pushed (GitHub Credential Manager authenticated as `wutthichaiaquip-2024`)

Blocked / needs your action:
- **Docker Desktop is not running/installed on this machine** — local `supabase start` failed (`LegacyDockerLifecycleInspectError`). Not needed right now since we're using the cloud dev project directly, but worth fixing eventually for offline/fast local iteration.
- **Staging + prod Supabase projects** — only one cloud project (`mmkprjuiiwzttalmuips`) has been linked so far, treated as **dev**. Create separate projects for staging/prod when ready (doc requires 3 real separate projects, not branches).
- **Vercel deployment** — not connected yet (needs your Vercel account).

## Phase 1 — User & Permission: สถานะ **เสร็จ**

Done:
- Migration `supabase/migrations/0002_users_permissions.sql`: `app_role` enum (7 roles), `sites` (minimal, expands in Phase 2), `user_profiles`, `user_sites` (multi-site mapping), `role_permissions` (View/Create/Edit/Approve/Reject/Delete × 18 modules — seeded ADMIN=full access, everyone else=view-only as a **safe starting default, not a finished business decision**), `audit_log` + generic `audit_trigger_fn()` wired onto all 4 new tables, RLS enabled + policies on all of them.
- Custom Access Token Hook (`custom_access_token_hook`) injects `app_role` + `site_ids` into the JWT so RLS elsewhere can read `auth.jwt()` directly. Enabled on the cloud project via `supabase config push` (see `config.toml`).
- `handle_new_auth_user()` trigger auto-creates a `user_profiles` row on signup; migration `0003_bootstrap_first_admin.sql` makes the **first** signup become `ADMIN`/`ACTIVE` automatically (otherwise nobody could ever assign the first role), every signup after that lands as `role=null`/`status=PENDING` until an ADMIN assigns a role.
- Verified against the real dev DB: seed counts correct (ADMIN 18/18 view+create, others 18/0), RLS enabled on all 5 tables, audit trigger fires correctly on insert (test row inserted/verified/deleted).
- UI: `/login` (email+password sign-in), route-group shell `src/app/(app)/layout.tsx` redirects unauthenticated users to `/login` (via `src/proxy.ts`, Next.js 16's replacement for `middleware.ts`), `Header` shows real signed-in user + role, `/settings/users` lets ADMIN view all users and change role/status (RLS-enforced; non-admins see read-only).
- Verified in browser: unauthenticated visit to `/` correctly redirects to `/login`.
- ⚠️ Incident during this phase: `supabase config push` initially overwrote unrelated auth security settings on the live project (disabled email confirmation, disabled MFA, weakened rate limits) as a side effect of enabling the JWT hook — caught and reverted immediately, confirmed `up to date` against prior values. Lesson: always diff `config push` output before trusting it; don't push config changes without reviewing every line of the diff.
- ⚠️ Bug found when you tried creating the first user via Supabase Studio: `handle_new_auth_user()` from `0003_bootstrap_first_admin.sql` had `case when v_is_first then 'ADMIN' else null end` — Postgres resolves that CASE to type `text` (not `app_role`), so every single user creation failed with "Database error creating new user" (root cause: `column "role" is of type app_role but expression is of type text"`). Fixed in `supabase/migrations/0004_fix_bootstrap_role_cast.sql` (explicit `::app_role` cast), verified by reproducing the exact insert pattern before and after the fix.
- ⚠️ Second bug found on first login attempt: `custom_access_token_hook` failed with "Error running hook URI: ...". Root cause: `supabase_auth_admin` (the role that invokes the hook) has `search_path='auth'` only, so the unqualified `app_role` type reference couldn't resolve. Fixed in `supabase/migrations/0005_fix_hook_search_path.sql` (pinned `search_path = public` on the function, schema-qualified the type), verified by reproducing the restricted search_path before/after.
- **Verified end-to-end**: first user created via Supabase Studio → auto-bootstrapped as ADMIN/ACTIVE → logged into the app successfully (`wutthichai.aquip@gmail.com`) → JWT hook issues `app_role`/`site_ids` claims correctly.

Known gaps (not blocking, just not done):
- No dedicated `/signup` page — new users are currently created via Supabase Studio (Authentication > Users) rather than self-serve signup in the app.
- **Public self-signup is currently ON** (`enable_signup = true`, project default — I have not changed this). For an internal company system you may want ADMIN-only invites instead; flagging rather than changing it myself since it's an auth security setting.
- `role_permissions` seed (view-only default for non-ADMIN roles) needs real business sign-off per role/module — not blocking, just not final.

Not started: item/lot/location schema (Phase 2), everything after.

## Phase 2 — Master Data: สถานะ **บางส่วน (DB เสร็จ+verified, UI ยังไม่ได้ทดสอบในเบราว์เซอร์)**

Done:
- Migration `supabase/migrations/0006_master_data.sql`: `customers`, `suppliers`, `items` (with `custom_conversion` jsonb — structured factor+rounding, never an eval-able string, per section 3.1), `locations` (site-scoped, `zone_type` check constraint), `sample_size_code_letters` (ISO 2859-1/ANSI Z1.4 Table I, seeded — General Levels I/II/III only, S1-S4 not seeded), `aql_sampling_plans` (Table II-A structure, **intentionally left empty** — these Ac/Re numbers gate real accept/reject decisions, so per your instruction I built the table/UI for QC to enter them from your official standard document rather than guessing), `inspection_plans` (versioned: effective_date + revision_no), `get_sample_size_plan(item_id, lot_size)` RPC that resolves code letter → sample size/Ac/Re for use from Phase 7 onward.
- New generic `has_permission(module, action)` SQL helper — RLS on every Phase 2 table reads Phase 1's `role_permissions` matrix directly instead of hardcoding role names, so the permission system built in Phase 1 actually drives access here.
- Verified against the real dev DB: seeded Table I matches the standard exactly (45 rows checked), RLS enabled on all 7 tables, full insert→audit_log→`get_sample_size_plan()` pipeline tested end-to-end with real linked rows (customer→supplier→item→location→inspection_plan→aql_sampling_plan→lookup), all test data cleaned up afterward.
- UI: `/master-data` with tabs for Customer/Supplier/Item/Location/Inspection Plan/AQL Sampling Table, each a list + add-row form gated by `role_permissions.master_data.can_create`. Reusable `EntityManager`/`FieldInput` components back all six tabs. AQL Sampling Table tab carries an explicit on-screen warning to enter values only from the official standard document.
- Build + typecheck + lint all pass. **Not yet verified in browser with a real session** — I don't have your login credentials to test past the auth gate; please click through `/master-data` once and tell me if anything looks wrong.

Known gaps:
- No edit/delete UI yet, only list + add (kept scope contained this round).
- `aql_sampling_plans` is empty — QC needs to populate it from the real standard document before Phase 7 (IQC) can auto-calculate sample sizes.
- Special inspection levels S-1..S-4 not seeded in `sample_size_code_letters` (only General I/II/III) — add if you use special levels.

## Phase 3 — Customer Forecast: สถานะ **บางส่วน (DB เสร็จ+verified, UI ยังไม่ได้ทดสอบในเบราว์เซอร์)**

Done:
- Migration `supabase/migrations/0007_customer_forecast.sql`: `forecast_batches` (header, `forecast_no` via Phase 0 document numbering, `revision_no` per customer via atomic counter), `forecast_lines` (**append-only** — every edit is a new row with an incremented `version`, old values are never touched, matching the Stock-Ledger principle from section 3). `create_forecast_batch(customer_id, lines)` RPC does header+lines in one transaction; `update_forecast_batch_status()` RPC enforces legal DRAFT→SUBMITTED→APPROVED→REVISED/CANCELLED transitions only, each gated by the matching `role_permissions` action (submit=edit, approve=approve, cancel/send-back=reject).
- Verified against the real dev DB: submitted 2 batches for the same customer+item+month — confirmed old version preserved untouched (100/v1) and new version appended (120/v2) rather than overwritten; confirmed illegal transition (SUBMITTED→REVISED) rejected; confirmed a role without `can_approve` (QC, default permissions) is blocked from approving; confirmed the legal path (submit→approve) works and audit_log captured exactly 2 inserts + 2 updates. All test data cleaned up after.
- UI: `/forecast` — CSV import (customer + `part_no,forecast_month,forecast_qty` columns) with client-side parse/validate/preview before submit, batch list with inline status-transition buttons, expandable line-level detail per batch.
- Used a **hand-written CSV parser** (`src/lib/csv.ts`) instead of the `xlsx` npm package — `xlsx`/SheetJS has two unpatched high-severity advisories (prototype pollution, ReDoS), both exploitable via a malicious uploaded file, which is exactly this feature's attack surface. `.xlsx` binary import is not supported yet, only `.csv` (Excel exports to CSV trivially).
- ⚠️ Bug found and fixed before you saw it: `EntityManager`'s `formatCell` prop (a function) was being passed from a Server Component (`master-data/page.tsx`) to a Client Component — Next.js doesn't allow functions across that boundary, so `/master-data` crashed at runtime (not caught by `next build` because that route is dynamic — data-fetching only actually runs on a real request, not at build time). Fixed by replacing the function prop with a plain serializable lookup-map (`cellLabelMaps`). Also hit unrelated Turbopack dev-cache corruption from running `next build` and `next dev` against the same `.next` folder concurrently — cleared `.next` and confirmed a clean server start with no errors.
- Build + typecheck + lint all pass. **UI not yet verified in browser with a real session** — same as Phase 2, I don't have your login credentials.

Known gaps:
- `.xlsx` binary import not supported, CSV only.
- No auto-cascade when a new revision is submitted (older batches for that customer don't automatically move to REVISED) — left as a manual transition since I wasn't sure that's the business rule you want; flag if you'd rather it be automatic.

## Phase 4 — Demand & Stock Planning: สถานะ **บางส่วน (DB เสร็จ+verified, UI ยังไม่ได้ทดสอบในเบราว์เซอร์)**

⚠️ **สำคัญ**: Phase นี้ต้องใช้ข้อมูลจาก Customer Order (Phase 12), FG Stock (Phase 11), WIP Stock (Phase 8), Incoming/Receiving (Phase 6), Open PO (Phase 5) — **ยังไม่มีตารางเหล่านี้เลย** จึง hardcode เป็น 0 ไว้ก่อน พร้อม TODO comment ระบุชัดว่า Phase ไหนจะมาแทนที่ค่าไหนใน `refresh_stock_planning()`. ตัวเลข Projected Stock ตอนนี้คำนวณจาก **Forecast + Safety Stock เท่านั้น** — ไม่ใช่ค่าสมบูรณ์ที่ใช้ตัดสินใจสั่งซื้อได้จริง มี banner สีส้มเตือนไว้บนหน้า UI แล้ว

Done:
- Migration `supabase/migrations/0008_demand_stock_planning.sql`: `stock_planning_snapshot` table + `refresh_stock_planning()` (delete+recompute all active items in one transaction, not per-row updates) + **pg_cron hourly schedule** (`0 * * * *`) — confirmed active in `cron.job`. Formula: `Projected Stock = FG + WIP + Incoming + Open PO − Customer Order − Forecast` (all zero except Forecast right now).
- เกณฑ์สี (ยืนยันกับคุณแล้ว): **RED** = Projected Stock < 0, **YELLOW** = 0 ≤ Projected Stock < Safety Stock, **GREEN** = Projected Stock ≥ Safety Stock.
- Verified against real dev DB with a hand-calculated case (safety_stock=50, next-month forecast=80 from a SUBMITTED batch): got projected_stock=−80, shortage=80, purchase_requirement=130, status=RED — matches manual calculation exactly. Forecast aggregation correctly takes the **latest version per (item, month, customer)** and only counts SUBMITTED/APPROVED batches (excludes DRAFT/CANCELLED). Cleaned up all test data after.
- UI: `/planning` — table with GREEN/YELLOW/RED badges, manual "Refresh now" button (calls the same RPC pg_cron uses) in addition to the hourly auto-refresh, explicit warning banner about the 0-placeholder inputs.
- Build + typecheck + lint pass, dev server starts clean with no runtime errors on the (pre-auth) route. **UI not yet verified in browser with a real session.**

Known gaps / follow-ups for later phases:
- When Phase 5/6/8/11/12 land, go back to `refresh_stock_planning()` and replace each `0::numeric as X -- TODO Phase N` line with a real subquery against the new table.
- "Next month" is currently the only forecast window considered — may want to extend to a multi-month rolling horizon once Purchase Requirement needs to look further ahead (matches Lead Time).

## Phase 5 — Purchase Order: สถานะ **บางส่วน (DB เสร็จ+verified, UI ยังไม่ได้ทดสอบในเบราว์เซอร์)**

Done:
- Migration `supabase/migrations/0009_purchase_orders.sql`: `purchase_orders` (header, `po_no` via Phase 0 numbering), `purchase_order_lines` (Part No./Qty/Unit/Unit Price/Required Date/ETA/Technical Spec-Drawing Rev), `purchase_order_line_attachments`. `create_purchase_order()` RPC creates header+lines atomically; `update_purchase_order_status()` enforces DRAFT→SUBMITTED→CONFIRMED/CANCELLED manually (submit=edit, confirm=approve, cancel/send-back=reject permission) — **`PARTIAL_RECEIVED`/`COMPLETED` are intentionally NOT reachable from this RPC**, they'll be set by Phase 6 (Receiving) once goods actually arrive against a line.
- Supabase Storage bucket `po-attachments` (private, 20MB limit, PDF/DWG/DXF/PNG/JPG) kept separate from QC-photo storage per section 4's non-functional note, with RLS tied to `purchase_orders` view/create/delete permissions. Max size / allowed types are a sensible default I picked, not a business-confirmed policy — adjust `supabase/migrations/0009_purchase_orders.sql`'s bucket insert if you want different limits.
- Verified against the real dev DB end-to-end: created a PO (`PO-2026-00001`) with a line, confirmed DRAFT→SUBMITTED→CONFIRMED works for ADMIN, confirmed PURCHASING role (default permissions) is blocked from approving, confirmed jumping straight to `PARTIAL_RECEIVED` is rejected as illegal, confirmed audit_log captured exactly the legal operations. Storage bucket config and RLS policies on `storage.objects` confirmed present. All test data cleaned up after.
- UI: `/purchase-orders` — dynamic multi-line PO creation form, PO list with status-transition buttons, expandable line detail with per-line file upload/list.
- Build + typecheck + lint pass (caught and fixed a real lint error: `Date.now()` inside an upload handler tripped the `react-hooks/purity` rule — switched to `crypto.randomUUID()` for the storage path). Dev server starts clean, no runtime errors on the route. **UI not yet verified in browser with a real session.**

Known gaps:
- No PO total value display (sum of qty × unit_price) — not in the doc's column list, can add if wanted.
- Phase 6 will need its own way to move a PO to PARTIAL_RECEIVED/COMPLETED — likely a dedicated function Receiving calls directly, not through `update_purchase_order_status()`.

## Phase 6 — Receiving: สถานะ **บางส่วน (DB เสร็จ+verified, UI ยังไม่ได้ทดสอบในเบราว์เซอร์)**

First phase that touches physical stock, so this is also where the foundational stock infrastructure (`lots`, `stock_balance`, `stock_transactions`) got built — every later stock-touching phase builds on these same three tables.

Done:
- Migration `supabase/migrations/0010_receiving.sql`: `lots` (lot_no via new `lot` doc_type, prefix `LOT`), `stock_balance` (one row per lot+location — a lot's qty can later split across locations, e.g. IQC pass/hold/ng), `stock_transactions` (**append-only ledger**, no insert/update/delete policy exists for authenticated at all — only `confirm_goods_receipt()` writes it; `txn_type` check constraint currently only allows `'RECEIPT'` and will be widened, never shrunk, as later phases add movement types), `goods_receipts`/`goods_receipt_lines`.
- `confirm_goods_receipt(po_id, lines)` RPC: header + every line's new lot + stock_balance upsert + ledger entry, all in one transaction. Enforces the receiving location's `zone_type = 'INCOMING'` at the DB level (not just trusted to the UI) and that the PO is in `CONFIRMED`/`PARTIAL_RECEIVED` status. Also rolls the PO's status forward to `PARTIAL_RECEIVED`/`COMPLETED` by comparing total received vs. ordered qty per line — this is the dedicated Phase-6-only path into those two statuses that `update_purchase_order_status()` (Phase 5) deliberately excludes.
- Verified against the real dev DB with a full lifecycle: receiving against a DRAFT PO rejected, receiving into a WIP-zone location rejected, partial receipt (40/100) correctly rolled PO to `PARTIAL_RECEIVED` with lot `LOT-2026-00001` and a `+40 RECEIPT` ledger entry, remaining receipt (60/100) correctly rolled PO to `COMPLETED` and created a **second, independently traceable lot** `LOT-2026-00002` rather than merging into the first. RLS confirmed enabled on all 5 new tables. All test data cleaned up after.
- **Barcode scanning implemented as a keyboard-wedge input** (`src/components/ScanInput.tsx`) rather than phone-camera scanning — this matches how real warehouse barcode scanner hardware actually works (it types the decoded value + Enter, like a keyboard), and is something I could build without needing camera/device APIs I can't test here. QR payloads are versioned JSON (`src/lib/barcode.ts`, matches the format agreed at Phase 2 — see Scope decisions), with a plain-code fallback (matching directly against `po_no`/`barcode_value`) for simpler 1D barcodes or manual typing.
- Purchase orders got a new `barcode_value` column (nullable) so a PO can be scanned to auto-select it in Receiving — not auto-populated yet (no label-printing UI until Phase 22), so it's blank until you set one manually or Phase 22 wires it up.
- UI: `/receiving` — scan-or-select PO, shows remaining qty per line (ordered − already received), qty + INCOMING-location entry per line, receipt history list.
- Build + typecheck + lint pass, dev server starts clean, no runtime errors on the route. **UI not yet verified in browser with a real session**, and **scanning specifically is unverified with real hardware** — I have no physical barcode scanner or camera in this environment, only the manual-typing path is actually exercised by me.

Known gaps:
- `stock_transactions.txn_type` check constraint will need a migration each time a new movement type is added (IQC split in Phase 7, WIP request in Phase 9, etc.) — expected, not a bug.
- No barcode label printing yet (Phase 22).

## Key files

- `supabase/migrations/0001_document_numbering.sql` — document numbering
- `supabase/migrations/0002_users_permissions.sql` — roles, sites, user_profiles, user_sites, role_permissions, audit_log, custom JWT claims hook, RLS
- `supabase/migrations/0003_bootstrap_first_admin.sql` — first signup becomes ADMIN
- `supabase/migrations/0004_fix_bootstrap_role_cast.sql` — fixes the enum-cast bug in 0003
- `supabase/migrations/0005_fix_hook_search_path.sql` — fixes search_path bug in the JWT claims hook
- `supabase/migrations/0006_master_data.sql` — customers, suppliers, items, locations, sample-size lookup tables, inspection_plans, `has_permission()`, `get_sample_size_plan()`
- `src/types/master-data.ts` — types for all Phase 2 tables
- `src/components/master-data/EntityManager.tsx`, `Field.tsx` — shared list+add-form UI used by all `/master-data` tabs
- `src/app/(app)/master-data/` — Master Data page + tabs
- `supabase/migrations/0007_customer_forecast.sql` — forecast_batches, forecast_lines (append-only), create_forecast_batch(), update_forecast_batch_status()
- `src/lib/csv.ts` — hand-written CSV parser (no vulnerable xlsx dependency)
- `src/types/forecast.ts` — forecast types + legal status transition map
- `src/app/(app)/forecast/` — Customer Forecast page (CSV import + batch list)
- `supabase/migrations/0008_demand_stock_planning.sql` — stock_planning_snapshot, refresh_stock_planning(), pg_cron hourly job
- `src/types/planning.ts`, `src/app/(app)/planning/` — Demand & Stock Planning dashboard
- `supabase/migrations/0009_purchase_orders.sql` — purchase_orders, purchase_order_lines, purchase_order_line_attachments, po-attachments storage bucket, create_purchase_order(), update_purchase_order_status()
- `src/types/purchase-order.ts`, `src/app/(app)/purchase-orders/` — Purchase Order page
- `supabase/migrations/0010_receiving.sql` — lots, stock_balance, stock_transactions (append-only ledger), goods_receipts, goods_receipt_lines, confirm_goods_receipt()
- `src/lib/barcode.ts` — QR payload type + parser (shared across all future scanning UI)
- `src/components/ScanInput.tsx` — reusable keyboard-wedge scanner input (shared across all future scanning UI)
- `src/types/receiving.ts`, `src/app/(app)/receiving/` — Receiving page
- `src/proxy.ts` — auth-gate for all routes except `/login` (Next.js 16 middleware replacement)
- `src/app/(app)/layout.tsx` — authenticated shell (Sidebar/Header), redirects to `/login` if no session
- `src/app/login/page.tsx` — sign-in
- `src/app/(app)/settings/users/` — ADMIN user/role management
- `src/types/auth.ts` — `AppRole`, `Module`, `UserProfile`, `RolePermission` types (kept in sync with the SQL check constraints — update both together)
- `src/components/layout/nav-items.ts` — sidebar nav structure (grouped by operational flow, not Phase number)
- `.env.local.example` — required env vars

## Roles (Phase 1)

ADMIN, MANAGEMENT, PLANNING, PURCHASING, WAREHOUSE, QC, SALES — first person to sign up becomes ADMIN automatically, everyone after needs an ADMIN to assign their role via `/settings/users`.
