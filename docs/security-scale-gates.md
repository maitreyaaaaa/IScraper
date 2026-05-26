# Security Scale Gates

This checklist converts the local report `C:\Users\Admin\Downloads\Vibe code invulneablities.md` into concrete IScraper gates. The report's main warning is security assumption drift: generated code can look correct and pass shallow tests while weakening boundaries.

## Required Gates Before Scaling Traffic

| Gate | Requirement | Evidence |
| --- | --- | --- |
| Browser secret boundary | UI and extension code must not reference server-only secret names or key prefixes | `npm.cmd run security:boundaries` |
| Supabase service role boundary | Service role access stays in orchestration/worker server code only | Code review plus route inventory |
| Auth fail-closed | Admin, worker, extension, agent, and user routes reject missing/invalid credentials | Backend tests |
| Upload safety | File type, size, count, chunk index, chunk count, and storage path ownership are validated | Backend tests and route inventory |
| Route inventory | Every API route has an access class, auth helper, and rate limiter | `npm.cmd run routes:inventory` |
| Logs and telemetry | Logs omit captions, URLs, tokens, provider keys, raw request bodies, and file contents | Observability tests and review |
| CI/CD safety | No privileged workflow may run untrusted PR code | Required before adding GitHub Actions |

## CI/CD Rules For Future Workflows

- Do not add `pull_request_target` for build/test/deploy jobs without explicit security review.
- Pin third-party GitHub Actions to full commit SHAs when workflows are introduced.
- Set minimum `GITHUB_TOKEN` permissions.
- Do not expose production Vercel, Supabase, Stripe, provider, worker, or admin secrets to preview jobs from untrusted code.
- Require human review for auth, secrets, workflows, migrations, deployment config, and storage-policy changes.
- Add CodeQL, secret scanning, dependency review, and workflow linting as merge gates before CI becomes deployment-authoritative.

## Supabase Policy Readiness

This checkout does not currently include local Supabase migration/test files. Before traffic growth depends on direct Supabase client access or new tables/buckets, add policy evidence for:

- RLS enabled on exposed tables.
- Storage policies for import uploads and note assets.
- Anonymous users cannot read private rows or objects.
- Authenticated users can access only their own rows and objects.
- Admin/server-only operations are not implemented with browser credentials.
- `security definer` functions, if added, are isolated and reviewed.

## Operational Security Signals

Watch these during load tests and pilot traffic:

- spikes in 401/403 failures by route group
- repeated 429s on import/search routes
- upload rejection counts by reason
- worker preflight or provider credential failures
- queue status changes to retrying, paused, failed, or exhausted
- any sensitive data in Vercel, Render, Supabase, or PostHog logs

The system is not scale-ready if any secret appears in browser-facing code or logs.
