# Enrichment Controls Design

## Goal
Add a compact Account settings tab that tells users what enrichment is available, what is blocked, and which existing action fixes it. The feature must not add tables, columns, migrations, or new payment behavior.

## Architecture
Use existing client APIs:

- `GET /api/provider-credentials` for connected text, media, and embedding keys.
- `GET /api/credits` for included and paid indexing allowance.
- `GET /api/indexing/summary` for queue, failed, paused, and processing counts.
- `POST /api/indexing/start` to queue waiting saves.
- `POST /api/jobs/restart` to retry paused, failed, or stuck jobs.

No backend route is required for this phase because the current public shapes already expose enough state for a clear MVP.

## UI
Add an **Enrichment** tab to Account settings. It shows:

- Text understanding readiness.
- Visual understanding readiness.
- Smart search readiness.
- Credit/BYOK status.
- Current queue counts.
- Buttons to start indexing and retry paused or failed work.

Copy stays short and operational. The tab should explain state, not teach the whole product.

## Error Handling
If credits or indexing summary fail to load, keep the credentials UI usable and show the existing settings banner error. Mutating actions should disable while running, refresh state after completion, and show the returned result as a notice.

## Testing
Run:

- `npm run lint --prefix apps/ui`
- `npm run build --prefix apps/ui`

Backend tests are not required for this phase because the implementation does not introduce backend behavior.
