# Privacy Export Design

## Goal
Let a signed-in user download their own IScraper data from Account settings without adding tables, migrations, or admin-only behavior.

## Architecture
Reuse existing authenticated endpoints:

- `GET /api/items` for saved posts and enrichment fields.
- `GET /api/imports` for upload/import history.

The frontend builds downloadable JSON and CSV files in the browser. This avoids a new backend route and keeps export behavior user-scoped through existing auth.

## Data Scope
The export includes saved item metadata, captions, tags, enrichment fields, status, timestamps, and import history. It does not include API key secrets, revealed provider keys, admin fields, auth tokens, or Supabase session data.

## UI
Add a **Privacy Export** tab to Account settings with two actions:

- **Download JSON** for a complete structured export.
- **Download CSV** for spreadsheet-friendly saved item rows.

Copy stays plain: it tells the user what is included and what is excluded.

## Error Handling
If either endpoint fails, show the existing Account settings error banner. Disable export buttons while a file is being prepared.

## Testing
Run:

- `npm run lint --prefix apps/ui`
- `npm run build --prefix apps/ui`

Backend tests are not required because no backend behavior changes.
