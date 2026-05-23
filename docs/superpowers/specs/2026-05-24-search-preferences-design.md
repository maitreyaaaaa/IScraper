# Search Preferences Design

## Goal
Give users simple control over search behavior without adding persistent backend settings or migrations.

## Architecture
Store preferences in browser `localStorage` under `iscraper.searchPreferences`. The preferences are client-side because the current schema has no user settings table and the user explicitly asked for no new SQL.

Use existing search behavior:

- `includeAi` toggles the existing AI answer request.
- `semanticStrictness` maps to the existing `filters.semanticThreshold` value.
- `pageSize` controls how many cards the library shows per batch.

## UI
Add a **Search Preferences** tab in Account settings with three simple controls:

- AI answer on/off.
- Results per batch: 40, 80, or 120.
- Semantic matching: broad, balanced, or strict.

Copy stays short and functional.

## Data Flow
Dashboard owns the preferences state, passes it into the library and Account settings modal, and writes changes to `localStorage`. Search requests read the current state when submitted.

## Testing
Run:

- `npm run lint --prefix apps/ui`
- `npm run build --prefix apps/ui`

Backend tests are not required because there is no backend change.
