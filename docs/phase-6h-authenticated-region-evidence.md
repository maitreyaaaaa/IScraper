# Phase 6H Authenticated And Region Evidence

Phase 6H keeps IScraper on Vercel and does not change production routing. The goal is to close the evidence gap left by the auth-fail-safe smoke tests: measure real signed-in routes and confirm current region routing before any migration or region move.

## Scope

- No hosting migration.
- No production region move.
- No database migration.
- No frontend changes.
- No public API behavior changes.
- No new external infrastructure.

## New Evidence Tools

### Authenticated k6 Profile

Script:

```powershell
npm.cmd run load:auth
```

Required environment:

```powershell
$env:AUTH_TOKEN = '<dedicated Supabase test user access token>'
$env:BASE_URL = 'https://iscraper.vercel.app'
$env:LOAD_PROFILE = 'deployed-auth-readonly'
npm.cmd run load:auth
```

Default behavior is read-only and covers:

- `GET /api/profile`
- `GET /api/items?limit=24`
- `GET /api/indexing/summary`
- `POST /api/search` with `includeAi: false`

The script refuses to start without `AUTH_TOKEN`. This prevents accidentally treating anonymous `401` responses as authenticated evidence.

Optional mutation evidence:

```powershell
$env:AUTH_MUTATION_ENABLED = 'true'
npm.cmd run load:auth
```

Mutation mode adds `POST /api/saves/link` with `review: true`, so saved items stay review-gated. Use only with a dedicated disposable test account.

### Region Probe

Quick header probe:

```powershell
npm.cmd run region:probe
```

Load-shaped region probe:

```powershell
$env:REGION_TARGETS = 'https://iscraper.vercel.app'
npm.cmd run load:region
```

The probe records aggregate timing and Vercel routing headers. It does not call authenticated routes or read database state.

## Baseline Evidence

Current production remains:

- Production alias: `https://iscraper.vercel.app`
- API function region: `iad1`
- Observed request edge from this machine: `bom1`
- Observed `X-Vercel-Id` shape: `bom1::iad1::<request-id>`

This means traffic from this machine reaches a nearby Vercel edge, then invokes the serverless function in `iad1`.

### Probe Results

`npm.cmd run region:probe` on May 27, 2026:

| Target | Path | Samples | Status | Min | Avg | Max | Edge | Function region | Request ID |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| `https://iscraper.vercel.app` | `/api/health` | 3 | `200` | 517 ms | 753 ms | 1204 ms | `bom1` | `iad1` | present |

`npm.cmd run load:region` on May 27, 2026:

| Target | Requests | Failed HTTP | Failed checks | p95 | p99 | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `https://iscraper.vercel.app/api/health` | 20 | 0.00% | 0.00% | 269.27 ms | 269.6 ms | Passed |

`SUPABASE_ACCESS_TOKEN` was mapped to `AUTH_TOKEN` and used for an authenticated read-only deployed run on May 27, 2026. The token was not printed. The API rejected it as an application user session:

| Target | Requests | HTTP 5xx | Status result | k6 p95 | k6 p99 | Result |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| `https://iscraper.vercel.app` | 99 | 0 | `401` auth failures | 2.4 s | 2.66 s | Failed closed |

Sanitized Vercel logs for the run window showed:

| Completed requests | Status | Cold starts | Server p95 | Server p99 | Max server duration | Auth p95 | Auth p99 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | `401` | 0 | 667 ms | 814 ms | 814 ms | 666 ms | 813 ms |

Route breakdown:

| Route | Count | Route group | Result |
| --- | ---: | --- | --- |
| `GET /api/profile` | 10 | `authenticated` | `401` |
| `GET /api/items` | 20 | `authenticated` | `401` |
| `GET /api/indexing/summary` | 10 | `import` | `401` |
| `POST /api/search` | 10 | `search` | `401` |

Conclusion: the saved environment value is not enough for signed-in route latency evidence. It is likely a Supabase management/project access token or otherwise not a current Supabase Auth user session JWT for this app. The authenticated harness is working correctly because it fails closed instead of treating anonymous responses as success.

A browser-exported Supabase Auth user session token was then used for a deployed read-only run on May 27, 2026. The token was not printed. All checks passed, but the run exceeded the readiness latency threshold:

| Target | Requests | Failed HTTP | Failed checks | k6 p95 | k6 p99 | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `https://iscraper.vercel.app` | 89 | 0.00% | 0.00% | 6.97 s | 7.36 s | Failed latency threshold |

k6 route-group breakdown:

| Route group | p95 | p99 | Notes |
| --- | ---: | ---: | --- |
| `authenticated` | 3.53 s | 3.79 s | Profile and library browse reads |
| `search` | 7.37 s | 7.42 s | `POST /api/search` with `includeAi: false` |
| `import` | 0 s | 0 s | No import mutation path in read-only mode |

Sanitized Vercel logs for the valid-token run window showed:

| Completed requests | Status | Cold starts | Server p95 | Server p99 | Max server duration | Auth p95 | Store/user p95 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 48 | `200` | 0 | 6555 ms | 6947 ms | 6947 ms | 619 ms | 1568 ms |

Server route breakdown:

| Route | Count | Route group | Server p95 | Auth p95 | Store/user p95 |
| --- | ---: | --- | ---: | ---: | ---: |
| `GET /api/profile` | 11 | `authenticated` | 2136 ms | 288 ms | 1624 ms |
| `GET /api/items` | 20 | `authenticated` | 3348 ms | 660 ms | 1367 ms |
| `GET /api/indexing/summary` | 9 | `import` | 3417 ms | 619 ms | 1493 ms |
| `POST /api/search` | 8 | `search` | 6947 ms | 259 ms | 1568 ms |

Conclusion: Phase 6H now has real signed-in evidence. The current bottleneck is not cold start: all parsed requests were warm. Search is the slowest route group, and store/user setup is also significant across authenticated reads. The next tuning phase should inspect Supabase query shape and search workflow behavior before moving regions or hosting.

## Acceptance Criteria

- Authenticated read-only profile can run only with an explicit token.
- Region probe returns `200` from `/api/health`.
- Region probe confirms `X-Request-ID` and `X-Vercel-Id` are present.
- No user content, captions, URLs, emails, tokens, provider keys, or request bodies are printed.
- If authenticated p95 exceeds `1.5s`, inspect Vercel logs for server-side `durationMs`, `authMs`, and `storeEnsureUserMs` before considering platform changes.
- If the provided token returns `401`, do not use that run for signed-in latency decisions; first create or export a dedicated disposable test-user Supabase Auth access token.

## Next Decision

Use Phase 6H results to decide Phase 6I:

- If authenticated server-side durations are low but k6 p95 is high, test a temporary candidate deployment in a closer function region before changing production.
- If `authMs` or `storeEnsureUserMs` is high, optimize Supabase auth/profile/store access first.
- If import mutation p95 is high but read-only routes are healthy, tune upload/import queuing before region or hosting changes.
- If authenticated and mutation paths are healthy, keep Vercel and continue scaling workers and data-layer evidence.

Current next action: Phase 6I should tune authenticated Supabase/store access and the no-AI search path. Do not move hosting or add infrastructure based on Phase 6H alone.
