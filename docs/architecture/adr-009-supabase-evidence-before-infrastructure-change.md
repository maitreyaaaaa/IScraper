# ADR-009: Supabase Evidence Before Infrastructure Change

## Status
Accepted

## Context
Phase 6I improved authenticated and no-AI search paths without changing public API behavior, but deployed p95 still missed the readiness target. The remaining server-side cost is dominated by Supabase reads/writes: account deletion safety checks, saved-item page fetch/map, no-AI search candidate fetch, and search-event insert.

Moving API hosting, regions, or rate limiting would not directly prove those database costs are fixed.

## Decision
Keep Vercel as the active UI/API host and collect Supabase-specific security and query evidence first.

- Add local Supabase migration security gates for RLS, storage ownership, and `security definer` boundaries.
- Add read-only Supabase DB audit tooling for aggregate policy/index/table stats and sanitized query-plan summaries.
- Author a draft performance-index migration for review, but do not apply it to production in this phase.
- Reduce safe backend round trips where behavior is unchanged, starting with search-event insert avoiding a follow-up select.

## Consequences
- Public routes, responses, auth behavior, worker contract, storage mode, frontend, and deployment host remain unchanged.
- Production database changes require a separate explicit approval step.
- The next decision is evidence-based: apply reviewed indexes, reduce Supabase round trips further, or continue profiling.
- Redis, region movement, and API hosting migration stay deferred until Supabase evidence stops being the primary bottleneck.

## Evidence
Phase 6J read-only audit against project `bkmxhavrbziakiqmdsqo` reported RLS enabled on all 33 public tables and produced aggregate-only query plan summaries.

The audited saved-item page and no-AI candidate-search plans currently use `saved_items_user_updated_idx`, not a dedicated `created_at/id` ordering index or trigram search index. This supports keeping the draft performance migration as the next database review item, without applying it automatically in this phase.
