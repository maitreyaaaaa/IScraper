import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  appendAutomationChatMessage,
  connectGmail,
  createAutomation,
  createAutomationChat,
  deleteAutomation,
  deleteAutomationChat,
  draftAutomation,
  getAutomationChat,
  getAutomationModels,
  getAutomationRunHistory,
  getAutomations,
  getGmailConnections,
  runAutomation,
  reviseAutomationDraft,
  updateAutomation,
  updateAutomationChat,
} from '../api';

const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const FIELD_CLASS = 'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
const CARD_CLASS = 'rounded-2xl border border-border bg-card';
const SCHEDULE_OPTIONS = [60, 360, 720, 1440, 10080];

export default function AutomationWorkspace({ view, chatId, onNavigate, onChatsChanged }) {
  if (view === 'new-chat') {
    return <NewAutomationChat key={chatId || 'new'} chatId={chatId} onNavigate={onNavigate} onChatsChanged={onChatsChanged} />;
  }
  if (view === 'scheduled-tasks') {
    return <AutomationListView key="scheduled-tasks" scheduled onNavigate={onNavigate} />;
  }
  if (view === 'run-history') return <RunHistoryView onNavigate={onNavigate} />;
  return <AutomationListView key="my-automations" onNavigate={onNavigate} />;
}

function NewAutomationChat({ chatId, onNavigate, onChatsChanged }) {
  const [localChatId, setLocalChatId] = useState('');
  const activeChatId = chatId || localChatId;
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [linkedAutomationId, setLinkedAutomationId] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailLabel, setGmailLabel] = useState('Gmail connection needed');
  const [mockMode, setMockMode] = useState(false);
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState('');
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(Boolean(chatId));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteDialogRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const callbackStatus = new URLSearchParams(window.location.search).get('gmailConnection');
    Promise.allSettled([
      getAutomationModels(),
      getGmailConnections(),
      chatId ? getAutomationChat(chatId) : Promise.resolve(null),
    ]).then(([modelsResult, connectionsResult, chatResult]) => {
      if (cancelled) return;
      if (modelsResult.status === 'fulfilled') {
        const available = modelsResult.value.models || [];
        setModels(available);
        setMockMode(modelsResult.value.mockMode === true);
        if (chatResult.status === 'fulfilled' && chatResult.value?.chat?.model) {
          setModel(chatResult.value.chat.model);
        } else if (available.length) {
          setModel((current) => available.some((item) => item.id === current) ? current : available[0].id);
        }
      }
      if (connectionsResult.status === 'fulfilled') {
        const connections = connectionsResult.value.connections || [];
        const connection = connections.find((item) => ['active', 'connected'].includes(String(item.status || '').toLowerCase()));
        setGmailConnected(Boolean(connection));
        setGmailLabel(connection?.alias || 'Gmail connection needed');
        setMockMode(connectionsResult.value.mockMode === true || modelsResult.value?.mockMode === true);
      }
      if (chatId) {
        if (chatResult.status === 'fulfilled' && chatResult.value?.chat) {
          const chat = chatResult.value.chat;
          setMessages(chat.messages || []);
          setDraft(chat.draft || null);
          setLinkedAutomationId(chat.automationId || '');
          setModel(chat.model || DEFAULT_MODEL);
        } else if (chatResult.status === 'rejected') {
          setError(chatResult.reason?.message || 'Could not load this automation chat.');
        }
      }
      if (modelsResult.status === 'rejected' && !modelsResult.reason?.message?.includes('configured')) {
        setError(modelsResult.reason?.message || 'Could not load available models.');
      }
      if (callbackStatus === 'connected') setNotice('Gmail connected. Review your draft before activating it.');
      if (callbackStatus === 'failed') setError('Gmail could not be connected. Try again.');
      if (callbackStatus) {
        const url = new URL(window.location.href);
        url.searchParams.delete('gmailConnection');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [chatId]);

  useEffect(() => {
    if (!activeChatId || !draft || loading || linkedAutomationId) return undefined;
    const timer = window.setTimeout(() => {
      updateAutomationChat(activeChatId, { draft, model }).catch((requestError) => setError(requestError.message));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeChatId, draft, linkedAutomationId, loading, model]);

  const persistUserMessage = useCallback(async (messageText) => {
    let id = activeChatId;
    let createdChat = false;
    if (!id) {
      const response = await createAutomationChat(model);
      id = response.chat.id;
      setLocalChatId(id);
      createdChat = true;
    }
    const body = await appendAutomationChatMessage(id, { role: 'user', text: messageText });
    setMessages((current) => [...current, body.message]);
    try { await onChatsChanged?.(); } catch { /* Sidebar refresh can retry on its next open. */ }
    return { id, createdChat };
  }, [activeChatId, model, onChatsChanged]);

  async function handleSend(event) {
    event.preventDefault();
    const text = composer.trim();
    if (!text || busy || text.length > 2000) return;
    setComposer('');
    setError('');
    setNotice('');
    setBusy(draft ? 'revise' : 'draft');
    setActivity(draft ? 'Updating your draft' : 'Planning Gmail steps');
    let createdChatId = '';
    try {
      const persisted = await persistUserMessage(text);
      const { id } = persisted;
      if (persisted.createdChat) createdChatId = id;
      const response = draft
        ? await reviseAutomationDraft(draft, text, model)
        : await draftAutomation(text, model);
      const result = draft ? response.revision : response.draft;
      let assistantText;
      if (result?.supported && result.automation) {
        const nextDraft = result.automation;
        setDraft(nextDraft);
        await updateAutomationChat(id, { draft: nextDraft, model });
        assistantText = result.reply || 'Draft ready. Review the Gmail scope and schedule before activating it.';
      } else {
        assistantText = result?.explanation || 'This first release supports read-only Gmail automations with manual or scheduled runs.';
      }
      const savedMessage = await appendAutomationChatMessage(id, { role: 'assistant', text: assistantText });
      setMessages((current) => [...current, savedMessage.message]);
      try { await onChatsChanged?.(); } catch { /* Sidebar refresh can retry on its next open. */ }
    } catch (requestError) {
      setError(requestError.message || 'The automation draft could not be created. Your message is saved; try again.');
    } finally {
      setBusy('');
      setActivity('');
      if (createdChatId) onNavigate?.('new-chat', createdChatId, { replace: true });
    }
  }

  async function handleConnectGmail() {
    setBusy('connect');
    setError('');
    try {
      const body = await connectGmail(activeChatId);
      if (body.mockMode) {
        setGmailConnected(true);
        setGmailLabel('Demo Gmail (mock)');
        setMockMode(true);
        setNotice('Demo Gmail connected. Runs use sample messages and contact no external services.');
        setBusy('');
        return;
      }
      if (!body.redirectUrl) throw new Error('Gmail connection did not return an authorization link.');
      window.location.assign(body.redirectUrl);
    } catch (requestError) {
      setError(requestError.message || 'Gmail could not be connected.');
      setBusy('');
    }
  }

  async function handleSaveAutomation() {
    if (!draft || busy || linkedAutomationId) return;
    if (draft.triggerType === 'schedule' && !gmailConnected) {
      setError('Connect Gmail before activating a schedule.');
      return;
    }
    setBusy('save');
    setError('');
    try {
      const body = await createAutomation(draft);
      setLinkedAutomationId(body.automation.id);
      await updateAutomationChat(activeChatId, { draft, automationId: body.automation.id, model });
      const text = draft.triggerType === 'schedule'
        ? 'Automation saved and schedule activated. You can pause it from Scheduled Tasks.'
        : 'Automation saved. Run it from My Automations whenever you are ready.';
      const message = await appendAutomationChatMessage(activeChatId, { role: 'assistant', text });
      setMessages((current) => [...current, message.message]);
      setNotice('Automation saved.');
      try { await onChatsChanged?.(); } catch { /* Sidebar refresh can retry on its next open. */ }
    } catch (requestError) {
      setError(requestError.message || 'The automation could not be saved.');
    } finally {
      setBusy('');
    }
  }

  async function handleDeleteChat() {
    if (!chatId || busy) return;
    setBusy('delete');
    setError('');
    try {
      await deleteAutomationChat(chatId);
      try { await onChatsChanged?.(); } catch { /* Sidebar refresh can retry on its next open. */ }
      setConfirmDelete(false);
      setMessages([]);
      setDraft(null);
      setLinkedAutomationId('');
      onNavigate?.('new-chat', '', { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'This chat could not be deleted.');
    } finally {
      setBusy('');
    }
  }

  function updateDraftField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateScheduleInterval(value) {
    setDraft((current) => ({ ...current, triggerConfig: { everyMinutes: Number(value) } }));
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-14rem)] w-full max-w-4xl flex-col px-4 pb-5 pt-5 md:min-h-dvh md:px-8 md:pt-7">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">New Chat</h1>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="automation-model">AI model</label>
          <select
            id="automation-model"
            value={model}
            onChange={(event) => {
              const nextModel = event.target.value;
              setModel(nextModel);
              if (activeChatId) updateAutomationChat(activeChatId, { model: nextModel }).catch((requestError) => setError(requestError.message));
            }}
            className="max-w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            disabled={busy !== ''}
          >
            {!models.some((item) => item.id === model) && <option value={model}>{model}</option>}
            {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            {!models.length && <option value={DEFAULT_MODEL}>GPT-4o mini · default</option>}
          </select>
          {chatId && (
            <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete this chat" title="Delete chat" className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-destructive">
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </header>

      {mockMode && <div role="status" className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-muted-foreground">Demo mode · sample Gmail and local model responses</div>}
      {(error || notice) && <InlineNotice error={error} notice={notice} onDismiss={() => { setError(''); setNotice(''); }} />}

      <section className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3" aria-label="Gmail connection">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${gmailConnected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}><Mail className="size-4" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{gmailConnected ? gmailLabel : 'Connect Gmail'}</p>
            <p className="text-xs text-muted-foreground">Read only · messages are never changed</p>
          </div>
        </div>
        {!gmailConnected && <button type="button" onClick={handleConnectGmail} disabled={busy !== ''} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-foreground disabled:opacity-50"><Mail className="size-3.5" /> Connect <ArrowUpRight className="size-3.5" /></button>}
        {gmailConnected && <span className="inline-flex items-center gap-1.5 text-xs text-primary"><CheckCircle2 className="size-3.5" /> Connected</span>}
      </section>

      <div className="flex-1 space-y-5" aria-live="polite">
        {loading ? <LoadingRows count={2} /> : messages.length === 0 ? (
          <div className="grid min-h-48 place-items-center text-center">
            <div><div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Sparkles className="size-5" /></div><p className="text-lg font-medium text-foreground">What should Gmail take care of?</p></div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <article key={message.id} className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-primary/10 text-foreground' : 'border border-border bg-card text-foreground'}`}>
                {message.role === 'assistant' && <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase text-muted-foreground"><Sparkles className="size-3" /> Icebreaker</div>}
                {message.text}
              </article>
            ))}
            {activity && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{activity}</div>}
          </div>
        )}

        {draft && (
          <section className={`${CARD_CLASS} p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate font-semibold text-foreground">{draft.name}</h2>{linkedAutomationId && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">Active</span>}</div><p className="mt-1 text-xs text-muted-foreground">{draft.triggerType === 'schedule' ? `Repeats every ${cadenceLabel(draft.triggerConfig?.everyMinutes)}` : 'Runs manually'} · Up to {draft.maxMessages} messages</p></div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground"><Mail className="size-3" /> Gmail read only</span>
            </div>
            <details className="mt-3 rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Review automation</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs text-muted-foreground">Name<input className={FIELD_CLASS} value={draft.name} maxLength={100} disabled={Boolean(linkedAutomationId)} onChange={(event) => updateDraftField('name', event.target.value)} /></label>
                <label className="space-y-1 text-xs text-muted-foreground">AI model<select className={FIELD_CLASS} value={draft.model || model} disabled={Boolean(linkedAutomationId)} onChange={(event) => { updateDraftField('model', event.target.value); setModel(event.target.value); }}><option value={draft.model || model}>{models.find((item) => item.id === (draft.model || model))?.name || draft.model || model}</option>{models.filter((item) => item.id !== (draft.model || model)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">What it should look for<textarea className={`${FIELD_CLASS} resize-y`} rows={2} maxLength={2000} value={draft.prompt} disabled={Boolean(linkedAutomationId)} onChange={(event) => updateDraftField('prompt', event.target.value)} /></label>
                <label className="space-y-1 text-xs text-muted-foreground">Gmail search<input className={FIELD_CLASS} maxLength={300} value={draft.gmailQuery || ''} disabled={Boolean(linkedAutomationId)} onChange={(event) => updateDraftField('gmailQuery', event.target.value)} placeholder="Optional Gmail query" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">Messages per run<select className={FIELD_CLASS} value={draft.maxMessages} disabled={Boolean(linkedAutomationId)} onChange={(event) => updateDraftField('maxMessages', Number(event.target.value))}>{[1, 3, 5, 10].map((value) => <option key={value} value={value}>{value} messages</option>)}</select></label>
                <label className="space-y-1 text-xs text-muted-foreground">Run<select className={FIELD_CLASS} value={draft.triggerType} disabled={Boolean(linkedAutomationId)} onChange={(event) => updateDraftField('triggerType', event.target.value)}><option value="manual">Manually</option><option value="schedule">On a schedule</option></select></label>
                {draft.triggerType === 'schedule' && <label className="space-y-1 text-xs text-muted-foreground">Repeat every<select className={FIELD_CLASS} value={draft.triggerConfig?.everyMinutes || 1440} disabled={Boolean(linkedAutomationId)} onChange={(event) => updateScheduleInterval(event.target.value)}>{SCHEDULE_OPTIONS.map((value) => <option key={value} value={value}>{cadenceLabel(value)}</option>)}</select></label>}
              </div>
            </details>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Nothing runs until you activate this reviewed draft.</p>
              <button type="button" onClick={handleSaveAutomation} disabled={busy !== '' || Boolean(linkedAutomationId) || (draft.triggerType === 'schedule' && !gmailConnected)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
                {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : linkedAutomationId ? <CheckCircle2 className="size-4" /> : <Plus className="size-4" />}
                {linkedAutomationId ? 'Automation active' : draft.triggerType === 'schedule' ? 'Save and activate' : 'Save automation'}
              </button>
            </div>
            {draft.triggerType === 'schedule' && !gmailConnected && <p className="mt-2 text-right text-xs text-muted-foreground">Connect Gmail before activating a schedule.</p>}
          </section>
        )}
      </div>

      <form onSubmit={handleSend} className="sticky bottom-0 mt-5 border-t border-white/5 bg-black/95 pt-3">
        <label className="sr-only" htmlFor="automation-chat-composer">Message Icebreaker</label>
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2.5 focus-within:border-primary/50">
          <textarea id="automation-chat-composer" value={composer} onChange={(event) => setComposer(event.target.value)} rows={2} maxLength={2000} disabled={busy !== ''} className="max-h-40 min-h-12 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground" placeholder="Describe the Gmail automation you want…" />
          <button type="submit" aria-label="Send message" disabled={busy !== '' || !composer.trim()} className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40">{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">Gmail reading only · Review before activation</p>
      </form>

      <ConfirmDialog
        dialogRef={deleteDialogRef}
        open={confirmDelete}
        busy={busy === 'delete'}
        title="Delete this chat?"
        description="Its conversation will be removed. Any saved automation and run history will remain."
        confirmLabel="Delete chat"
        onCancel={() => { deleteDialogRef.current?.close(); setConfirmDelete(false); }}
        onConfirm={handleDeleteChat}
        onClose={() => setConfirmDelete(false)}
      />
    </main>
  );
}

function AutomationListView({ scheduled = false, onNavigate }) {
  const [automations, setAutomations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');
  const [reload, setReload] = useState(0);

  const refresh = useCallback(async () => {
    const body = await getAutomations(scheduled ? { triggerType: 'schedule', sort: 'nextRunAt' } : {});
    setAutomations(body.automations || []);
  }, [scheduled]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError('');
      return refresh().catch((requestError) => { if (!cancelled) setError(requestError.message || 'Could not load automations.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    });
    return () => { cancelled = true; };
  }, [refresh, reload]);

  const visibleAutomations = useMemo(() => automations.filter((item) => filter === 'all' || item.status === filter), [automations, filter]);
  const selected = visibleAutomations.find((item) => item.id === selectedId) || null;

  async function handleUpdate(id, patch) {
    setBusy(id);
    setError('');
    setNotice('');
    try {
      const body = await updateAutomation(id, patch);
      setAutomations((current) => current.map((item) => item.id === id ? body.automation : item));
      setNotice(patch.status ? `Automation ${patch.status}.` : 'Automation updated.');
    } catch (requestError) {
      setError(requestError.message || 'The automation could not be updated.');
    } finally {
      setBusy('');
    }
  }

  async function handleDelete(id) {
    setBusy(id);
    setError('');
    try {
      await deleteAutomation(id);
      setAutomations((current) => current.filter((item) => item.id !== id));
      setSelectedId('');
      setNotice('Automation and its run history deleted. Saved chats remain.');
    } catch (requestError) {
      setError(requestError.message || 'The automation could not be deleted.');
    } finally {
      setBusy('');
    }
  }

  async function handleRun(id) {
    setBusy(id);
    setError('');
    setNotice('');
    try {
      const body = await runAutomation(id);
      setNotice(body.run?.status === 'completed' ? 'Run completed.' : `Run ${statusLabel(body.run?.status || 'failed')}.`);
    } catch (requestError) {
      setError(requestError.message || 'The automation could not run.');
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-8 pt-6 md:px-8 md:pt-9">
      <header className="mb-5 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{scheduled ? 'Scheduled Tasks' : 'My Automations'}</h1>
        <button type="button" onClick={() => onNavigate?.('new-chat')} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground"><Plus className="size-4" /> New Chat</button>
      </header>
      {(error || notice) && <InlineNotice error={error} notice={notice} onDismiss={() => { setError(''); setNotice(''); }} />}
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{loading ? 'Loading…' : `${visibleAutomations.length} ${scheduled ? 'scheduled tasks' : 'automations'}`}</p>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`automation-filter-${scheduled ? 'scheduled' : 'all'}`}>Filter by status</label>
          <select id={`automation-filter-${scheduled ? 'scheduled' : 'all'}`} value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground"><option value="all">All status</option><option value="active">Active</option><option value="paused">Paused</option></select>
          <button type="button" aria-label="Refresh automations" onClick={() => setReload((current) => current + 1)} className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground"><RefreshCw className="size-4" /></button>
        </div>
      </div>
      {loading ? <LoadingRows /> : visibleAutomations.length === 0 ? (
        <EmptyState
          icon={scheduled ? CalendarClock : Activity}
          title={scheduled ? 'No scheduled tasks' : 'No automations yet'}
          action="Create with chat"
          onAction={() => onNavigate?.('new-chat')}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
          <div className="space-y-2">
            {visibleAutomations.map((item) => (
              <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} aria-current={selectedId === item.id ? 'true' : undefined} className={`w-full rounded-xl border p-4 text-left ${selectedId === item.id ? 'border-primary/50 bg-primary/5' : 'border-border bg-card hover:bg-muted/30'}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{item.name}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.prompt}</p></div><StatusPill status={item.status} /></div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5">{item.triggerType === 'schedule' ? <Clock3 className="size-3.5" /> : <Play className="size-3.5" />}{item.triggerType === 'schedule' ? `Every ${cadenceLabel(item.triggerConfig?.everyMinutes)}` : 'Manual'}</span>{scheduled && <span>Next · {item.status === 'active' ? formatDate(item.nextRunAt) : 'Paused'}</span>}</div>
              </button>
            ))}
          </div>
          {selected && (
            <AutomationDetailPanel
              key={selected.id}
              automation={selected}
              busy={busy === selected.id}
              onClose={() => setSelectedId('')}
              onUpdate={(patch) => handleUpdate(selected.id, patch)}
              onRun={() => handleRun(selected.id)}
              onDelete={() => handleDelete(selected.id)}
            />
          )}
        </div>
      )}
    </main>
  );
}

function AutomationDetailPanel({ automation, busy, onClose, onUpdate, onRun, onDelete }) {
  const [interval, setInterval] = useState(automation.triggerConfig?.everyMinutes || 1440);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialogRef = useRef(null);

  return (
    <aside className={`${CARD_CLASS} p-4`} aria-label={`${automation.name} details`}>
      <div className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-foreground">{automation.name}</h2><StatusPill status={automation.status} /></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{automation.prompt}</p></div><button type="button" onClick={onClose} aria-label="Close automation details" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button></div>
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">Trigger</span><span className="text-foreground">{automation.triggerType === 'schedule' ? 'Schedule' : 'Manual'}</span></div>
        {automation.triggerType === 'schedule' && <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">Next run</span><span className="text-foreground">{automation.status === 'active' ? formatDate(automation.nextRunAt) : 'Paused'}</span></div>}
        <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">Gmail query</span><span className="max-w-[65%] truncate text-foreground">{automation.gmailQuery || 'All recent messages'}</span></div>
        {automation.triggerType === 'schedule' && (
          <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">Repeat every
            <select value={interval} disabled={busy} onChange={(event) => setInterval(Number(event.target.value))} className="max-w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-foreground">{SCHEDULE_OPTIONS.map((value) => <option key={value} value={value}>{cadenceLabel(value)}</option>)}</select>
          </label>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => onUpdate({ status: automation.status === 'active' ? 'paused' : 'active', nextRunAt: automation.status === 'active' ? automation.nextRunAt : null })} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground disabled:opacity-50">{automation.status === 'active' ? 'Pause' : 'Resume'}</button>
        {automation.triggerType === 'schedule' && interval !== (automation.triggerConfig?.everyMinutes || 1440) && <button type="button" onClick={() => onUpdate({ triggerConfig: { everyMinutes: interval }, nextRunAt: null })} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground disabled:opacity-50">Save schedule</button>}
        <button type="button" onClick={onRun} disabled={busy || automation.status !== 'active'} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run now</button>
        <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} aria-label="Delete automation" className="ml-auto grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-destructive disabled:opacity-50"><Trash2 className="size-4" /></button>
      </div>
      <ConfirmDialog
        dialogRef={dialogRef}
        open={confirmDelete}
        busy={busy}
        title="Delete this automation?"
        description="Its run history will also be deleted. Any saved chat will remain."
        confirmLabel="Delete automation"
        onCancel={() => { dialogRef.current?.close(); setConfirmDelete(false); }}
        onConfirm={async () => { await onDelete(); setConfirmDelete(false); }}
        onClose={() => setConfirmDelete(false)}
      />
    </aside>
  );
}

function RunHistoryView({ onNavigate }) {
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const filters = useMemo(() => ({ status, from, to }), [status, from, to]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError('');
      return getAutomationRunHistory({ ...filters, page: 1, limit: 25 }).then((body) => {
      if (cancelled) return;
      setRuns(body.runs || []);
      setPage(1);
      setTotal(body.total || 0);
      setHasMore(Boolean(body.hasMore));
      setSelected(null);
      }).catch((requestError) => {
        if (!cancelled) setError(requestError.message || 'Could not load run history.');
      }).finally(() => { if (!cancelled) setLoading(false); });
    });
    return () => { cancelled = true; };
  }, [filters, reload]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    setError('');
    try {
      const body = await getAutomationRunHistory({ ...filters, page: nextPage, limit: 25 });
      setRuns((current) => [...current, ...(body.runs || [])]);
      setPage(nextPage);
      setTotal(body.total || 0);
      setHasMore(Boolean(body.hasMore));
    } catch (requestError) {
      setError(requestError.message || 'Could not load more runs.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-8 pt-6 md:px-8 md:pt-9">
      <header className="mb-5 flex items-center justify-between gap-4"><h1 className="text-xl font-semibold text-foreground">Run History</h1><button type="button" onClick={() => onNavigate?.('new-chat')} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground"><Plus className="size-4" /> New Chat</button></header>
      {error && <InlineNotice error={error} onDismiss={() => setError('')} />}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-muted-foreground">{loading ? 'Loading…' : `${total} runs`}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-[10px] text-muted-foreground">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className="block rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground"><option value="">All</option><option value="running">Running</option><option value="completed">Completed</option><option value="needs_connection">Needs connection</option><option value="failed">Failed</option></select></label>
          <label className="space-y-1 text-[10px] text-muted-foreground">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="block rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground" /></label>
          <label className="space-y-1 text-[10px] text-muted-foreground">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="block rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground" /></label>
          <button type="button" aria-label="Refresh run history" onClick={() => setReload((current) => current + 1)} className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground"><RefreshCw className="size-4" /></button>
        </div>
      </div>
      {loading ? <LoadingRows /> : runs.length === 0 ? <EmptyState icon={Activity} title="No runs found" action="Create an automation" onAction={() => onNavigate?.('new-chat')} /> : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
          <div className="space-y-2">
            {runs.map((run) => (
              <button type="button" key={run.id} onClick={() => setSelected(run)} aria-current={selected?.id === run.id ? 'true' : undefined} className={`w-full rounded-xl border p-4 text-left ${selected?.id === run.id ? 'border-primary/50 bg-primary/5' : 'border-border bg-card hover:bg-muted/30'}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{run.automationName || 'Automation'}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(run.startedAt)} · {run.triggerType === 'schedule' ? 'Scheduled' : 'Manual'}</p></div><StatusPill status={run.status} /></div>
                {run.summary && <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{run.summary}</p>}
              </button>
            ))}
            {hasMore && <button type="button" onClick={loadMore} disabled={loadingMore} className="w-full rounded-lg border border-border px-4 py-2.5 text-sm text-foreground disabled:opacity-50">{loadingMore ? 'Loading…' : 'Load more'}</button>}
          </div>
          {selected && <RunDetailPanel run={selected} onClose={() => setSelected(null)} />}
        </div>
      )}
    </main>
  );
}

function RunDetailPanel({ run, onClose }) {
  return (
    <aside className={`${CARD_CLASS} p-4`} aria-label="Run details">
      <div className="mb-4 flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-foreground">{run.automationName || 'Automation run'}</h2><StatusPill status={run.status} /></div><p className="mt-1 text-xs text-muted-foreground">{formatDate(run.startedAt)} · {run.triggerType === 'schedule' ? 'Scheduled' : 'Manual'}</p></div><button type="button" onClick={onClose} aria-label="Close run details" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button></div>
      {run.summary && <section className="border-t border-border py-4"><h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Result</h3><p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{run.summary}</p></section>}
      {run.error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{run.error}</p>}
      <section className="border-t border-border pt-4"><h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground"><Activity className="size-3.5" /> Activity</h3>{run.activity?.length ? <ol className="space-y-2">{run.activity.slice(0, 20).map((step, index) => <li key={`${step.state}-${step.at}-${index}`} className="flex items-start justify-between gap-3 text-xs"><span className="text-foreground">{String(step.state || 'step').replaceAll('_', ' ')}</span><time className="shrink-0 text-muted-foreground">{formatDate(step.at)}</time></li>)}</ol> : <p className="text-xs text-muted-foreground">No activity details.</p>}</section>
    </aside>
  );
}

function StatusPill({ status }) {
  const completed = status === 'completed' || status === 'active';
  const error = ['failed', 'needs_connection'].includes(status);
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${completed ? 'bg-primary/10 text-primary' : error ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{statusLabel(status)}</span>;
}

function InlineNotice({ error, notice, onDismiss }) {
  const text = error || notice;
  if (!text) return null;
  return <div role={error ? 'alert' : 'status'} className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-primary/20 bg-primary/5 text-foreground'}`}><span className="mt-0.5">{error ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4 text-primary" />}</span><span className="flex-1">{text}</span>{onDismiss && <button type="button" onClick={onDismiss} className="text-xs underline">Dismiss</button>}</div>;
}

function LoadingRows({ count = 3 }) {
  return <div className="space-y-2" aria-label="Loading"><span className="sr-only">Loading</span>{Array.from({ length: count }, (_, index) => <div key={index} className="h-20 rounded-xl border border-border bg-card" />)}</div>;
}

function EmptyState({ icon: Icon, title, action, onAction }) {
  return <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-border bg-card/30 p-6 text-center"><div><div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></div><h2 className="font-medium text-foreground">{title}</h2><button type="button" onClick={onAction} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"><Plus className="size-4" /> {action}</button></div></div>;
}

function ConfirmDialog({ dialogRef, open, busy, title, description, confirmLabel, onCancel, onConfirm, onClose }) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [dialogRef, open]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="automation-confirm-title"
      aria-describedby="automation-confirm-description"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onClose={onClose}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-background p-0 text-foreground backdrop:bg-black/70"
    >
      <div className="p-5"><h2 id="automation-confirm-title" className="font-semibold">{title}</h2><p id="automation-confirm-description" className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-2 text-sm">Cancel</button><button type="button" onClick={onConfirm} disabled={busy} className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Deleting…' : confirmLabel}</button></div></div>
    </dialog>
  );
}

function cadenceLabel(minutes) {
  const value = Number(minutes) || 1440;
  if (value % 1440 === 0) return value === 1440 ? '24 hours' : `${value / 1440} days`;
  if (value % 60 === 0) return `${value / 60} hours`;
  return `${value} minutes`;
}

function formatDate(value) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not scheduled' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusLabel(status) {
  return String(status || 'unknown').replaceAll('_', ' ');
}
