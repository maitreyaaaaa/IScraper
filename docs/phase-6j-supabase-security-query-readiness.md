# Phase 6J Supabase Security And Query Readiness

Phase 6J keeps IScraper on Vercel and strengthens the evidence layer before any infrastructure change. It does not apply live database changes.

## What Changed

- Added `npm.cmd run security:supabase` for static Supabase migration checks:
  - RLS must be enabled for app tables.
  - Storage buckets must be private and user-folder owned.
  - `security definer` functions must set `search_path`.
  - Known server-only tables are reported as review items, not browser-accessible policies.
- Added `npm.cmd run db:audit:supabase` for read-only Supabase evidence:
  - aggregate RLS/policy inventory
  - aggregate index inventory for hot tables
  - aggregate table stats
  - sanitized query-plan summaries for account deletion lookup, first-page item reads, and no-AI candidate search
- Extended `npm.cmd run routes:inventory` with upload/body-limit and sensitive-output-risk columns, and failure checks for high-risk auth/rate-limit regressions.
- Added draft migration `202605270001_phase6j_supabase_performance_indexes.sql`.
  - This migration is authored for review only.
  - It must not be applied to production without explicit approval.
- Reduced one safe Supabase round trip:
  - `recordSearchEvent` now inserts the event without selecting it back.
  - Public `/api/search` response shape remains unchanged.

## Draft Migration Recommendation

The draft migration targets the Phase 6I bottlenecks:

- partial indexes for completed account deletion audit hash checks
- saved-item ordering/filter indexes for first-page library reads
- `pg_trgm` candidate-search indexes for no-AI keyword search fields

## Read-Only Supabase Evidence

`npm.cmd run db:audit:supabase` completed against project `bkmxhavrbziakiqmdsqo` with read-only Supabase Management API access.

Live aggregate security evidence:

- 33 public tables reported with RLS enabled.
- 29 tables have direct policy coverage.
- `account_deletion_audit`, `admin_credit_adjustments`, `user_activity_events`, and `user_admin_states` have RLS enabled with no browser-facing policy in the live inventory.
- Static migration security check reports the known server-only tables as review items, not public access paths.

Live aggregate query evidence:

- `account_deletion_audit` currently uses `account_deletion_audit_hash_idx` for the completed hash lookup plan.
- `saved_items_first_page` currently plans through `saved_items_user_updated_idx` with a sort for `created_at desc, id asc`.
- `saved_items_no_ai_candidate_search` currently plans through `saved_items_user_updated_idx`; no trigram search index appears in the plan summary.
- `saved_items` has about 4,914 estimated live rows in the audited project, with materially more index scans than sequential scans.

Recommendation: keep the draft migration as reviewed-before-apply. The saved-item ordering and trigram indexes are still reasonable candidates for the next approved database step because the live plans do not show dedicated `created_at/id` ordering or trigram candidate-search indexes. Apply only after accepting write overhead and lock/build behavior for production.

## Validation Commands

```powershell
node -c scripts\route-inventory.js
node -c scripts\supabase-security-check.js
node -c scripts\supabase-db-audit.js
node -c apps\orchestration\src\stores\supabaseStore.js
npm.cmd --workspace @iscraper/orchestration test
npm.cmd test
npm.cmd run build
npm.cmd run lint
npm.cmd run security:boundaries
npm.cmd run security:supabase
npm.cmd run routes:inventory
```

Read-only Supabase evidence:

```powershell
$env:SUPABASE_PROJECT_REF = 'bkmxhavrbziakiqmdsqo'
npm.cmd run db:audit:supabase
```

Deployed latency evidence:

```powershell
$env:AUTH_TOKEN = Get-Clipboard
$env:BASE_URL = 'https://iscraper.vercel.app'
$env:LOAD_PROFILE = 'deployed-auth-readonly'
npm.cmd run load:auth
```

## Acceptance

Phase 6J is complete when the new local gates pass, query evidence is sanitized and aggregate-only, and the next database action is explicit: apply the reviewed migration later, revise it, or gather more plans. No production database mutation is part of this phase.
