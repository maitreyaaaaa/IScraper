# Phase 6K Reproducible Authenticated Latency Evidence

Phase 6K fixes the evidence gap from Phase 6J: authenticated latency runs must use a real Supabase Auth user session, not a copied management token or expired browser token.

## What Changed

- Added `npm.cmd run load:auth:supabase`.
- The runner signs in with a dedicated Supabase test user and passes the access token to k6 only through the child process environment.
- The runner preflights the deployed API before k6 starts:
  - `GET /api/profile`
  - `GET /api/items?limit=1`
  - `POST /api/search` with `includeAi:false`
- Preflight output is sanitized and prints only method, route, status, duration, and category.
- The k6 authenticated harness now counts `401`, `403`, and `428` as invalid authenticated evidence, separate from normal latency failures.

## Required Environment

```powershell
$env:BASE_URL = 'https://iscraper.vercel.app'
$env:LOAD_PROFILE = 'deployed-auth-readonly'
$env:SUPABASE_URL = '<project-url>'
$env:SUPABASE_ANON_KEY = '<anon-key>'
$env:SUPABASE_TEST_EMAIL = '<dedicated completed-profile test user email>'
$env:SUPABASE_TEST_PASSWORD = '<dedicated test user password>'
npm.cmd run load:auth:supabase
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are accepted as fallbacks for the Supabase URL and anon key.

## Evidence Rules

- A run with any `401`, `403`, or `428` is invalid auth evidence, even if there are no `5xx` responses.
- A valid run must pass preflight first, then report k6 p95/p99 for profile, items, indexing summary, and no-AI search.
- Vercel logs should be parsed only for sanitized timing fields such as `authMs`, `accountSafetyMs`, `listPageFetchMs`, `listPageMapMs`, `searchCandidateFetchMs`, and `searchEventInsertMs`.
- Access tokens, refresh tokens, emails, URLs, captions, request bodies, and user IDs must not be printed in reports.

## Current Status

Phase 6J deployed validation was invalid because every authenticated scenario returned `401`. Phase 6K makes that failure mode explicit and reproducible.

Local validation confirmed:

- The runner fails before k6 when required Supabase test-user env vars are missing.
- The k6 harness parses successfully with `iscraper_auth_invalid_responses` thresholding enabled.
- Deployed authenticated validation still requires a dedicated completed-profile Supabase test user in env.

No Supabase migration is applied in this phase. If valid deployed evidence still misses the `1.5s` p95 target, the next phase should be an explicit review/apply plan for the existing Phase 6J performance-index migration.
