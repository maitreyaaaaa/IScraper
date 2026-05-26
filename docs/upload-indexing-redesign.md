# Upload and Indexing Redesign

## Understanding

- IScraper imports Instagram and Pinterest export files into a private Supabase-backed library.
- Large file bytes should not pass through Vercel Functions unless this is local development or a fallback.
- The browser should upload export files directly to Supabase Storage.
- The backend should create safe upload paths, verify ownership, parse uploaded files, and create database records.
- Indexing should be triggered once per batch, not once per save.
- The deterministic `processing_jobs` worker is the current path for durable indexing outside normal user requests.

## Assumptions

- Keep the current React/Vite frontend.
- Keep the current Express API on Vercel for normal API and verification work.
- Keep Supabase Auth, Storage, Postgres, RLS, and pgvector.
- Keep the current 20 MB UI file limit for now.
- Do not add a new external queue service in this pass.

## Decision Log

- Direct browser-to-Supabase upload was chosen over Vercel chunk proxying because it avoids Vercel request body limits and reduces duplicated file transfer.
- The backend still creates upload paths because it can enforce user ownership and file rules before Storage writes happen.
- A single batch indexing endpoint was chosen over frontend loops because it avoids spawning many overlapping Vercel workers.
- The deterministic `processing_jobs` worker is the current production drain path. The protected Vercel worker endpoint remains a fallback/admin diagnostic path. Trigger.dev/Inngest can be revisited later if operational evidence requires it.

## Final Design

1. Frontend requests upload targets from `/api/imports/upload-urls`.
2. Backend returns private Supabase Storage paths under the authenticated user's folder.
3. Frontend uploads each file directly to Supabase Storage using the logged-in Supabase session.
4. Frontend calls `/api/imports/storage` with only file metadata and Storage paths.
5. Backend downloads from Storage, parses the export, creates `needs_review` saved items, then deletes temporary upload files.
6. User clicks Start indexing.
7. Frontend calls `/api/indexing/start` once.
8. Backend approves waiting saves and creates `processing_jobs`.
9. A worker process or protected worker endpoint runs the shared worker runtime for bounded batches.
10. Worker processing leases queued or expired active jobs before running them, so overlapping workers skip jobs already leased.
11. `INLINE_INDEXING_ENABLED=false` is the production default. Inline processing is only a local/fallback escape hatch.

## Current Worker Reliability Contract

The current production path is a long-running worker process plus a protected worker endpoint fallback:

- `npm run worker --prefix apps/orchestration` starts the worker runner at `src/worker/indexing-runner.js`.
- `WORKER_RUN_ONCE=true` drains one bounded pass and exits, which is useful for cron or smoke checks.
- Loop mode scans due scopes, respects `WORKER_GLOBAL_CONCURRENCY`, `WORKER_PER_USER_CONCURRENCY`, `WORKER_BATCH_SIZE`, and `WORKER_SCAN_LIMIT`, then sleeps with `WORKER_IDLE_MS`.
- Every claimed job gets a lease owner and lease token. Final job writes are ignored if another worker reclaimed the lease.
- Failed jobs retry with capped backoff through `next_attempt_at` until `WORKER_MAX_ATTEMPTS` is reached.
- Billing/provider pauses stay paused until the user fixes the required account state.

The deterministic `processing_jobs` worker is the current path; Trigger.dev/Inngest can be revisited later if operational evidence requires it. If adopted later, it should call the same scoped worker runtime rather than introduce a separate job state store.
