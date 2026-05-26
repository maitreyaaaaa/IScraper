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
- Added the safe `GET /api/health` warmup target. A five-minute Vercel Cron warmup was attempted, but Vercel rejected it because this project is on a Hobby account and schedules more frequent than daily require Pro. The active production config therefore omits the cron until the account supports it.
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

## Cron Constraint

Desired warmup:

```json
{
  "path": "/api/health",
  "schedule": "*/5 * * * *"
}
```

Current production status: not active. `npx vercel --prod --yes` rejected this schedule on May 27, 2026 because the linked Vercel account is Hobby-tier and only allows daily cron jobs. Do not re-add the five-minute cron to `vercel.json` until the project is on a plan that supports it, or production deploys will fail.

## Post-Deploy Results

Production deployment:

- Commit: `7aaf5af`
- Deployment: `https://iscraper-50nu71oz9-dashboard-me.vercel.app`
- Production alias: `https://iscraper.vercel.app`
- Build region: Washington, D.C., USA, `iad1`
- Function bundle: `api/index`, `5.23MB`, `iad1`
- Vercel build machine: 2 cores, 8 GB

Smoke checks:

- `GET /api/health` returned `200`, `Cache-Control: no-store`, and an `X-Request-ID`.
- `GET /api/credit-packages` returned `200` and preserved the existing public response.
- Conservative deployed load testing used `LOAD_PROFILE=deployed-warmup`.

| Sample | Requests | k6 p95 | k6 p99 | Server max | Cold starts | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Idle-window deployed warmup smoke | 81 | 592.51 ms | 1.76 s | 4 ms sampled | 0 sampled | Overall passed; admin route-group p95 was 1.6 s on a very small worker-status sample |
| Immediate warm deployed warmup smoke | 82 | 286.49 ms | 457.22 ms | 8 ms sampled | 0 sampled | Passed |

Vercel log sampling used sanitized `api request completed` events deduped by `requestId`. The sampled route groups were `admin`, `authenticated`, `import`, `public`, and `search`. No user content, captions, URLs, emails, tokens, provider keys, or request bodies were present in the sampled completion logs.

## Next Decision

Idle-window overall p95 improved from Phase 6F `1.96s` to `592.51ms`, and warm p95 improved to `286.49ms`. Keep Vercel for now.

The remaining caveat is the idle admin route-group p95: it crossed `1.5s` at `1.6s`, but that group had a tiny sample and represented protected worker-status fallback checks, not user browsing/import/search paths. Treat this as evidence to keep measuring rather than as a platform migration trigger.

Phase 6H should test authenticated real-user flows and region placement before any hosting migration. Revisit five-minute cron warmup only after the Vercel account supports schedules more frequent than daily.
