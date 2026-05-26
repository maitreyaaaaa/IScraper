# ADR-007: Gather Authenticated And Region Evidence Before Hosting Migration

## Status
Accepted

## Context
Phase 6G improved deployed idle-window smoke latency while keeping IScraper on Vercel. The remaining evidence gap is that the deployed smoke is intentionally auth-fail-safe: it proves protected routes fail closed, but it does not measure real signed-in browsing, search, profile, indexing summary, or controlled mutation behavior.

Region placement also remains an open question. The current production API function stays in `iad1`, while requests from this machine reach Vercel through the `bom1` edge before `iad1`, as shown by `X-Vercel-Id`.

## Decision
Do not migrate hosting and do not change production region in this phase.

Add measurement tools only:

- A read-only authenticated k6 profile that requires an explicit `AUTH_TOKEN`.
- An optional mutation branch for manual-link save testing, disabled by default and gated behind `AUTH_MUTATION_ENABLED=true`.
- A public region probe that records aggregate response timing and Vercel routing headers without reading user data.
- Documentation that separates current evidence from future migration or region changes.

## Consequences
- Production behavior and public API contracts remain unchanged.
- Authenticated tests cannot accidentally run as anonymous smoke tests.
- Mutation testing cannot run unless explicitly enabled.
- Region evidence can be collected for the current production alias and any future candidate deployment URL.
- No secrets are committed, printed, or required in docs.

## Deferred
- No move away from Vercel.
- No production region move.
- No multi-region failover.
- No Redis/Upstash.
- No database migration.
- No frontend refactor.
- No worker architecture change.
