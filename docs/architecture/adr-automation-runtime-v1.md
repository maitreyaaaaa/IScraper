# ADR: Chat-led Gmail automation runtime, V1

## Status

Accepted for the first implementation slice.

## Context

Icebreaker is adding a chat-led automation builder, starting with Gmail reading. V1 needs manual runs and recurring schedules, user-owned app connections, model selection, persistent definitions/run history, and a backend worker. Plan gating, agency/client organization, app-event triggers, writes to Gmail, and user-provided model keys are later work.

## Decision

- Keep the runtime inside the existing orchestration service and monorepo. Add a separate automation domain/API without repurposing the existing content-publishing workflow.
- Persist definitions and redacted run summaries in Supabase. Keep local-store equivalents for deterministic development tests.
- Use Composio for per-user Gmail connection custody and tool execution. The app binds sessions to the authenticated Supabase user ID and exposes only the Gmail read action to the agent.
- Run the model and tool-call loop server-side through OpenRouter. Offer models discovered as tool-capable, while validating one bounded Gmail read call per run.
- Run schedules from the existing Render worker. Claim due schedules with a ten-minute lease so concurrent workers do not run the same schedule and expired claims can be retried.
- Support manual and interval schedules (one hour to thirty days) for V1. Keep app-event triggers out of the first runtime.
- Never persist raw Gmail message bodies in IScraper run history. Store the generated summary, status, timestamps, and non-sensitive activity counts only.

## Alternatives considered

| Option | Benefits | Costs | Decision |
| --- | --- | --- | --- |
| Separate workflow repo/service | Independent deploy and runtime scaling | Duplicates auth/storage/deploy setup before load proves it necessary | Defer |
| Direct Gmail OAuth/API implementation | Full control over scopes, consent UX, and credentials | Adds token encryption, refresh/revoke, and per-provider OAuth work immediately | Revisit for enterprise controls or provider requirements |
| Composio-backed connector behind an app-owned boundary | Fast multi-app path; provider credentials remain outside Icebreaker | Dependency on provider retention/settings and Composio service; app still needs safe identity binding | Choose for V1 |
| General MCP endpoint as the only tool interface | Broad interoperability | Doesn't by itself provide the app catalog, OAuth lifecycle, or workflow persistence | Defer; add an MCP adapter when needed |

## Security and operational requirements

- Gmail OAuth must request only read access; sending, editing, deleting, and forwarding are not exposed in V1.
- Configure Composio's callback identity verifier before enabling connection creation.
- Keep OpenRouter and Composio credentials server-side. Bound Gmail messages, tool-call count, model output, and request time.
- Email bodies are untrusted input. They cannot add tools or change the agent's read-only rules.
- Apply the Supabase migration before enabling the API or worker against Supabase.
- Google treats Gmail message-reading access as a restricted OAuth scope; complete the required verification and assessment before public release.

## Trade-offs and revisit triggers

Composio speeds up connection and tool execution but introduces a third-party custody and logging boundary. Reassess if enterprise data-control, contract, residency, or retention requirements cannot be met. Replace interval schedules with timezone-aware calendar schedules when users need a specific local wall-clock time. Consider a separate runtime service only after schedule throughput or availability needs diverge from the indexing worker.
