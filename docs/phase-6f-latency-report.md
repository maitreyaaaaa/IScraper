# Phase 6F Latency Evidence Report

Phase 6F added Vercel-safe request timing instrumentation and route-group load-test evidence without changing public API behavior, deployment, storage, auth, rate limits, worker contracts, or frontend code.

## What Changed

- API completion logs now include sanitized timing metadata:
  - `routeGroup`
  - `method`
  - `statusCode`
  - `durationMs`
  - `coldStart`
  - `processUptimeMs`
  - `timings.authMs`
  - `timings.storeEnsureUserMs`
- Timing logs preserve `X-Request-ID` and omit request bodies, URLs, captions, queries, emails, tokens, provider keys, file paths, and secrets.
- The k6 mixed-use harness now supports:
  - `LOAD_PROFILE=local`
  - `LOAD_PROFILE=deployed`
  - route-group tags for `authenticated`, `admin`, `import`, and `search`
  - route-group p95/p99 threshold output.

## Local Smoke

Command:

```powershell
$env:LOAD_PROFILE = 'local'
$env:BASE_URL = 'http://127.0.0.1:3096'
$env:USER_ID = 'phase6f-load-user'
$env:USER_EMAIL = 'phase6f-load@example.test'
$env:ADMIN_API_KEY = 'phase6f-admin-key'
npm.cmd run load:smoke
```

Result:

| Metric | Value |
| --- | ---: |
| Requests | 128 |
| Failed HTTP requests | 0.00% |
| Failed checks | 0.00% |
| Overall p95 | 6.9 ms |
| Overall p99 | 86.39 ms |

Route-group k6 timings:

| Route group | p95 | p99 |
| --- | ---: | ---: |
| admin | 76.45 ms | 90.53 ms |
| authenticated | 4.2 ms | 35.35 ms |
| import | 5.93 ms | 74.16 ms |
| search | 6.22 ms | 43.09 ms |

Server-side local timing logs from the same run:

| Route group | Count | p95 | p99 | Max | Cold starts |
| --- | ---: | ---: | ---: | ---: | ---: |
| public | 1 | 32 ms | 32 ms | 32 ms | 1 |
| authenticated | 61 | 1 ms | 5 ms | 5 ms | 0 |
| import | 21 | 3 ms | 17 ms | 17 ms | 0 |
| search | 41 | 2 ms | 65 ms | 65 ms | 0 |
| admin | 5 | 3 ms | 3 ms | 3 ms | 0 |

Local conclusion: request path work is not the bottleneck in local JSON mode. The first local request carries the expected cold marker; authenticated route auth/store timing is effectively zero locally.

## Deployed Smoke

Command:

```powershell
$env:LOAD_PROFILE = 'deployed'
$env:BASE_URL = 'https://iscraper.vercel.app'
$env:USER_ID = 'phase6f-load-user'
$env:USER_EMAIL = 'phase6f-load@example.test'
Remove-Item Env:\ADMIN_API_KEY -ErrorAction SilentlyContinue
npm.cmd run load:smoke
```

Two conservative deployed runs were captured.

First run:

| Metric | Value |
| --- | ---: |
| Requests | 50 |
| Failed HTTP requests | 0.00% |
| Failed checks | 0.00% |
| Dropped iterations | 1 |
| Overall p95 | 2.07 s |
| Overall p99 | 2.25 s |
| Threshold status | Failed `p95<1500` |

Second run, immediately after adding route-group summaries:

| Metric | Value |
| --- | ---: |
| Requests | 51 |
| Failed HTTP requests | 0.00% |
| Failed checks | 0.00% |
| Overall p95 | 467.65 ms |
| Overall p99 | 492.7 ms |
| Threshold status | Passed |

Second-run route-group timings:

| Route group | p95 | p99 |
| --- | ---: | ---: |
| authenticated | 488.05 ms | 499.2 ms |
| search | 446.03 ms | 457.43 ms |
| admin | 426.28 ms | 441.67 ms |
| import | 316.21 ms | 335.36 ms |

Deployed conclusion: the slow deployed p95 is not consistently tied to one route group. Back-to-back conservative runs ranged from 2.07 s p95 to 467.65 ms p95 with no 5xx and no failed checks. This points first at cold/warm platform variance, function startup, connection/provider warmup, or transient Vercel/Supabase overhead rather than one route workflow dominating every deployed run.

## Cold Start Evidence

The new server timing fields identify process-local cold starts with `coldStart: true`. This was validated locally. The current production deployment does not include these new log fields until this change is deployed, so deployed cold-start attribution is still inferential from back-to-back run variance.

After deployment, inspect sanitized API logs for:

- `coldStart: true` requests over 1500 ms.
- Warm requests over 1500 ms with high `timings.authMs`.
- Warm requests over 1500 ms with high `timings.storeEnsureUserMs`.
- Warm requests over 1500 ms with low auth/store timing, which suggests platform/network/Supabase query work inside handlers.

## Post-Deploy Verification

After deploying commit `b294283`, the production deployment `https://iscraper-ewu8xb7eh-dashboard-me.vercel.app` was ready and aliased to `https://iscraper.vercel.app`.

An idle-window smoke was run after roughly three idle minutes:

| Metric | Value |
| --- | ---: |
| Requests | 50 |
| Failed HTTP requests | 0.00% |
| Failed checks | 0.00% |
| Dropped iterations | 1 |
| Overall p95 | 1.96 s |
| Overall p99 | 2.33 s |
| Threshold status | Failed `p95<1500` |

Idle-window k6 route-group timings:

| Route group | p95 | p99 |
| --- | ---: | ---: |
| admin | 2.03 s | 2.27 s |
| authenticated | 1.78 s | 2.07 s |
| import | 1.64 s | 1.72 s |
| search | 1.83 s | 2.22 s |

Vercel serverless logs for the same slow window showed:

| Route group | Count | Server p95 | Server max | Cold starts | Max auth timing |
| --- | ---: | ---: | ---: | ---: | ---: |
| authenticated | 16 | 16 ms | 16 ms | 3 | 1 ms |
| admin | 4 | 18 ms | 18 ms | 1 | n/a |
| import | 14 | 29 ms | 29 ms | 3 | 0 ms |
| search | 16 | 47 ms | 47 ms | 3 | 1 ms |

An immediate warm smoke was then run:

| Metric | Value |
| --- | ---: |
| Requests | 52 |
| Failed HTTP requests | 0.00% |
| Failed checks | 0.00% |
| Overall p95 | 290.1 ms |
| Overall p99 | 306.28 ms |
| Threshold status | Passed |

Warm k6 route-group timings:

| Route group | p95 | p99 |
| --- | ---: | ---: |
| admin | 254.75 ms | 256.08 ms |
| authenticated | 265.07 ms | 284.89 ms |
| import | 292.51 ms | 297.55 ms |
| search | 290.91 ms | 309.43 ms |

Vercel logs from the warm window showed 200 parsed request-completion records, zero `coldStart: true` records, zero server durations over 1500 ms, and a max server duration of 16 ms.

Post-deploy conclusion: the current conservative smoke routes are not slow inside Express, route handlers, auth, store setup, or Supabase calls. The latency spike happens before or around serverless invocation, while the function fleet is cold or scaling. The next tuning target is Vercel/runtime/platform behavior and network distance, not route workflow optimization.

## Recommended Next Action

Do not migrate hosting and do not add Redis/Upstash yet.

Next, tune Vercel/runtime behavior before changing app architecture:

1. Confirm whether the production function region is intentionally `iad1`; if most early users are outside the US East path, evaluate region placement.
2. Add a tiny production-safe warmup/health endpoint only if it stays aggregate-only and does not bypass auth for sensitive state.
3. Decide whether Vercel Fluid Compute, function max duration, or project runtime settings reduce cold/scaling variance without changing public APIs.
4. Keep import/search workflow optimization deferred until an authenticated, real-credential smoke shows slow server-side `durationMs`, `authMs`, or `storeEnsureUserMs`.
5. Add distributed rate limiting only after evidence shows cross-instance rate-limit correctness is the bottleneck.
