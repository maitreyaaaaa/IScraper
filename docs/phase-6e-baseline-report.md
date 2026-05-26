# Phase 6E Baseline Report

Generated on 2026-05-26 after the Vercel-compatible scale readiness work.

## Checks

| Check | Result |
| --- | --- |
| Backend tests | Pass: `npm.cmd --workspace @iscraper/orchestration test`, 164 tests |
| Full workspace tests | Pass: `npm.cmd test`, 164 tests |
| Build | Pass: `npm.cmd run build` |
| Lint | Pass: `npm.cmd run lint` |
| Browser secret boundary | Pass: `npm.cmd run security:boundaries` |
| Route inventory | Pass: `npm.cmd run routes:inventory` |

## Local k6 Smoke

Environment:

- `BASE_URL=http://127.0.0.1:3091`
- temp local JSON data directory
- `POSTHOG_ENABLED=false`
- `INLINE_INDEXING_ENABLED=false`
- temporary admin key for aggregate worker status only
- local-only high rate-limit settings to measure route behavior instead of throttling

Workload:

- browse reads: 3 iterations/sec for 20 seconds
- upload/imports: 1 iteration/sec for 20 seconds
- search: 2 iterations/sec for 20 seconds
- worker status: 0.2 iterations/sec for 20 seconds

Result:

- Passed all thresholds.
- 128 HTTP requests.
- p95 HTTP duration: 5.12 ms.
- p99 HTTP duration: 7.55 ms.
- HTTP failed rate: 0.00%.
- Custom failed checks: 0.00%.

## Vercel Conservative Smoke

Environment:

- `BASE_URL=https://iscraper.vercel.app`
- no production auth token
- no admin key
- auth-sensitive routes exercised fail-closed with bounded non-5xx responses

Workload:

- browse reads: 1 iteration/sec for 10 seconds
- upload/imports: 1 iteration/sec for 10 seconds
- search: 1 iteration/sec for 10 seconds
- worker status: 0.2 iterations/sec for 10 seconds

Result:

- Custom route checks passed.
- HTTP failed rate: 0.00%.
- p99 HTTP duration: 1.86 s, under the 3.0 s threshold.
- p95 HTTP duration: 1.75 s, above the 1.5 s readiness target.
- Dropped iterations: 4.

## Findings

- Local route behavior is healthy under the smoke mix.
- The deployed Vercel smoke shows no server-error or auth-boundary failure, but p95 latency is already above the readiness target under a tiny conservative mix.
- Next optimization should focus on deployed route latency evidence before changing hosting:
  - inspect Vercel function logs by route group
  - separate cold-start latency from route processing time
  - confirm whether auth-fail-closed paths are paying avoidable store initialization cost
  - keep import/search/worker checks conservative until route-level timings are visible

No migration decision should be made from this smoke alone. It is enough evidence to justify deeper deployed observability and route timing work.
