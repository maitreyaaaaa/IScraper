# ADR-004: Render Background Worker Pilot

## Status
Accepted

## Context
The worker runtime is now shared by API-triggered processing, protected worker endpoints, and the CLI runner. Phase 4 made the worker smoke-testable and production-preflighted, but indexing work still needs a real low-risk production process outside normal request traffic.

## Decision
Pilot one Render Background Worker running `npm run worker:loop` against Supabase-backed `processing_jobs`. Keep Vercel as the only UI/API deployment, keep the protected worker endpoints as fallback/admin tools, and do not add Trigger.dev, Inngest, Redis, or a new queue provider in this phase.

## Alternatives Considered

### Keep worker manual only
- **Pros**: least infrastructure change.
- **Cons**: queue draining still depends on humans or request-triggered fallback.
- **Why not**: Phase 5 needs production evidence from an always-on worker process.

### Full worker platform migration
- **Pros**: clearer hard split and future scaling surface.
- **Cons**: adds deploy coordination, incident surface, and scaling decisions before pilot evidence exists.
- **Why not**: one low-concurrency worker is enough to prove queue latency, cost, and reliability.

### Trigger.dev or Inngest now
- **Pros**: managed background execution model.
- **Cons**: introduces another job contract while `processing_jobs` already owns durable queue state.
- **Why not**: defer external job providers until operational evidence shows the current worker model is insufficient.

## Consequences
- Production indexing can drain outside Vercel request traffic.
- Rollback is simple: stop or scale the Render worker to zero.
- Vercel remains the public app/API boundary.
- Supabase-backed leases remain the concurrency guard.
- Operations must watch queue age, provider errors, worker fatal logs, and secret redaction during the pilot.
