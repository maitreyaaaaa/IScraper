# Indexing Issues Center Design

## Goal
Show users which saves failed, paused, or appear stuck during indexing, and give them a clear retry action. No migrations or new queue system.

## Architecture
Add one authenticated read endpoint:

- `GET /api/indexing/issues?limit=50`

The route delegates to store parity methods:

- `localStore.listIndexingIssues(userId, { limit })`
- `supabaseStore.listIndexingIssues(userId, { limit })`

Both methods read existing `processing_jobs` and `saved_items`, filter to restartable statuses, clamp the limit, and return a user-scoped public shape. Mutations reuse existing `POST /api/jobs/restart`.

## UI
Add an **Indexing Issues** tab in Account settings. It shows issue counts, failed/paused rows, item title/source/error, and a retry-all button. It should stay compact and operational.

## Security
Only return the authenticated user's jobs and item metadata. Do not expose emails, provider secrets, admin fields, or raw worker internals beyond status/error/attempt timestamps.

## Testing
Run:

- `npm test --prefix apps/orchestration`
- `npm run lint --prefix apps/ui`
- `npm run build --prefix apps/ui`
