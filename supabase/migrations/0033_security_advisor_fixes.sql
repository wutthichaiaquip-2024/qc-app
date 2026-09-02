-- Phase 24 (follow-up): fixes for all 108 SQL-level findings from
-- Supabase's Security Advisor (the 109th, leaked-password-protection,
-- is an Auth dashboard toggle, not a SQL fix — enabled separately).
--
-- Two real, distinct gaps, confirmed by reading pg_proc.proacl for
-- every function in `public` before writing this (not guessed):
--
-- 1. function_search_path_mutable (7 functions): predate the
--    `set search_path = public` convention every function since
--    Phase 6 has followed. A real search-path-hijack surface.
--
-- 2. anon_security_definer_function_executable (42 functions):
--    every function created before ~Phase 20 relies on Supabase's
--    project-level `ALTER DEFAULT PRIVILEGES` grant to `authenticated`
--    for its real access, but was NEVER explicitly revoked from
--    PUBLIC — so the Postgres default (every new function is
--    EXECUTE-able by PUBLIC unless revoked) was silently still in
--    effect underneath, making all of them callable by `anon`
--    (unauthenticated) too. Every one of them already checks
--    has_permission()/requires a real JWT internally, so this was
--    not an active data-leak (an anon call gets 0 rows or a
--    "Permission denied" exception) — but it's a real defense-in-depth
--    gap: a single missed has_permission() check anywhere would have
--    been directly exploitable with no login at all. Phases 20+
--    already do `revoke ... from public, anon; grant ... to
--    authenticated;` explicitly on every new function — this brings
--    everything built before that consistently in line.
--
-- One statement fixes all 42 at once (and doesn't touch functions in
-- `extensions` schema, e.g. pg_cron/pg_net, which live outside
-- `public`): revoking PUBLIC removes anon's *inherited* access:
revoke execute on all functions in schema public from public;

-- A handful of purely internal helpers/trigger functions also had an
-- explicit `authenticated` grant from that same project-level default
-- privilege — revoking PUBLIC alone doesn't touch that separate grant.
-- None of these are ever meant to be called directly via RPC (trigger
-- functions fire regardless of role grants — this doesn't touch their
-- actual behavior, only closes off the pointless direct-RPC surface).
-- Confirmed via `grep -r ".rpc(" src/` that no client code calls any
-- of these directly.
revoke execute on function
  has_permission(text, text),
  requesting_role(),
  generate_document_number(text),
  enforce_fg_stock_origin(),
  prevent_stock_transactions_mutation(),
  set_updated_at(),
  audit_trigger_fn(),
  handle_new_auth_user(),
  rls_auto_enable()
from authenticated;

-- get_sample_size_plan() is the one exception among the "internal"
-- group: IqcManager.tsx calls it directly to preview the sample-size
-- plan before submitting an inspection, so `authenticated` access
-- must stay — only PUBLIC (and therefore anon) needed revoking,
-- already done by the blanket statement above.

-- Pin search_path on the 7 flagged functions (ALTER, not CREATE OR
-- REPLACE — same body, no behavior change).
alter function has_permission(text, text) set search_path = public;
alter function requesting_role() set search_path = public;
alter function generate_document_number(text) set search_path = public;
alter function get_sample_size_plan(uuid, integer) set search_path = public;
alter function enforce_fg_stock_origin() set search_path = public;
alter function prevent_stock_transactions_mutation() set search_path = public;
alter function set_updated_at() set search_path = public;
