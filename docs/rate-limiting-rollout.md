# Rate limit hardening rollout

## Deploy order

1. Revoke the exposed Gemini key and create a replacement. Update the local orchestration secret and every deployed secret store that uses it. Do not paste key values into tickets, logs, or this repository. Confirm the integration using a non-sensitive health check.
2. The four automation and rate-budget migrations (`20260926173444`, `20260926173445`, `20260926173447`, and `20260926173449`) are applied to the confirmed staging project. The corrective migration `20260926173500_revoke_claim_processing_jobs_client_access.sql` was run manually and verified: all three overloads deny `anon` and `authenticated`, and allow `service_role`. Its migration-history entry has now been repaired and confirmed. `supabase migration list` also shows unrelated older local-only and remote-only migrations; do not run `supabase db push` until that existing drift is reviewed. Before deploying code, verify the rate-budget RPC is service-role-only, requests for one user do not affect another, fixed UTC windows reset, concurrent requests never exceed a cap, and parallel worker claims respect the configured per-user concurrency. Repeat all migrations in order for production rollout.
3. In Vercel staging, add a Firewall rate limit for requests under `/api/`, keyed by IP, with the default 429 action. Vercel allows fixed windows up to 10 minutes on Hobby and Pro, and up to 1 hour on Enterprise. If this project supports a 15-minute window, set 600 requests per 15 minutes to match the in-process baseline; otherwise use 400 requests per 10 minutes for the same sustained rate, with a tighter burst allowance. Counters are per region, so traffic spread across regions can exceed one region's configured count. Check plan entitlement and rate-limit pricing, then review 429 behavior before enabling the same rule in production.
4. Verify Supabase Auth limits at **Authentication → Rate Limits** for signup/sign-in, verification, OTP/email/SMS, and token refresh. Confirm project-specific settings and forwarded-IP behavior before treating Auth protection as verified.
5. Deploy code after the staging migration and edge rule are verified. Monitor application 429/503 counts, rate-budget RPC errors, and scheduled runs deferred with `rate_limited` status.

## Coverage observed in this checkout

- The orchestration API installs a general 600-request / 15-minute in-process IP limiter before route registration. Route-specific limits add stricter thresholds to search, imports, feedback, worker, checkout, and admin paths. The in-process counter is per runtime process and does not coordinate Vercel instances.
- The UI uses Supabase Auth and directly uploads import files to Supabase Storage with the public anon key and the signed-in user's session. No direct UI PostgREST table reads or writes were found. Auth and Storage calls do not pass through the orchestration API limiter; storage ownership is enforced by RLS policies and project-level Supabase controls.
- Supabase Auth has platform-managed, configurable rate limits. The staging project's values could not be verified; check them in the dashboard or Management API.
- The optional local ML service binds to `127.0.0.1` by default and has no request rate limiter. If configured on a non-loopback host, set `LOCAL_ML_API_KEY` and restrict network access; neither its runtime exposure nor remote endpoint is verifiable from repository contents alone.
- The staging Supabase schema check found a historical `claim_processing_jobs` overload with `EXECUTE` granted to `anon` and `authenticated`. The corrective migration revokes browser-role access from every overload while preserving the existing `service_role` grants. The user manually applied it and provided a verification screenshot showing all three overloads now have safe grants. The migration-history entry is repaired; unrelated historical migration drift still needs review before `supabase db push`.
- Vercel's WAF rate-limit settings live in project Firewall configuration. The checked-in `vercel.json` does not define a rate limit. Current Vercel documentation sets fixed-window maxima by plan (10 minutes on Hobby/Pro; 1 hour on Enterprise) and tracks counters per region.

## Code-enforced per-user budgets

The Supabase RPC is the shared production counter. Local storage uses an in-memory implementation for development and tests.

| Scope | Per minute | Per UTC day |
| --- | ---: | ---: |
| AI Search / library chat | 60 | 1,000 |
| Semantic query embeddings | 60 | 1,000 |
| Automation draft and revise combined | 5 | 20 |
| Manual and scheduled automation runs combined | 5 | 20 |
| Workflow plan generation | 5 | 20 |
| Screenshot and image search analysis | 5 | 20 |

Allowed attempts are counted before provider calls, including later provider failures. Requests denied by a cap return 429 with retry timing. Missing or failing shared storage returns 503. Scheduled automation caps are visible in run history and defer the next run until the relevant UTC window resets.
