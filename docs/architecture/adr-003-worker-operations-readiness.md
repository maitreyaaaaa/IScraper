# ADR-003: Worker Operations Readiness Without Deployment Split

## Status
Accepted

## Context
The Phase 3 worker runtime made API-triggered processing, protected worker endpoints, and the CLI runner share the same `processing_jobs` contract. The next risk is operational: running the worker safely as a separate process later requires clear commands, preflight checks, smoke tests, and documentation.

## Decision
Prepare worker operations without deploying a separate worker service. Keep one Vercel UI/API deployment, keep Supabase-backed `processing_jobs` as the durable queue, and add only internal CLI/script, preflight, test, and documentation surfaces.

The deterministic `processing_jobs` worker is the current path; Trigger.dev/Inngest can be revisited later if operational evidence requires it.

## Rationale
A hosting split adds environment drift, deploy coordination, monitoring scope, and incident response surface before queue volume or latency proves that cost is needed. The app benefits more right now from a clean, smoke-testable worker process contract.

## Consequences
- `npm.cmd run worker:once` can run one bounded pass for local smoke checks or future cron-style execution.
- `npm.cmd run worker:loop` keeps the existing loop behavior explicit from the root workspace.
- Production worker startup fails closed when required Supabase/provider env is missing.
- Phase 5 can choose a worker host using operational evidence instead of architecture guesswork.
