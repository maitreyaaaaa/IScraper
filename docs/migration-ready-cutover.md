# Migration-Ready API Cutover Plan

This is a future plan only. Do not move IScraper off Vercel until the migration triggers in `docs/scalability-readiness.md` are backed by load-test or production evidence.

## Target Shape

- UI stays on Vercel or another CDN/static host.
- API runs as the same Express app through `createApp({ store, config, observability })` on a horizontally scaled web service.
- Workers run separately and drain `processing_jobs`.
- Supabase remains the production source of truth.
- Rate limiting uses a shared adapter before more than one API instance serves production traffic.
- Observability keeps request IDs and route-group metrics across API and worker runtimes.

## Pre-Cutover Requirements

- Public API paths and response shapes are unchanged.
- Worker pilot is healthy and queue age trends down.
- `npm.cmd run routes:inventory` has no missing auth/rate-limit findings for changed routes.
- `npm.cmd run security:boundaries` passes.
- Load tests pass against Vercel baseline and candidate API host.
- Shared rate limiter is configured for API instances.
- Supabase connection mode is documented for the candidate host.
- Rollback DNS/proxy route is documented before production traffic shifts.

## Cutover Strategy

1. Deploy the API host with production-equivalent env vars, no public traffic.
2. Run backend tests and worker smoke checks against the candidate host.
3. Run mixed load smoke tests against the candidate host.
4. Route a narrow internal/admin test path through the new host if supported.
5. Shift API traffic gradually at the rewrite/proxy/DNS layer.
6. Watch p95/p99 latency, 5xx, 429, queue age, and Supabase pool pressure.
7. Roll back by returning `/api/*` traffic to Vercel if error rates or latency regress.

## Explicit Non-Goals

- No database rewrite.
- No user-facing URL changes.
- No frontend rebuild solely for the cutover.
- No new queue provider unless `processing_jobs` becomes the measured bottleneck.
- No autonomous deployment without human approval and rollback confirmation.
