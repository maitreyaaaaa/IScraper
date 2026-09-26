# Icebreaker Automations V1 setup

The current backend slice supports user-owned Gmail-reading automations, manual runs, interval schedules, a tool-capable model list, and run history. The route set is under `/api/automations`; it does not replace the existing marketing content workflow.

## Required setup before using Gmail

### Local walkthrough without provider keys

Set `STORAGE_MODE=local`, `AUTOMATION_MOCK_MODE=true`, and `NODE_ENV=development` for the API (and worker if you want to exercise schedule claiming). This uses sample mail and deterministic drafts; it does not call OpenRouter or Composio. The server refuses to enable this mode with Supabase storage or in production. The UI displays a local mock-data banner while it is active.

1. Apply the automation migrations in order: `20260926173444_chat_automations.sql`, `20260926173445_automation_chats.sql`, `20260926173447_automation_api_only_rls.sql`, `20260926173449_shared_request_rate_budgets.sql`, and `20260926173500_revoke_claim_processing_jobs_client_access.sql`. The API-only migration removes older direct client policies from projects that already applied them. All five SQL changes are now present in staging; the final corrective SQL was run manually and verified against all three RPC overloads. Its migration-history entry is repaired, but unrelated historical drift remains; review that before using `supabase db push`. Apply all five in order in production. Do not expose the service role key to the browser.
2. Set `OPENROUTER_API_KEY` on the deployed API and Render worker services.
3. Set `COMPOSIO_API_KEY`, `COMPOSIO_GMAIL_AUTH_CONFIG_ID`, and `AUTOMATION_CONNECT_STATE_SECRET` on the deployed API; set `COMPOSIO_API_KEY` and `COMPOSIO_GMAIL_AUTH_CONFIG_ID` on the Render worker too.
4. Configure the Composio Gmail auth config with the minimum read-only Gmail scope. Do not use a broad Gmail scope for this V1 action.
5. In Composio, set the project's OAuth callback identity-verifier URL to the deployed API path `/api/automations/gmail/callback`. The callback needs public HTTPS. Then set `COMPOSIO_CALLBACK_VERIFIER_CONFIGURED=true` on the API. Leave it `false` until that is confirmed.
6. Configure the app's `APP_URL`, CORS, and worker environment as for the existing IScraper services.

The Vercel/API environment and Render worker environment are separate deployment targets. Staging database changes are applied through the corrective RPC-grant migration; production migrations, provider credentials, and Composio callback verification remain separate rollout steps. Review the reported migration-history drift before any staged CLI push. Automation table access goes through the authenticated API; RLS denies direct browser reads and writes.

Connection status is checked by user-scoped Composio account lookup; the app does not persist Composio connection IDs in automation definitions. OAuth tokens never enter the browser, workflow definition, or model context. Raw Gmail messages are passed through the selected model provider for the requested summary and are not stored in our run record. Review provider retention settings and Google's restricted-scope release requirements before production use.

## Current API flow

- `POST /api/automations/draft` turns a chat description into a reviewable Gmail-only draft.
- `POST /api/automations` saves a manual or scheduled automation.
- `GET /api/automations` lists definitions with bounded `page`/`limit`, status and trigger filters, and `hasMore` for pagination.
- `POST /api/automations/gmail/connect` creates an OAuth link for the signed-in user.
- `GET /api/automations/gmail/connections` lists that user's Gmail connection states.
- `POST /api/automations/:id/run` executes one bounded read-only run.
- `GET /api/automations/:id/runs` returns the automation's run history.
- The Render worker claims due interval schedules and executes them without a browser session.

The API requires the authenticated user ID from IScraper; callers cannot supply an owner ID. The OAuth callback also verifies a signed, short-lived HTTP-only browser state before redeeming Composio's single-use session URI.
