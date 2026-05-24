# ADR-001: Durable Indexing Reliability Contract

## Status
Accepted

## Context
IScraper imports saved items into `processing_jobs`, then a worker enriches them with AI analysis and embeddings. The existing API returned `vm-worker` as queued, but the local worker script pointed to a missing file. Jobs also had leases without owner tokens, no finite retry policy, and no backoff.

## Decision
Keep `processing_jobs` as the durable queue and harden the current deterministic worker path:

- Add a real `npm run worker` runner that uses `workerRuntime`.
- Add lease tokens so stale workers cannot finalize reclaimed jobs.
- Add `next_attempt_at` plus max-attempt and backoff config.
- Keep paused billing/provider statuses as human-action states, not automatic retries.
- Keep local store and Supabase store behavior aligned.

## Rationale
This keeps the MVP architecture simple and observable. A new queue service is not required to fix the immediate reliability gaps. The worker can run as a VM/background process now, while the protected `/api/worker/process` endpoint remains a controlled fallback.

## Trade-offs
- Local JSON mode is still not safe for multiple independent worker processes. Production reliability depends on Supabase mode.
- Embedding failures remain non-fatal so text indexing can complete; this is a search-quality issue, not a queue-drain blocker.
- Trigger.dev can be revisited later if operational evidence shows the VM worker is not enough.

## Consequences
- Positive: jobs no longer retry forever, stale active leases can be reclaimed, and `npm run worker` is executable.
- Negative: migrations must be applied before Supabase deployments use the new RPC parameters.
- Mitigation: tests cover retry backoff, max attempts, lease tokens, and worker endpoint behavior.
