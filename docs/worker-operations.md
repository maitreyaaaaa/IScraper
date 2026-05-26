# Worker Operations

IScraper still runs as one Vercel UI/API deployment. Phase 5 pilots a separate Render Background Worker for queue draining, but Vercel remains the only web/API app.

## Commands

- Local loop: `npm.cmd run worker:loop`
- Local one-pass smoke run: `npm.cmd run worker:once`
- Orchestration workspace one-pass run: `npm.cmd --workspace @iscraper/orchestration run worker:once`
- Existing loop command remains valid: `npm.cmd --workspace @iscraper/orchestration run worker`

`worker:once` sets `WORKER_RUN_ONCE=true` before running `apps/orchestration/src/worker/indexing-runner.js`. Loop mode uses the same runner without that flag.

## Required Production Env

Production worker mode should run with:

- `STORAGE_MODE=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`
- `OPENROUTER_API_KEY` or user text-provider credentials encrypted with `CREDENTIAL_ENCRYPTION_KEY`

The worker preflight reports missing variable names only. It must not print secret values.

## Render Worker Pilot

The root `render.yaml` defines one `iscraper-indexing-worker` background worker service:

- service type: `worker`
- branch: `main`
- build command: `npm install`
- start command: `npm run worker:loop`
- instances: `1`
- plan: `starter`

Secrets are listed with `sync: false`; set them in Render during service creation. Do not copy secrets into `render.yaml`.

## Recommended Worker Settings

- `WORKER_BATCH_SIZE=5`
- `WORKER_SCAN_LIMIT=20`
- `WORKER_GLOBAL_CONCURRENCY=1`
- `WORKER_PER_USER_CONCURRENCY=1`
- `WORKER_MAX_ATTEMPTS=3`
- `WORKER_LEASE_MS=900000`
- `INLINE_INDEXING_ENABLED=false`

Raise concurrency only after queue volume, database load, provider rate limits, and job duration are visible in logs.

## Shutdown Behavior

The worker listens for `SIGTERM` and `SIGINT`. When shutdown is requested, it finishes the current bounded pass, skips the next pass, exits the loop, and relies on job leases for any unfinished work. Idle sleep is interrupted so Render can stop the service promptly.

## Queue State Meanings

- `active`: a worker claimed the job and its lease is still current.
- `retrying`: the job failed, has attempts remaining, and is waiting for `nextAttemptAt`.
- `paused_missing_provider`: no usable text AI provider was available for that user or app path.
- `paused_needs_billing`: app-provided provider use is blocked until the user's billing/credits state changes.
- `exhausted`: the job has failed enough times to reach `WORKER_MAX_ATTEMPTS`.

Paused states are human-action states. They should not be automatically reclaimed until the required user or account condition changes.

## Pilot Acceptance

Watch the pilot for 24-48 hours:

- oldest queued job age trends down
- no repeated worker preflight or fatal errors
- no provider rate-limit storm
- no sensitive data appears in logs
- Vercel API latency is not affected by worker activity

Rollback is stopping or scaling the Render worker to zero. The protected Vercel worker endpoints remain available as fallback/admin tools.

## Future Split Criteria

A separate worker host becomes justified when there is evidence that request traffic and indexing should scale independently. Useful signals include sustained queue age, frequent Vercel timeout pressure, long job duration, provider throttling that needs worker-specific backoff, or the need for scheduled/always-on processing independent of web traffic.

Until then, keep one Vercel UI/API deployment and run the same shared worker runtime through CLI, cron, or the protected worker endpoint.
