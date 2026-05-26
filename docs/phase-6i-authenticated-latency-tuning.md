# Phase 6I Authenticated Latency Tuning

Phase 6I keeps IScraper on Vercel and tunes the authenticated hot paths measured in Phase 6H. It does not change public API behavior, deployment topology, database schema, worker architecture, or frontend behavior.

## Baseline

Phase 6H valid-token deployed run:

| Route group | k6 p95 | k6 p99 | Result |
| --- | ---: | ---: | --- |
| authenticated | 3.53 s | 3.79 s | Above target |
| search | 7.37 s | 7.42 s | Above target |

Sanitized Vercel logs showed warm requests only. Server p95 was `6555ms`; search was the slowest path, and store/user setup p95 was around `1568ms`.

## Changes

- Authenticated middleware now records separate `authMs`, `accountSafetyMs`, and `userSetupMs` timings.
- Successful auth-token user lookup is cached briefly per runtime instance.
- Successful user-row setup is cached briefly per runtime instance.
- Deletion/account safety remains checked on every authenticated request.
- `GET /api/profile` records `profileFetchMs`.
- `GET /api/items?limit=...` can record `listPageFetchMs`, `listPageMapMs`, and `listFacetFetchMs`.
- `POST /api/search` records search fetch/scoring/event timings and uses a lean keyword path when semantic search is not explicitly requested.
- No-AI search no longer attempts semantic provider credential lookup by default.

## First Deployed Result

After deploying `0402f0e`, the valid-token load profile still passed all functional checks but missed latency thresholds:

| Route group | k6 p95 | k6 p99 | Result |
| --- | ---: | ---: | --- |
| authenticated | 5.29 s | 6.27 s | Above target |
| search | 9.15 s | 10.33 s | Above target |

Parsed server logs confirmed `200` responses and no cold starts. Auth and user setup were effectively removed from the hot path (`authMs` p95 `0`, `userSetupMs` p95 `0`), but remaining costs were account safety, item/list mapping, and search item fetching. This led to a follow-up code adjustment in the same phase: timing keys were renamed to avoid sanitizer redaction, and lean search now first tries a bounded candidate fetch before falling back to the full searchable set.

## Validation

Required checks:

```powershell
node -c apps\orchestration\src\server.js
node -c apps\orchestration\src\application\searchWorkflow.js
node -c apps\orchestration\src\stores\supabaseStore.js
npm.cmd --workspace @iscraper/orchestration test
npm.cmd test
npm.cmd run build
npm.cmd run lint
npm.cmd run security:boundaries
npm.cmd run routes:inventory
```

Deployed evidence command:

```powershell
$env:AUTH_TOKEN = Get-Clipboard
$env:BASE_URL = 'https://iscraper.vercel.app'
$env:LOAD_PROFILE = 'deployed-auth-readonly'
npm.cmd run load:auth
```

Acceptance target: authenticated read p95 below `1.5s`; search p95 materially reduced, ideally below `1.5s`. If server-side search remains high, Phase 6J should inspect Supabase query plans and targeted indexes.
