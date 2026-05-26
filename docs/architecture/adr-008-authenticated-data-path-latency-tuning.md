# ADR-008: Tune Authenticated Data Paths Before Infrastructure Migration

## Status
Accepted

## Context
Phase 6H produced real signed-in deployed evidence. Requests were warm and returned `200`, but p95 latency missed the readiness target:

- authenticated reads: k6 p95 `3.53s`
- no-AI search: k6 p95 `7.37s`
- parsed server logs: no cold starts, server p95 `6555ms`
- store/user setup p95 was around `1568ms`

The bottleneck is inside authenticated request work, not Vercel cold start.

## Decision
Keep Vercel, Supabase, the public API, and deployment topology unchanged.

Tune the current backend paths first:

- Cache successful Supabase Auth user lookups briefly per serverless instance.
- Cache successful user-row setup briefly per serverless instance.
- Continue running deletion/account safety checks on every authenticated request.
- Add sanitized timing fields for account safety, user setup, profile fetch, item-page query, item mapping, facet query, search item fetch, keyword scoring, semantic lookup, semantic embedding, and search-event insert.
- Use a lean keyword-search path for no-AI search so it does not fetch asset-heavy item payloads or try semantic embedding unless semantic search is explicitly requested.

## Consequences
- Public routes and response contracts remain unchanged.
- No Redis, region move, hosting migration, worker change, or database migration is introduced.
- Revoked/deleted-account safety remains fail-closed through per-request deletion checks.
- The short-lived auth cache reduces repeated Supabase Auth calls but is not treated as an authorization source of truth beyond its TTL.
- If latency remains above target, the next step is Supabase query-plan/index evidence, not platform migration.

## Deferred
- Distributed rate limiting.
- Shared distributed auth/session cache.
- Supabase index migrations.
- Production region move.
- API host migration.
