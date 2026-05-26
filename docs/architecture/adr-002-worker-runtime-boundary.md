# ADR-002: Worker Runtime Boundary Before Deployment Split

## Status
Accepted

## Context
IScraper now has route modules and application workflows, but indexing work still enters the system from several places: route-triggered indexing, protected worker endpoints, and `npm run worker`. The app is still best served by one Vercel UI/API deployment, while long-running indexing should remain ready for a separate worker service later.

## Decision
Keep the current monolith deployment and separate the worker runtime in code first. `/api/worker/process`, `/api/worker/process-one`, route-triggered indexing, and the CLI worker runner must use the same runtime contract over `processing_jobs`.

## Alternatives Considered

### Split deployments now
- **Pros**: clearer infrastructure boundary.
- **Cons**: adds CORS, env drift, deploy coordination, and operational complexity before there is evidence it is needed.
- **Why not**: current bottleneck is code/runtime boundary clarity, not separate hosting.

### Adopt Trigger.dev or Inngest now
- **Pros**: managed background execution and scheduling.
- **Cons**: introduces another durable execution model and integration surface.
- **Why not**: `processing_jobs` already provides the durable queue contract for this phase.

## Consequences
- The worker can be tested without starting Express.
- Worker endpoints and CLI behavior stay aligned.
- Future worker deployment can reuse the same runtime boundary.
- Production multi-worker reliability still depends on Supabase-backed `processing_jobs`; local JSON remains development-only for concurrent workers.
