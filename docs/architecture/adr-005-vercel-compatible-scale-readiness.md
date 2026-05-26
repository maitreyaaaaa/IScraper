# ADR-005: Vercel-Compatible Scale Readiness

## Status
Accepted

## Context
IScraper needs to support thousands of simultaneous users, including mixed workloads: library browsing, upload/import bursts, indexing triggers, search/chat usage, admin operations, webhooks, and extension captures. The current public web/API deployment still runs on Vercel, while indexing can drain through the Render worker pilot and Supabase-backed `processing_jobs`.

Moving the API off Vercel is not part of this phase. The immediate need is to remove hidden Vercel lock-in from code boundaries so the app remains stable now and can later move to a persistent horizontally scaled API runtime without rewriting routes or business workflows.

The local security report at `C:\Users\Admin\Downloads\Vibe code invulneablities.md` also identifies a recurring risk for generated apps: security assumption drift across frontend/server boundaries, CI/CD, Supabase keys, previews, and privileged automation. Scale readiness must include security gates, not only load tests.

## Decision
Keep Vercel as the active UI/API platform and make the backend migration-ready:

- Keep `api/index.js`, `vercel.json`, and public API routes unchanged.
- Keep Express routes thin and preserve `createApp({ store, config, observability })` as the server entrypoint.
- Keep background work behind `processing_jobs` and the shared worker runtime.
- Treat API requests as stateless and bounded; expensive indexing drains through worker processes.
- Put rate limiting behind an internal adapter boundary. The current adapter remains in-memory, but a distributed adapter can replace it later without route rewrites.
- Add scale/security docs and repeatable checks for route inventory, browser secret boundaries, and load scenarios.

## Consequences
- The app remains deployable on Vercel today.
- A future API move should be mostly runtime/configuration work, not route extraction.
- In-memory rate limits are now explicitly a current-runtime adapter, not a correctness guarantee for multi-instance API scale.
- The system still needs production load evidence before any hosting migration decision.
- Security gates become part of scale readiness because high concurrency amplifies auth, upload, and secret-boundary mistakes.

## Deferred
- No API hosting migration.
- No new queue provider.
- No database migration.
- No frontend refactor.
- No Redis/Upstash dependency yet.
- No GitHub Actions rollout until workflow security rules are in place.
