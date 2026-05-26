# Route Inventory

Generate the current route table with:

```powershell
npm.cmd run routes:inventory
```

The generated table is source-derived from `apps/orchestration/src/routes/*.js`. Use it during review to confirm every route has:

- an access class: public, authenticated, token-authenticated, admin, or worker
- an auth helper or the global authenticated middleware
- a route-specific rate limiter or the general limiter
- explicit upload/body limits where applicable
- no sensitive response fields for admin/worker aggregate endpoints
- a sensitive-output-risk classification for review

The script exits non-zero if high-risk route groups lose expected auth or rate-limit coverage.

## High-Risk Route Groups

| Group | Required boundary |
| --- | --- |
| Admin routes | `assertAdmin`, `adminRateLimit`, aggregate or sanitized responses |
| Worker routes | `assertWorker` inside workflow handler, `workerRateLimit`, no user content in status |
| Import/upload routes | completed profile, import/upload limits, storage path ownership |
| Search/chat routes | authenticated or extension-token auth, `searchRateLimit`, AI budget handling |
| Integration routes | provider-specific signature/token validation before state changes |
| Account deletion | user auth, idempotency, admin approval for destructive completion |

Do not treat the script output as a permanent artifact. Regenerate it after route changes and include the output in PR review notes when auth/rate-limit behavior changes.
