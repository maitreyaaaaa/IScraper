# ADR-006: Tune Vercel Runtime Before Hosting Migration

## Status
Accepted

## Context
Phase 6F showed that IScraper's conservative deployed smoke can miss the `1.5s` p95 readiness target after an idle period, while Express request timing stays low. The slow sample had k6 p95 around `1.96s`, but Vercel serverless logs showed route handler durations under `47ms`, auth timing around `1ms`, and cold-start markers during the slow window.

This means the current bottleneck is before or around serverless invocation rather than inside route workflows, auth, store setup, or Supabase calls for these smoke paths.

## Decision
Keep Vercel as the active UI/API platform and tune the runtime before considering a hosting migration:

- Enable Vercel Fluid Compute for the deployment.
- Keep the API function explicitly in `iad1` for now.
- Add a tiny public `/api/health` endpoint that returns aggregate runtime status only.
- Prepare `/api/health` as the warmup target. A Vercel Cron warmup that calls `/api/health` every five minutes is the desired production setting, but it is not active while the project is on a Hobby account because Vercel rejects schedules more frequent than daily on Hobby.
- Extend load testing to include health probes and deployed warmup evidence.

Fluid Compute is configured with top-level `"fluid": true`. The `memory` override is removed from `vercel.json` because Vercel does not allow `memory` to be set in `vercel.json` when Fluid Compute is enabled.

## Consequences
- IScraper remains deployable as one Vercel UI/API app.
- No user-facing API behavior changes.
- The health endpoint exposes no user data, database data, provider data, URLs, captions, emails, tokens, or secrets.
- Runtime evidence can now separate app handler time from platform/network/cold-start time.
- Five-minute cron warmup remains blocked by Vercel plan limits; re-adding it to `vercel.json` before upgrading will break production deployment.
- Region moves, distributed rate limiting, and API hosting migration remain deferred until evidence justifies them.

## Deferred
- No move away from Vercel.
- No multi-region/failover setup.
- No Redis/Upstash.
- No database migration.
- No frontend refactor.
- No worker architecture change.
