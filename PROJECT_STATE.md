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
- Barcode symbology/payload standard (Code128 vs QR, payload structure) — not decided yet, needed before Phase 2 schema is finalized.

## Phase 1 — User & Permission: สถานะ **บางส่วน**

Done:
- Migration `supabase/migrations/0002_users_permissions.sql`: `app_role` enum (7 roles), `sites` (minimal, expands in Phase 2), `user_profiles`, `user_sites` (multi-site mapping), `role_permissions` (View/Create/Edit/Approve/Reject/Delete × 18 modules — seeded ADMIN=full access, everyone else=view-only as a **safe starting default, not a finished business decision**), `audit_log` + generic `audit_trigger_fn()` wired onto all 4 new tables, RLS enabled + policies on all of them.
- Custom Access Token Hook (`custom_access_token_hook`) injects `app_role` + `site_ids` into the JWT so RLS elsewhere can read `auth.jwt()` directly. Enabled on the cloud project via `supabase config push` (see `config.toml`).
- `handle_new_auth_user()` trigger auto-creates a `user_profiles` row on signup; migration `0003_bootstrap_first_admin.sql` makes the **first** signup become `ADMIN`/`ACTIVE` automatically (otherwise nobody could ever assign the first role), every signup after that lands as `role=null`/`status=PENDING` until an ADMIN assigns a role.
- Verified against the real dev DB: seed counts correct (ADMIN 18/18 view+create, others 18/0), RLS enabled on all 5 tables, audit trigger fires correctly on insert (test row inserted/verified/deleted).
- UI: `/login` (email+password sign-in), route-group shell `src/app/(app)/layout.tsx` redirects unauthenticated users to `/login` (via `src/proxy.ts`, Next.js 16's replacement for `middleware.ts`), `Header` shows real signed-in user + role, `/settings/users` lets ADMIN view all users and change role/status (RLS-enforced; non-admins see read-only).
- Verified in browser: unauthenticated visit to `/` correctly redirects to `/login`.
- ⚠️ Incident during this phase: `supabase config push` initially overwrote unrelated auth security settings on the live project (disabled email confirmation, disabled MFA, weakened rate limits) as a side effect of enabling the JWT hook — caught and reverted immediately, confirmed `up to date` against prior values. Lesson: always diff `config push` output before trusting it; don't push config changes without reviewing every line of the diff.
- ⚠️ Bug found when you tried creating the first user via Supabase Studio: `handle_new_auth_user()` from `0003_bootstrap_first_admin.sql` had `case when v_is_first then 'ADMIN' else null end` — Postgres resolves that CASE to type `text` (not `app_role`), so every single user creation failed with "Database error creating new user" (root cause: `column "role" is of type app_role but expression is of type text"`). Fixed in `supabase/migrations/0004_fix_bootstrap_role_cast.sql` (explicit `::app_role` cast), verified by reproducing the exact insert pattern before and after the fix. Confirmed the failed attempt left no orphaned `auth.users` row (transaction rolled back cleanly) — safe to retry user creation now.

Blocked / needs your action:
- **Nobody has signed up yet** — the login flow itself (credentials submit → session → dashboard) hasn't been tested with a real account, since creating one requires your real email (signup confirmation emails are on) and I won't create accounts on your behalf. Sign up as the first user (no dedicated `/signup` page built yet, only `/login` — sign up via Supabase Studio's Authentication > Users > Invite, or tell me and I'll build a signup page) and you'll automatically become ADMIN.
- **Public self-signup is currently ON** (`enable_signup = true`, project default — I have not changed this). For an internal company system you may want ADMIN-only invites instead once you have your first admin account; flagging rather than changing it myself since it's an auth security setting.
- `role_permissions` seed (view-only default for non-ADMIN roles) needs real business sign-off per role/module — not blocking, just not final.

Not started: item/lot/location schema (Phase 2), everything after.

## Key files

- `supabase/migrations/0001_document_numbering.sql` — document numbering
- `supabase/migrations/0002_users_permissions.sql` — roles, sites, user_profiles, user_sites, role_permissions, audit_log, custom JWT claims hook, RLS
- `supabase/migrations/0003_bootstrap_first_admin.sql` — first signup becomes ADMIN
- `supabase/migrations/0004_fix_bootstrap_role_cast.sql` — fixes the enum-cast bug in 0003
- `src/proxy.ts` — auth-gate for all routes except `/login` (Next.js 16 middleware replacement)
- `src/app/(app)/layout.tsx` — authenticated shell (Sidebar/Header), redirects to `/login` if no session
- `src/app/login/page.tsx` — sign-in
- `src/app/(app)/settings/users/` — ADMIN user/role management
- `src/types/auth.ts` — `AppRole`, `Module`, `UserProfile`, `RolePermission` types (kept in sync with the SQL check constraints — update both together)
- `src/components/layout/nav-items.ts` — sidebar nav structure (grouped by operational flow, not Phase number)
- `.env.local.example` — required env vars

## Roles (Phase 1)

ADMIN, MANAGEMENT, PLANNING, PURCHASING, WAREHOUSE, QC, SALES — first person to sign up becomes ADMIN automatically, everyone after needs an ADMIN to assign their role via `/settings/users`.
