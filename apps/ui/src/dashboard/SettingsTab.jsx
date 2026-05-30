import {
  Bot,
  CheckCircle2,
  Copy,
  createExtensionToken,
  FileText,
  KEY_SETUP_OPTIONS,
  KeyRound,
  Loader2,
  OPENAI_COMPATIBLE_NOTE,
  PROVIDER_DISPLAY_LABELS,
  PROVIDER_KEY_PRIVACY_NOTICE,
  PROVIDER_WARNING_COPY,
  ShieldCheck,
  supabase,
  useMemo,
  useState,
  X,
} from '../AppShared.jsx';
function SettingsTab({
  credentials,
  agentTokens,
  agentTokenName,
  setAgentTokenName,
  createdAgentAccess,
  onCreateAgentAccess,
  onRevokeAgentAccess,
  credentialForm,
  setCredentialForm,
  credentialSaveSuccess,
  onSave,
  onDelete,
  onTest,
  busy,
  authEnabled,
  onOpenHowTo,
  onNotice,
  onError,
}) {
  const selectedSetup = KEY_SETUP_OPTIONS[credentialForm.setup] || KEY_SETUP_OPTIONS.openrouter_all;
  const [providerWarning, setProviderWarning] = useState(null);
  const [telegramCode, setTelegramCode] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const providerWarningCopy = providerWarning ? PROVIDER_WARNING_COPY[providerWarning] : null;
  const [copiedAgentValue, setCopiedAgentValue] = useState('');
  const agentAccessUrls = useMemo(() => {
    const base = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
    const apiUrl = new URL(base, window.location.origin);
    const apiBase = apiUrl.href.replace(/\/api\/?$/, '/api');
    return {
      mcp: `${apiBase}/mcp`,
      query: `${apiBase}/agent-access/query`,
    };
  }, []);
  const agentMcpConfig = JSON.stringify({
    mcpServers: {
      iscraper: {
        type: 'http',
        url: agentAccessUrls.mcp,
        headers: {
          Authorization: 'Bearer PASTE_AGENT_TOKEN_HERE',
        },
      },
    },
  }, null, 2);
  const copyAgentValue = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedAgentValue(key);
      window.setTimeout(() => setCopiedAgentValue(''), 1600);
    } catch {
      setCopiedAgentValue('');
    }
  };
  const groupedCredentials = credentials.reduce((groups, credential) => {
    const key = `${credential.provider}:${credential.keyHint}:${credential.baseUrl || ''}:${credential.displayName || ''}`;
    if (!groups[key]) {
      groups[key] = {
        id: key,
        provider: credential.provider,
        baseUrl: credential.baseUrl,
        displayName: credential.displayName,
        keyHint: credential.keyHint,
        credentials: [],
      };
    }
    groups[key].credentials.push(credential);
    return groups;
  }, {});
  const createTelegramCode = async () => {
    setCaptureBusy(true);
    onError?.('');
    try {
      const body = await createExtensionToken('Telegram save bot', ['saves:create']);
      setTelegramCode(body.secret || '');
      onNotice?.('Telegram bot link code created. Send it to the bot with /connect.');
    } catch (err) {
      onError?.(err.message || 'Could not create a Telegram bot link code.');
    } finally {
      setCaptureBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl font-bold tracking-tight">AI keys</h1>
            <span className="rounded-full bg-primary px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary-foreground">
              BYOK only
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste a valid key once. IScraper picks the right models for you.
          </p>
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-muted-foreground">{PROVIDER_KEY_PRIVACY_NOTICE}</p>
        </div>
        <button
          type="button"
          onClick={onOpenHowTo}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
        >
          <FileText className="h-4 w-4" /> How to Use
        </button>
      </div>

      <section className="space-y-5 rounded-2xl border border-white/10 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Agent access</div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Agent access</h2>
          </div>
          <span className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-200">
            <ShieldCheck className="h-4 w-4" /> Read only
          </span>
        </div>

        <form onSubmit={onCreateAgentAccess} className="flex flex-col gap-3 sm:flex-row">
          <input
            value={agentTokenName}
            onChange={(event) => setAgentTokenName(event.target.value)}
            placeholder="Token name"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            Create token
          </button>
        </form>

        {createdAgentAccess?.secret && (
          <div className="space-y-3 rounded-xl border border-accent/40 bg-accent/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">Copy now</div>
                <p className="mt-1 text-sm text-muted-foreground">This token is shown once.</p>
              </div>
              <button
                type="button"
                onClick={() => copyAgentValue(createdAgentAccess.secret, 'agent-secret')}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground"
              >
                <Copy className="h-4 w-4" /> {copiedAgentValue === 'agent-secret' ? 'Copied' : 'Copy token'}
              </button>
            </div>
            <code className="block break-all rounded-lg border border-white/10 bg-black p-3 font-mono text-xs text-foreground">
              {createdAgentAccess.secret}
            </code>
          </div>
        )}

        <div className="grid gap-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">MCP endpoint</div>
              <button type="button" onClick={() => copyAgentValue(agentAccessUrls.mcp, 'mcp-url')} className="rounded-lg border border-white/10 p-2 text-primary" aria-label="Copy MCP endpoint">
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <code className="block break-all font-mono text-xs text-foreground">{agentAccessUrls.mcp}</code>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">MCP config</div>
              <button type="button" onClick={() => copyAgentValue(agentMcpConfig, 'mcp-config')} className="rounded-lg border border-white/10 p-2 text-primary" aria-label="Copy MCP config">
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <pre className="max-h-56 overflow-auto rounded-lg bg-black p-3 text-xs leading-5 text-muted-foreground">{agentMcpConfig}</pre>
          </div>
        </div>

        <div className="space-y-3">
          {agentTokens?.length ? agentTokens.map((token) => (
            <div key={token.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{token.name || 'Agent access'}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {token.revokedAt ? 'Revoked' : token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : 'Not used yet'} - expires {token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'never'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRevokeAgentAccess(token.id)}
                disabled={busy || Boolean(token.revokedAt)}
                className="rounded-lg border border-white/10 p-2 text-destructive disabled:opacity-50"
                aria-label="Revoke agent access"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )) : (
            <div className="rounded-xl border border-white/10 px-4 py-3 text-sm text-muted-foreground">
              No agent tokens yet.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Fast capture</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Telegram</h2>
        </div>
        <div className="grid gap-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Bot className="h-4 w-4 text-primary" /> Telegram save bot
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Create a code, send <span className="font-mono text-foreground">/connect</span> plus the code to the bot, then forward links.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={createTelegramCode}
          disabled={busy || captureBusy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-accent-foreground disabled:opacity-60"
        >
          {captureBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Create Telegram bot link code
        </button>
        {telegramCode && (
          <div className="rounded-xl border border-accent/40 bg-accent/10 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Private bot link code</div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-white/10 bg-black px-3 py-2 text-xs text-foreground">
                /connect {telegramCode}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(`/connect ${telegramCode}`).then(() => onNotice?.('Telegram connect command copied.'));
                }}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground transition hover:brightness-110"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Treat this like a password. This code only allows saving links into your account.</p>
          </div>
        )}
      </section>

      <form onSubmit={onSave} className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Add key</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Add key</h2>
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-muted-foreground">{PROVIDER_KEY_PRIVACY_NOTICE}</p>
        </div>
        <div className="grid gap-2 rounded-xl border border-white/10 p-1">
          {Object.entries(KEY_SETUP_OPTIONS).map(([setup, option]) => (
            <button
              key={setup}
              type="button"
              onClick={() => {
                if (PROVIDER_WARNING_COPY[setup] && credentialForm.setup !== setup) {
                  setProviderWarning(setup);
                  return;
                }
                setCredentialForm((current) => ({ ...current, setup }));
              }}
              className={`rounded-lg px-4 py-3 text-left text-sm transition ${
                credentialForm.setup === setup
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <span className="block font-semibold">{option.label}</span>
              <span className={`mt-1 block text-xs leading-5 ${credentialForm.setup === setup ? 'text-black/75' : 'text-muted-foreground'}`}>{option.help}</span>
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-muted-foreground">
          Selected: <span className="font-semibold text-foreground">{selectedSetup.label}</span>. {selectedSetup.help}
        </div>
        {credentialForm.setup === 'openai_compatible' && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-6 text-muted-foreground">{OPENAI_COMPATIBLE_NOTE}</p>
            <input
              value={credentialForm.displayName}
              onChange={(event) => setCredentialForm((current) => ({ ...current, displayName: event.target.value }))}
              placeholder="Service name optional, e.g. Groq or Together"
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <input
              type="url"
              value={credentialForm.baseUrl}
              onChange={(event) => setCredentialForm((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder="Base URL, e.g. https://api.example.com/v1"
              required
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-sm outline-none focus:border-primary"
            />
            <input
              value={credentialForm.model}
              onChange={(event) => setCredentialForm((current) => ({ ...current, model: event.target.value }))}
              placeholder="Model ID, e.g. provider/model-name"
              required
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-sm outline-none focus:border-primary"
            />
          </div>
        )}
        <div className={`space-y-3 rounded-xl border p-4 transition ${
          credentialSaveSuccess ? 'border-emerald-400 bg-emerald-500/15' : 'border-white/10 bg-transparent'
        }`}>
          <input
            type="text"
            name="provider-key-context"
            autoComplete="username"
            value="IScraper provider API"
            readOnly
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
          {credentialSaveSuccess && (
            <div className="rounded-lg border border-emerald-300/40 bg-emerald-400/15 px-4 py-3 text-sm leading-6 text-emerald-100">
              <div className="font-display text-xl font-black tracking-tight text-emerald-200">SUCCESS</div>
              <div>Your key was saved. IScraper will use it when it can.</div>
            </div>
          )}
          <input
            type="password"
            name="provider-api-key"
            autoComplete="new-password"
            value={credentialForm.apiKey}
            onChange={(event) => setCredentialForm((current) => ({ ...current, apiKey: event.target.value }))}
            placeholder="Paste API key"
            required
            className={`w-full rounded-xl border bg-black px-4 py-3 font-mono text-sm outline-none ${
              credentialSaveSuccess ? 'border-emerald-400 focus:border-emerald-300' : 'border-white/10 focus:border-primary'
            }`}
          />
        </div>
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-accent-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Save key
        </button>
      </form>

      <div className="space-y-3">
        {Object.values(groupedCredentials).map((group) => (
          <div key={group.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{group.displayName || PROVIDER_DISPLAY_LABELS[group.provider] || group.provider}</div>
              <div className="truncate text-xs text-muted-foreground">
                {group.credentials.map((credential) => credential.purpose).join(', ')} - {group.keyHint}
                {group.baseUrl ? ` - ${group.baseUrl}` : ''}
              </div>
            </div>
            <button onClick={() => onTest(group.credentials[0].id)} className="rounded-lg border border-white/10 p-2 text-primary" aria-label="Test key">
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                for (const credential of group.credentials) {
                  await onDelete(credential.id);
                }
              }}
              className="rounded-lg border border-white/10 p-2 text-destructive"
              aria-label="Delete key"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {authEnabled && (
        <button onClick={() => supabase.auth.signOut()} className="w-full rounded-xl border border-white/10 px-5 py-3 text-sm text-muted-foreground">
          Sign out
        </button>
      )}

      {providerWarningCopy && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-accent/60 bg-black p-6 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Before you continue</div>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-accent">{providerWarningCopy.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {providerWarningCopy.body} For the easiest full setup, use OpenRouter.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setCredentialForm((current) => ({ ...current, setup: 'openrouter_all' }));
                  setProviderWarning(null);
                }}
                className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
              >
                Use OpenRouter
              </button>
              <button
                type="button"
                onClick={() => {
                  setCredentialForm((current) => ({ ...current, setup: providerWarning }));
                  setProviderWarning(null);
                }}
                className="rounded-xl border border-accent/40 px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent/10"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export { SettingsTab };
