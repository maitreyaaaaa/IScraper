# Phase 6G Vercel Runtime Tuning

Phase 6G keeps IScraper on Vercel and tunes the current serverless runtime path before any hosting migration.

## Baseline

Phase 6F production evidence:

| Sample | k6 p95 | k6 p99 | Server max | Cold starts | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Idle-window deployed smoke | 1.96 s | 2.33 s | 47 ms | 10 | Missed `p95<1500` |
| Immediate warm deployed smoke | 290.1 ms | 306.28 ms | 16 ms | 0 | Passed |

Conclusion: the slow path is Vercel/serverless invocation and warmup behavior, not Express route work, auth, store setup, or Supabase calls for the conservative fail-closed smoke routes.

## Runtime Changes

- Enabled Vercel Fluid Compute with top-level `"fluid": true`.
- Kept the API function explicitly in `iad1`.
- Removed the `memory` setting from `vercel.json` because Fluid Compute does not support configuring memory there.
- Added Vercel Cron warmup for `GET /api/health` every five minutes.
- Added `GET /api/health` as a public, aggregate-only runtime endpoint.
- Extended the k6 harness with health probes and `LOAD_PROFILE=deployed-warmup`.

## Health Endpoint Contract

`GET /api/health` returns:

```json
{
  "status": "ok",
  "runtime": {
    "coldStart": false,
    "processUptimeMs": 0
  },
  "timestamp": "2026-05-27T00:00:00.000Z"
}
```

The endpoint must not call the store, read database state, expose user content, expose user identifiers, expose URLs, expose captions, or expose secrets. It sets `Cache-Control: no-store` and still participates in normal request ID and observability logging.

## Verification Commands

Local and repo checks:

```powershell
node -c apps\orchestration\src\server.js
node -c apps\orchestration\src\services\observability.js
npm.cmd --workspace @iscraper/orchestration test
npm.cmd test
npm.cmd run build
npm.cmd run lint
npm.cmd run security:boundaries
npm.cmd run routes:inventory
```

Deployed evidence:

```powershell
$env:LOAD_PROFILE = 'deployed-warmup'
$env:BASE_URL = 'https://iscraper.vercel.app'
$env:USER_ID = 'phase6g-load-user'
$env:USER_EMAIL = 'phase6g-load@example.test'
Remove-Item Env:\ADMIN_API_KEY -ErrorAction SilentlyContinue
npm.cmd run load:smoke
```

Run once after an idle window and once immediately afterward. Inspect Vercel JSON logs for server-side `durationMs`, `coldStart`, and route group evidence.

## Post-Deploy Results

Pending deployment verification.

| Sample | Requests | k6 p95 | k6 p99 | Server max | Cold starts | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Idle-window deployed warmup smoke | TBD | TBD | TBD | TBD | TBD | TBD |
| Immediate warm deployed warmup smoke | TBD | TBD | TBD | TBD | TBD | TBD |

## Next Decision

If idle-window p95 improves under `1.5s`, keep Vercel and continue gathering real-user and authenticated-flow evidence.

If idle-window p95 still misses but server-side `durationMs` stays low, Phase 6H should test region placement and authenticated real-user flows before any hosting migration.

If server-side `durationMs`, `authMs`, or `storeEnsureUserMs` becomes high, optimize the corresponding application path before platform changes.
