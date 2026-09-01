# AQUIP QC & Inventory System — Test Plan / UAT

Phase 23 deliverable. Consolidates UAT across all 22 feature phases (0–22) plus the three explicit scenarios the master spec calls out by name: concurrency, split-lot, and adjustment transaction.

## Environment

All testing here runs against the linked Supabase project `mmkprjuiiwzttalmuips` — the same project every phase has been built and verified against since Phase 0. It has been acting as staging throughout: no production project exists yet (that's Phase 24's job — provisioning prod, PITR, RLS audit, data migration, cutover). Nothing in this plan touches, or should ever touch, a production database.

## Methodology (read this before the results below)

There is no login credential available in this environment (no email/password for any of the seeded users), so "UAT" here is **not** a human clicking through the UI — it's the same method used to verify every phase since Phase 2: real RPC/SQL calls against the real linked database, with real test data, real assertions on the results, and full cleanup afterward (except where noted below). This is a legitimate way to verify business logic, permissions, and data integrity, but it is **not** a substitute for an actual person clicking through each screen. That gap has been flagged at the end of every phase in `PROJECT_STATE.md` ("UI not yet verified in browser with a real session") and is repeated here as a standing, unresolved gap across the whole system, not just this phase.

## Logical-unit results

| Group | Phases | Status |
|---|---|---|
| Foundation & Auth | 0, 1 | ✅ Verified (Phase 1: real login end-to-end with the bootstrap ADMIN user, JWT claims confirmed) |
| Master Data | 2 | ✅ DB verified. UI: user added a real test customer manually and confirmed it worked (session record) |
| Planning & Purchasing | 3, 4, 5 | ✅ DB verified per-phase |
| Receiving & Incoming QC | 6, 7 | ✅ DB verified per-phase, incl. split-lot (see Scenario 2) |
| WIP & FG Inspection | 8, 9, 10 | ✅ DB verified per-phase, incl. split-lot (see Scenario 2) |
| FG Stock & Sales | 11, 12, 13 | ✅ DB verified per-phase |
| Picking, OQC, Shipping | 14, 15, 16 | ✅ DB verified per-phase |
| Traceability & Dashboard | 17, 18 | ✅ DB verified per-phase, incl. append-only enforcement (see Scenario 3) |
| Forecast Accuracy, Notifications, Reports, Labels | 19, 20, 21, 22 | ✅ DB verified per-phase. Phase 20 email/LINE and Phase 22 real label-printer hardware remain unverified (no external credentials / no physical printer in this environment) |
| Stock Adjustments | 23 (built as a prerequisite — see below) | ✅ DB verified, incl. concurrency (see Scenario 1) |

Full detail for every row above is in `PROJECT_STATE.md`, phase by phase — this table doesn't repeat it, only summarizes status.

## Gap found and closed before UAT could proceed: Adjustment Transaction

Section 3 of the master spec requires it as a direct consequence of the append-only ledger rule ("ผิดต้องสร้าง Adjustment Transaction ใหม่พร้อมผู้อนุมัติ"), and this phase's own scenario list requires testing it — but no phase 1–22 had actually built it. Built now: `supabase/migrations/0029_stock_adjustments.sql` (table + request/approve/reject functions), `0030_stock_adjustment_picker.sql` (UI lookup), `0031_fix_approve_stock_adjustment.sql` (bugfix — see Scenario 3). UI at `/stock-adjustments`. See `PROJECT_STATE.md`'s Phase 23 section for full detail.

## Scenario 1 — Concurrency

**What it proves:** two simultaneous writers to the same stock cannot both read-modify-write past each other (no lost update), and the system serializes them via row locking rather than racing.

**Setup:** one lot/location with `qty=50, reserved_qty=10`. Two separate PENDING adjustments created against it (`-5` each, requested sequentially — request doesn't touch stock, so ordering there doesn't matter).

**Test:** two genuinely concurrent OS processes fired in the same instant:
- Session A: opens a transaction, explicitly locks the `stock_balance` row (`SELECT ... FOR UPDATE`), sleeps 4 seconds while holding that lock, then calls `approve_stock_adjustment()` for its adjustment (which re-locks the same already-held row — safe, same transaction) and commits.
- Session B: calls `approve_stock_adjustment()` for the other adjustment, no delay.

**Result: PASS.** Session B's commit timestamp landed ~0.7s after Session A's (not near-instant, not racing ahead) — proof Session B blocked on the row lock until Session A released it at commit, rather than reading a stale `qty` and overwriting Session A's change. Final state confirmed both adjustments applied correctly: `qty = 50 - 30 (earlier scenario) - 5 - 5 = 10` exactly, not `15` (which is what a lost update would have produced), `reserved_qty` unchanged at `10`, exactly 3 `ADJUSTMENT` ledger rows (one per approved adjustment, none lost or duplicated).

## Scenario 2 — Split-lot

**What it proves:** a single inspection event can legitimately split into pass/hold/ng quantities in one atomic call, never forcing an all-or-nothing result for the whole lot — required by IQC (Phase 7) and FG Inspection (Phase 10).

**Result: PASS**, verified when each phase was originally built (re-verified here by inspection, not re-run, since the underlying functions haven't changed): IQC's `confirm_iqc_inspection()` and FG Inspection's `confirm_fg_inspection()` both accept `qty_pass + qty_hold + qty_ng` in one call, validate the sum doesn't exceed the source lot's quantity, and write one `stock_transactions` row per non-zero disposition into the correct zone (WIP/HOLD/NG or FG/HOLD/NG respectively) — all in the same DB transaction. Phase 21's `get_qc_report()` (built this session) independently confirms this shape is still intact: its test row showed `qty_pass=90, qty_hold=0, qty_ng=10` from one IQC event, `result` correctly derived as `NG` (NG takes priority over HOLD takes priority over PASS).

## Scenario 3 — Adjustment Transaction

**What it proves:** the append-only ledger rule actually holds (no UPDATE/DELETE possible on `stock_transactions`, not even to fix a mistake), and the only sanctioned correction path — a new, approved Adjustment Transaction — works correctly including its guardrails.

**Result: PASS**, with one real bug found and fixed along the way:
- Requesting an adjustment does not touch stock (`PENDING`, no ledger entry) — confirmed.
- Approving an adjustment that would drop `qty` below the currently-reserved quantity is rejected before any write happens (`qty=50, reserved=10, delta=-45` → rejected with the exact reason in the error message) — confirmed.
- **Bug found:** the first version of `approve_stock_adjustment()` used the same `INSERT ... ON CONFLICT DO UPDATE` pattern every other `confirm_*()` function in this codebase uses — which only ever adds stock. Approving a *negative* delta against an existing `stock_balance` row failed the table's `qty >= 0` check constraint, because Postgres validates that constraint against the literal `INSERT` row before it even considers redirecting to the `ON CONFLICT` `UPDATE` branch. Fixed in `0031_fix_approve_stock_adjustment.sql` by branching explicitly on whether the row already exists (known from the lock already taken) instead of relying on `ON CONFLICT` to do it implicitly. Re-tested after the fix: passed.
- A valid adjustment (`-30`, leaves `qty=20 ≥ reserved=10`) was approved successfully: exactly one `ADJUSTMENT` ledger row written, `stock_balance.qty` updated correctly, `stock_adjustments.status` moved to `APPROVED` with `decided_by`/`decided_at` set.
- Re-approving an already-`APPROVED` adjustment is rejected (`status = APPROVED`, not `PENDING`) — confirmed, no double-application possible.
- Directly attempting `DELETE FROM stock_transactions` on the `ADJUSTMENT` row it just wrote was rejected by the Phase 17 append-only trigger — confirmed the trigger has no special case for this new `txn_type`.
- `stock_adjustments.create`/`.approve` permission gates confirmed: denied when off, restored, passed when on.

## A side effect of Scenario 1 & 3 worth knowing about

Scenarios 1 and 3 deliberately exercised the *real* `stock_transactions` ledger (that's the point — proving the real append-only trigger holds under real concurrent load). Consequence: the test rows they created (site/location/item/lot/stock_balance/stock_adjustments, all tagged `RPT23TEST-*`) **cannot be deleted** — `DELETE FROM stock_transactions` was rejected exactly as designed, and every other row in that chain is FK-referenced by those ledger rows, so none of it can be removed either without disabling the append-only trigger, which would defeat the entire point of the test. Every other phase's test data was fully cleaned up after verification (confirmed back to 0 rows); this one small, clearly-tagged, harmless set of rows is a permanent fixture of this dev/staging project from here on — a real demonstration of the rule working, not an oversight. It should either be left alone or wiped when the project resets for Phase 24's actual production cutover (that reset would be a fresh project anyway, not a delete against this one).

## Known gaps carried forward

- No real user has clicked through any screen in this system yet — every phase's UI is unverified in a real browser session (no login credentials available here). This is the single largest remaining risk before go-live and should be the first thing done once real credentials exist, ideally per logical group above rather than all at once.
- Phase 20: email (Resend) and LINE notification delivery — code is real, deployment/testing needs the user's own API credentials.
- Phase 22: label print CSS targets a generic 100mm×60mm size — unverified against real label-printer hardware/stock.
- Phase 6/14: barcode scanning verified only via manual typing — no physical scanner in this environment.
- AQL Ac/Re sampling table (Phase 2): structure only, QC must fill in the real numbers from their standard.
- Defect codes (Phase 7): empty by design, QC owns the taxonomy.
