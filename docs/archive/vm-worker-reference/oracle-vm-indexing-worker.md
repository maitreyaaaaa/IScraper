# Oracle VM Indexing Worker

IScraper keeps Vercel as the UI/API host and uses a standalone Node worker on an Oracle Cloud VM to drain indexing jobs from Supabase/Postgres. The worker only receives IDs from the database. It does not put captions, post bodies, provider keys, or private metadata into an external queue.

## Production Shape

- Vercel: serves UI and lightweight API requests.
- Supabase/Postgres: source of truth for users, imports, saved items, processing jobs, leases, credentials, credits, and audit state.
- Oracle Always Free VM: runs `npm run worker --prefix apps/orchestration`.
- Worker default behavior: `globalConcurrency=3`, `perUserConcurrency=1`, `batchSize=5`, `leaseMs=15 minutes`, media download off.
- Large exports: browser uploads files directly to Supabase Storage, API stores storage paths, and the VM parses them before queueing indexing jobs.

## Required Environment

Set these in the VM shell or in the systemd environment file:

```bash
STORAGE_MODE=supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_IMPORT_BUCKET=instagram-assets
CREDENTIAL_ENCRYPTION_KEY=...
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=deepseek/deepseek-v4-pro
OPENROUTER_MEDIA_MODEL=google/gemini-3.1-flash-lite-preview
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
INLINE_INDEXING_ENABLED=false
WORKER_GLOBAL_CONCURRENCY=3
WORKER_PER_USER_CONCURRENCY=1
WORKER_BATCH_SIZE=5
WORKER_SCAN_LIMIT=20
WORKER_LEASE_MS=900000
WORKER_IDLE_MS=5000
STORAGE_IMPORT_BATCH_SIZE=1
```

Set these in the Vercel frontend/backend environment too:

```bash
INLINE_INDEXING_ENABLED=false
SUPABASE_IMPORT_BUCKET=instagram-assets
VITE_SUPABASE_IMPORT_BUCKET=instagram-assets
```

For canary rollout:

```bash
WORKER_RUN_ONCE=true
WORKER_CANARY_LIMIT=25
npm run worker --prefix apps/orchestration
```

For normal drain:

```bash
WORKER_RUN_ONCE=false
WORKER_CANARY_LIMIT=0
npm run worker --prefix apps/orchestration
```

## systemd Service

Create `/etc/systemd/system/iscraper-indexing-worker.service`:

```ini
[Unit]
Description=IScraper indexing worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/iscraper
EnvironmentFile=/etc/iscraper/worker.env
ExecStart=/usr/bin/npm run worker --prefix apps/orchestration
Restart=always
RestartSec=5
User=iscraper
Group=iscraper

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable iscraper-indexing-worker
sudo systemctl start iscraper-indexing-worker
sudo journalctl -u iscraper-indexing-worker -f
```

## Rollout Order

1. Apply `apps/orchestration/supabase/migrations/202605110001_processing_job_leases.sql`.
2. Confirm the `instagram-assets` storage bucket exists and keeps the existing authenticated own-folder policies.
3. Deploy the Vercel API/UI with `INLINE_INDEXING_ENABLED=false`.
4. Start the VM worker with `WORKER_RUN_ONCE=true` and `WORKER_CANARY_LIMIT=10` to `25`.
5. Upload one small export from the UI. The API should return "Queued for batch import"; the VM should log `storage_import.processed`.
6. Check `GET /api/indexing/summary`; queued should decrease and done/paused/failed should be explainable.
7. If provider errors and billing behavior look clean, run continuously with the default concurrency.

Do not turn on media downloads or deep image/video processing in this phase. Text indexing reliability comes first.
