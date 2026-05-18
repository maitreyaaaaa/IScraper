# Upload and Indexing Redesign

## Understanding

- IScraper imports Instagram and Pinterest export files into a private Supabase-backed library.
- Large file bytes should not pass through Vercel Functions unless this is local development or a fallback.
- The browser should upload export files directly to Supabase Storage.
- The backend should create safe upload paths, verify ownership, parse uploaded files, and create database records.
- Indexing should be triggered once per batch, not once per save.
- Trigger.dev should process durable indexing jobs outside normal user requests.

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
- Trigger.dev is the primary production drain path. The protected Vercel worker endpoint remains only a fallback/admin diagnostic path.

## Final Design

1. Frontend requests upload targets from `/api/imports/upload-urls`.
2. Backend returns private Supabase Storage paths under the authenticated user's folder.
3. Frontend uploads each file directly to Supabase Storage using the logged-in Supabase session.
4. Frontend calls `/api/imports/storage` with only file metadata and Storage paths.
5. Backend downloads from Storage, parses the export, creates `needs_review` saved items, then deletes temporary upload files.
6. User clicks Start indexing.
7. Frontend calls `/api/indexing/start` once.
8. Backend approves waiting saves and creates `processing_jobs`.
9. Backend triggers the `indexing-scan` Trigger.dev task when durable indexing is configured.
10. Trigger.dev runs `indexing-scan` on a schedule and calls `indexing-process-scope` for bounded batches.
11. Worker processing leases queued or expired active jobs before running them, so overlapping workers skip jobs already leased.
12. `INLINE_INDEXING_ENABLED=false` is the production default. Inline processing is only a local/fallback escape hatch.

## Next Structural Step

Keep tuning Trigger.dev concurrency, per-user limits, and batch sizes while measuring actual provider cost and failure rates. Vercel remains the web API; long AI work should not depend on the user request lifecycle.
