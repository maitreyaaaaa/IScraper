# Scalability Readiness

IScraper stays on Vercel for UI/API traffic in this phase. The architecture goal is to keep Vercel safe now while making a later API move straightforward.

## Runtime Boundaries

| Boundary | Current implementation | Scale rule | Future replacement path |
| --- | --- | --- | --- |
| HTTP/API runtime | Vercel function through `api/index.js` and `createApp` | Stateless, bounded request handling only | Container or persistent web service running the same app entrypoint |
| Worker runtime | Render worker and protected worker endpoints | Drain `processing_jobs`; never rely on request traffic for queue progress | More worker instances or a worker platform if evidence requires it |
| Storage/database adapter | Local JSON for dev, Supabase for production | Store methods remain the internal contract | Same interface backed by tuned Supabase/Postgres settings |
| Rate-limit adapter | In-memory limiter | Temporary process-local control, not a multi-instance correctness layer | Redis/Upstash/gateway/WAF-backed shared limiter |
| Observability adapter | PostHog/structured logs | Aggregate-only logs for queue, upload, auth, and provider events | APM/log drain without route changes |
| AI/provider adapter | App and encrypted user provider credentials | Expensive paths have separate rate budgets and backoff | Provider router or quota service behind same workflows |

## Workload Model

The target planning model is mixed usage, not a single concurrent-user number:

| Workload | Example active usage | Expected behavior |
| --- | --- | --- |
| Library browsing | Hundreds scrolling and filtering saved items | Fast reads, cursor/limit bounded responses, no worker side effects |
| Upload/import | Hundreds uploading saved-post exports in bursts | Size/type/path validation, storage-backed uploads, queued indexing |
| Indexing/enrichment | Hundreds triggering jobs indirectly | API queues work; workers enforce global and per-user concurrency |
| Search/chat/AI | Hundreds searching, fewer asking AI questions | Search has a stricter budget than reads; AI degrades before core library reads |
| Admin/webhooks/extensions | Low volume, high trust sensitivity | Auth fails closed, logs are aggregate/sanitized, rate limits stay strict |

## Vercel-Safe SLOs

Initial targets for readiness testing:

- Core reads: p95 under 800 ms, p99 under 1500 ms.
- Imports/upload handoff: p95 under 2000 ms for accepted small uploads.
- Search without AI: p95 under 1200 ms.
- AI/search answer: p95 under 8000 ms or a controlled degraded response.
- Queue health: oldest queued job age trends down during worker pilot windows.
- Worker pass: bounded pass finishes within the configured lease window.
- Overload: expensive routes return `429` with `Retry-After` before core reads fail.

These are readiness targets, not guaranteed public SLAs.

## Backpressure Rules

- API routes must not start long-running indexing work inline unless explicitly forced for local/dev diagnostics.
- Upload/import endpoints must enforce file count, file size, extension, MIME type, chunk index, chunk count, and user-owned storage paths.
- Search, AI, worker, checkout, admin, and import paths keep separate rate budgets.
- `429` responses should be deliberate overload signals and include `Retry-After`.
- Degrade AI/search before degrading save, import handoff, or library reads.

## Evidence Commands

- Route inventory: `npm.cmd run routes:inventory`
- Browser secret boundary: `npm.cmd run security:boundaries`
- Supabase migration security gate: `npm.cmd run security:supabase`
- Read-only Supabase query audit: `npm.cmd run db:audit:supabase`
- k6 mixed-load harness: `npm.cmd run load:smoke`
- Supabase-authenticated k6 harness: `npm.cmd run load:auth:supabase`
- Backend tests: `npm.cmd --workspace @iscraper/orchestration test`
- Build: `npm.cmd run build`
- Lint: `npm.cmd run lint`

Run `load:smoke` only where k6 is installed. Use `BASE_URL`, `AUTH_TOKEN`, `ADMIN_API_KEY`, and rate environment variables to point it at local, preview, or staging environments.

## Migration Triggers

Do not move the API off Vercel until evidence shows one or more of these:

- Vercel API p95/p99 latency fails under representative load.
- Upload/import requests hit platform size or duration limits.
- Queue age grows despite worker scaling.
- Supabase connection or pool pressure requires persistent API pooling.
- Operational cost or reliability favors a persistent API runtime.

Until then, keep Vercel as the public UI/API entry and keep improving bounded request behavior.
