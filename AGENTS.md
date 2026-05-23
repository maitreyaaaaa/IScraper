# Project Instructions

## Product Goal
IScraper is a private searchable brain for saved social posts. It imports Instagram and Pinterest exports, accepts manually saved links, enriches items with AI analysis, and lets users search, review, approve, and export their saved knowledge graph.

## Tech Stack
- Backend: Node.js CommonJS, Express 5, Node test runner.
- Frontend: React 19, Vite 8, Tailwind CSS 4, lucide-react, GSAP, d3-force.
- Storage: local JSON for development, Supabase/Postgres with pgvector and RLS for production.
- AI providers: OpenRouter by default, plus Gemini/OpenAI/Anthropic/DeepSeek/GLM through provider credentials.
- Payments/admin: Stripe checkout/webhooks and admin endpoints are present but gated by env config.

## Build & Run
- Backend install: `npm ci --prefix apps/orchestration`
- Backend dev: `npm run dev --prefix apps/orchestration`
- Backend tests: `npm test --prefix apps/orchestration`
- Frontend install: `npm ci --prefix apps/ui`
- Frontend dev: `npm run dev --prefix apps/ui`
- Frontend lint: `npm run lint --prefix apps/ui`
- Frontend build: `npm run build --prefix apps/ui`

## Project Structure
- `apps/orchestration/`: Express API, config, import parsers, queue worker, provider clients, stores, Supabase migrations, and backend tests.
- `apps/ui/`: Vite React frontend and API client.
- `api/index.js`: Vercel serverless entry that mounts the orchestration app.
- `extensions/save-to-iscraper/`: Manifest V3 browser extension for saving pages and Lens search.
- `docs/superpowers/`: planning and product/design specs.
- `data/`: ignored local runtime data when using local storage.

## Backend Conventions
- Keep route wiring in `apps/orchestration/src/server.js`; move reusable business logic into `src/services/`.
- Store implementations must preserve the same public method shape across `localStore.js` and `supabaseStore.js`.
- Use async route wrappers and JSON error responses with meaningful status codes.
- Validate upload types, URLs, profile fields, provider models, and admin credentials before mutating data.
- Keep API keys and provider credentials server-side. User credentials must remain encrypted/masked in responses.
- Preserve the workflow states already used by jobs and items: `needs_review`, `queued`, `downloading`, `analyzing`, `done`, `failed`, and paused variants.

## Frontend Conventions
- Keep API calls centralized in `apps/ui/src/api.js`.
- Keep Supabase client setup in `apps/ui/src/supabaseClient.js`; only expose `VITE_*` public env vars to the frontend.
- Use existing React component patterns, lucide icons, and Tailwind utility styling before adding new UI dependencies.
- Treat sensitive user exports, saved links, API keys, and extension tokens as private user data in UI copy and flows.

## Testing
- Backend tests live in `apps/orchestration/test/*.test.js` and use Node's built-in `node --test` runner.
- Add focused backend tests for parsers, queue behavior, credential handling, billing/credits, security gates, and API endpoints.
- There is no frontend test runner configured; use `npm run lint --prefix apps/ui` and `npm run build --prefix apps/ui` for frontend verification.

## Security Defaults
- Never hardcode secrets. Use `.env.example` as the source for required environment variables.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `STRIPE_SECRET_KEY`, and `CREDENTIAL_ENCRYPTION_KEY` out of frontend code.
- Do not weaken Supabase RLS migrations, admin checks, extension token scoping, rate limits, upload validation, CSP headers, or private storage behavior without explicit approval.
- Browser extension permissions should stay narrow: `activeTab`, `scripting`, and `storage`; avoid broad host permissions unless there is a reviewed need.

## Git
- Git metadata is not available in this folder, so branch, commit, and PR conventions could not be detected.
