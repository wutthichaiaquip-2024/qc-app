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
- Local git repo initialized (by create-next-app), **not yet committed** — holding until you finish switching GitHub accounts

Blocked / needs your action:
- **Docker Desktop is not running/installed on this machine** — local `supabase start` failed (`LegacyDockerLifecycleInspectError`). Not needed right now since we're using the cloud dev project directly, but worth fixing eventually for offline/fast local iteration.
- **Staging + prod Supabase projects** — only one cloud project (`mmkprjuiiwzttalmuips`) has been linked so far, treated as **dev**. Create separate projects for staging/prod when ready (doc requires 3 real separate projects, not branches).
- **GitHub repo** — not created/pushed yet, you're switching accounts. Local git repo exists in `C:\qc-app`, not yet committed.
- **Vercel deployment** — not connected yet (needs your Vercel account).
- Barcode symbology/payload standard (Code128 vs QR, payload structure) — not decided yet, needed before Phase 2 schema is finalized.

Not started: item/lot/location schema (Phase 2), RLS/roles (Phase 1), everything else.

## Key files

- `supabase/migrations/0001_document_numbering.sql` — document numbering
- `src/components/layout/nav-items.ts` — sidebar nav structure (grouped by operational flow, not Phase number)
- `.env.local.example` — required env vars

## Roles (Phase 1, not yet implemented)

ADMIN, MANAGEMENT, PLANNING, PURCHASING, WAREHOUSE, QC, SALES
