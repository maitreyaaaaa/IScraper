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

Authenticated read-only load was not run in this pass because no dedicated test-user `AUTH_TOKEN` was available in the environment. The script was verified to fail closed without a token.

## Acceptance Criteria

- Authenticated read-only profile can run only with an explicit token.
- Region probe returns `200` from `/api/health`.
- Region probe confirms `X-Request-ID` and `X-Vercel-Id` are present.
- No user content, captions, URLs, emails, tokens, provider keys, or request bodies are printed.
- If authenticated p95 exceeds `1.5s`, inspect Vercel logs for server-side `durationMs`, `authMs`, and `storeEnsureUserMs` before considering platform changes.

## Next Decision

Use Phase 6H results to decide Phase 6I:

- If authenticated server-side durations are low but k6 p95 is high, test a temporary candidate deployment in a closer function region before changing production.
- If `authMs` or `storeEnsureUserMs` is high, optimize Supabase auth/profile/store access first.
- If import mutation p95 is high but read-only routes are healthy, tune upload/import queuing before region or hosting changes.
- If authenticated and mutation paths are healthy, keep Vercel and continue scaling workers and data-layer evidence.
