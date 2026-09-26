const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { getConfig } = require('../src/config');
const { createApp } = require('../src/server');
const { createLocalStore } = require('../src/stores/localStore');
const {
  buildGmailToolArguments,
  createAutomations,
  executeAgent,
  extractEmailRows,
  validateAutomationInput,
  verifyConnectionState,
} = require('../src/services/automations');

test('automation validation supports only bounded manual and interval schedule triggers', () => {
  const manual = validateAutomationInput({ name: 'Read Gmail', triggerType: 'manual', maxMessages: 10 });
  assert.equal(manual.triggerType, 'manual');
  assert.equal(manual.maxMessages, 10);
  assert.equal(manual.gmailQuery, '');

  const schedule = validateAutomationInput({ triggerType: 'schedule', triggerConfig: { everyMinutes: 1440 } });
  assert.equal(schedule.triggerConfig.everyMinutes, 1440);
  assert.ok(Date.parse(schedule.nextRunAt) > Date.now());
  assert.throws(() => validateAutomationInput({ triggerType: 'app_event' }), /manual and scheduled/);
  assert.throws(() => validateAutomationInput({ triggerType: 'schedule', triggerConfig: { everyMinutes: 5 } }), /between 60 minutes/);
  assert.throws(() => validateAutomationInput({ maxMessages: 11 }), /between 1 and 10/);
});

test('automation provider configuration never substitutes an OpenAI credential for OpenRouter', () => {
  const priorOpenAi = process.env.OPENAI_API_KEY;
  const priorOpenRouter = process.env.OPENROUTER_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'test-openai-only-key';
    delete process.env.OPENROUTER_API_KEY;
    assert.equal(getConfig().openRouterApiKey, undefined);
  } finally {
    if (priorOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorOpenAi;
    if (priorOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorOpenRouter;
  }
});

test('Gmail tool arguments map only to known schema fields and cap message count', () => {
  const args = buildGmailToolArguments({
    type: 'object',
    properties: { user_id: { type: 'string' }, query: { type: 'string' }, max_results: { type: 'integer' } },
    required: ['user_id', 'query', 'max_results'],
  }, { query: 'is:unread', maxResults: 8 });
  assert.deepEqual(args, { query: 'is:unread', max_results: 8, user_id: 'me' });
});

test('Gmail result normalization returns bounded user-facing fields', () => {
  const rows = extractEmailRows({ messages: [
    { subject: 'Hello', from: 'sender@example.com', date: 'Today', snippet: 'Short message' },
    { subject: '', snippet: '' },
  ] });
  assert.deepEqual(rows, [{ subject: 'Hello', from: 'sender@example.com', date: 'Today', snippet: 'Short message' }]);
});

test('automation agent can execute only one scoped Gmail read and sends only its bounded result to the model', async () => {
  const calls = [];
  const config = {
    openRouterApiKey: 'server-only-test-key',
    composioApiKey: 'server-only-composio-key',
    composioGmailAuthConfigId: 'gmail-readonly-config',
    composioBaseUrl: 'https://backend.composio.dev',
  };
  const result = await executeAgent({
    userId: 'user-a',
    config,
    automation: {
      prompt: 'Summarize unread email', gmailQuery: 'is:unread', maxMessages: 5,
      model: 'openai/gpt-4o-mini',
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/tool_router/session')) {
        return jsonResponse({ session_id: 'session-test' });
      }
      if (url.endsWith('/tool_router/session/session-test/tools')) {
        return jsonResponse({ tools: [{
          slug: 'GMAIL_FETCH_EMAILS',
          input_parameters: { properties: { user_id: {}, query: {}, max_results: {} }, required: ['user_id', 'query', 'max_results'] },
        }] });
      }
      if (url.endsWith('/tool_router/session/session-test/execute')) {
        return jsonResponse({ data: { messages: [{ subject: 'Invoice due', from: 'billing@example.com', snippet: 'Invoice 1042 is due tomorrow.' }] } });
      }
      if (url === 'https://openrouter.ai/api/v1/chat/completions') {
        const payload = JSON.parse(options.body);
        if (payload.tool_choice !== 'none') {
          assert.deepEqual(payload.tools.map((tool) => tool.function.name), ['read_gmail_messages']);
          return jsonResponse({ choices: [{ message: {
            role: 'assistant', content: null, tool_calls: [{
              id: 'call-1', type: 'function', function: { name: 'read_gmail_messages', arguments: '{"query":"is:unread","max_results":5}' },
            }],
          } }] });
        }
        assert.match(payload.messages.at(-1).content, /Invoice due/);
        return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'One unread invoice is due tomorrow.' } }] });
      }
      throw new Error(`Unexpected test request ${url}`);
    },
  });
  assert.equal(result.summary, 'One unread invoice is due tomorrow.');
  assert.equal(result.messageCount, 1);
  const sessionBody = JSON.parse(calls[0].options.body);
  assert.deepEqual(sessionBody.toolkits, { enabled: ['gmail'] });
  assert.deepEqual(sessionBody.tools, { gmail: { enabled: ['GMAIL_FETCH_EMAILS'] } });
  const gmailCall = calls.find((call) => call.url.endsWith('/execute'));
  assert.deepEqual(JSON.parse(gmailCall.options.body), {
    tool_slug: 'GMAIL_FETCH_EMAILS',
    arguments: { query: 'is:unread', max_results: 5, user_id: 'me' },
  });
});

test('live chat revision calls only the configured LLM and returns an unsaved validated draft', async () => {
  const calls = [];
  const api = createAutomations({
    store: { async consumeRateBudget() { return { allowed: true, retryAt: null }; } },
    config: { openRouterApiKey: 'server-only-test-key' },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({
        supported: true,
        reply: 'Updated the schedule to weekly.',
        automation: { triggerType: 'schedule', everyMinutes: 10080, gmailQuery: 'is:unread', maxMessages: 3 },
      }) } }] });
    },
  });
  const current = validateAutomationInput({
    name: 'Read unread Gmail', prompt: 'Summarize recent mail', triggerType: 'manual',
    gmailQuery: '', maxMessages: 3, model: 'openai/gpt-4o-mini', status: 'active',
  });
  const revision = await api.reviseDraftFromChat({ ...current, id: null, status: 'draft' }, 'Make it weekly and unread only.', undefined, 'user-a');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(revision.supported, true);
  assert.equal(revision.automation.id, null);
  assert.equal(revision.automation.status, 'draft');
  assert.equal(revision.automation.triggerConfig.everyMinutes, 10080);
  assert.equal(revision.automation.gmailQuery, 'is:unread');
  assert.equal(revision.automation.maxMessages, 3);
});

test('automation generation budget blocks provider calls and returns a retry time', async () => {
  let providerCalls = 0;
  const api = createAutomations({
    store: {
      async consumeRateBudget() {
        return { allowed: false, exceeded: 'day', retryAt: '2026-09-27T00:00:00.000Z' };
      },
    },
    config: { openRouterApiKey: 'server-only-test-key' },
    fetchImpl: async () => { providerCalls += 1; throw new Error('Provider must not run after quota denial.'); },
  });

  await assert.rejects(
    () => api.draftFromChat('Read my recent Gmail.', 'openai/gpt-4o-mini', 'user-a'),
    (error) => error.statusCode === 429 && error.retryAt === '2026-09-27T00:00:00.000Z',
  );
  assert.equal(providerCalls, 0);
});

test('manual automation run limit blocks Gmail access before creating a run record', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-run-budget-'));
  const store = createLocalStore({ dataPath: dir });
  let providerCalls = 0;
  store.consumeRateBudget = async () => ({ allowed: false, exceeded: 'minute', retryAt: new Date(Date.now() + 30_000).toISOString() });
  const automation = validateAutomationInput({
    id: 'automation-rate-limited-manual', name: 'Read Gmail', prompt: 'Summarize mail',
    triggerType: 'manual', maxMessages: 3, model: 'openai/gpt-4o-mini', status: 'active',
  });
  store.saveAutomation('user-a', automation);
  const api = createAutomations({
    store,
    config: { storageMode: 'local', nodeEnv: 'production' },
    fetchImpl: async () => { providerCalls += 1; throw new Error('Provider must not run after quota denial.'); },
  });

  try {
    await assert.rejects(() => api.run('user-a', automation.id, 'manual'), (error) => error.statusCode === 429);
    assert.equal((await store.listAutomationRuns('user-a', automation.id, 10)).length, 0);
    assert.equal(providerCalls, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scheduled automation rate limit is recorded and deferred until the shared window resets', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-scheduled-budget-'));
  const store = createLocalStore({ dataPath: dir });
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  let providerCalls = 0;
  store.consumeRateBudget = async () => ({ allowed: false, exceeded: 'day', retryAt });
  const automation = validateAutomationInput({
    id: 'automation-rate-limited-schedule', name: 'Daily Gmail summary', prompt: 'Summarize recent mail',
    triggerType: 'schedule', triggerConfig: { everyMinutes: 1440 }, maxMessages: 3,
    model: 'openai/gpt-4o-mini', status: 'active', nextRunAt: new Date(Date.now() - 1000).toISOString(),
  });
  store.saveAutomation('user-a', automation);
  const api = createAutomations({
    store,
    config: { storageMode: 'local', nodeEnv: 'production' },
    fetchImpl: async () => { providerCalls += 1; throw new Error('Provider must not run after quota denial.'); },
  });

  try {
    const result = await api.runDueSchedules();
    assert.equal(result.claimed, 1);
    assert.equal(result.results[0].status, 'rate_limited');
    assert.equal(providerCalls, 0);
    const saved = await store.getAutomation('user-a', automation.id);
    assert.equal(saved.nextRunAt, retryAt);
    assert.equal(saved.scheduleLeaseToken, null);
    const runs = await store.listAutomationRuns('user-a', automation.id, 10);
    assert.equal(runs[0].status, 'rate_limited');
    assert.equal(runs[0].activity[1].retryAt, retryAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('connection state is signed, expires, and cannot be changed', () => {
  const config = { automationConnectStateSecret: 'test-only-secret' };
  const now = () => new Date('2026-09-24T12:00:00.000Z');
  const automations = createAutomations({ store: {}, config, now });
  const token = automations.signConnectionState('user-a');
  assert.equal(automations.verifyConnectionState(token), 'user-a');
  assert.equal(automations.verifyConnectionState(`${token}x`), null);
  assert.equal(verifyConnectionState(token, config, () => new Date('2026-09-24T12:11:00.000Z')), null);
});

test('scheduled automations are leased once and requeued after completion', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-automations-'));
  const store = createLocalStore({ dataPath: dir });
  const api = createAutomations({ store });
  try {
    const automation = await api.create('user-a', {
      name: 'Daily Gmail summary',
      prompt: 'Summarize recent messages',
      triggerType: 'manual',
    });
    const internal = validateAutomationInput({ ...automation, triggerType: 'schedule', triggerConfig: { everyMinutes: 60 } });
    internal.nextRunAt = new Date(Date.now() - 60_000).toISOString();
    store.saveAutomation('user-a', internal);

    const claimed = await store.claimDueAutomations(5);
    assert.equal(claimed.length, 1);
    assert.ok(claimed[0].scheduleLeaseToken);
    assert.equal((await store.claimDueAutomations(5)).length, 0);
    assert.equal(await store.completeAutomationSchedule('user-a', automation.id, 'wrong-token'), false);
    assert.equal(await store.completeAutomationSchedule('user-a', automation.id, claimed[0].scheduleLeaseToken), true);
    assert.equal((await store.claimDueAutomations(5)).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schedule activation requires Gmail and server-owned timing survives edits during a lease', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-schedule-boundary-'));
  const store = createLocalStore({ dataPath: dir });
  const api = createAutomations({
    store,
    config: { automationMockMode: true, nodeEnv: 'development', storageMode: 'local' },
    fetchImpl: async () => { throw new Error('Mock mode must not call providers.'); },
  });
  try {
    const schedule = { name: 'Daily read', triggerType: 'schedule', triggerConfig: { everyMinutes: 60 } };
    await assert.rejects(() => api.create('user-a', schedule), /Connect Gmail before activating/);
    await api.startGmailConnection({ userId: 'user-a' });
    const automation = await api.create('user-a', {
      ...schedule,
      id: 'client-controlled-id',
      nextRunAt: '2000-01-01T00:00:00.000Z',
    });
    assert.notEqual(automation.id, 'client-controlled-id');
    assert.ok(Date.parse(automation.nextRunAt) > Date.now());

    const due = store.getAutomation('user-a', automation.id);
    due.nextRunAt = new Date(Date.now() - 60_000).toISOString();
    store.saveAutomation('user-a', due);
    const [claimed] = store.claimDueAutomations(1);
    const edited = await api.update('user-a', automation.id, {
      name: 'Renamed read', nextRunAt: '2000-01-01T00:00:00.000Z',
    });
    assert.equal(edited.scheduleLeaseToken, claimed.scheduleLeaseToken);
    assert.equal(edited.nextRunAt, claimed.nextRunAt);
    assert.equal(store.claimDueAutomations(1).length, 0);
    assert.equal(store.completeAutomationSchedule('user-a', automation.id, claimed.scheduleLeaseToken), true);

    const paused = await api.update('user-a', automation.id, { status: 'paused' });
    assert.equal(paused.nextRunAt, null);
    const resumed = await api.update('user-a', automation.id, {
      status: 'active', nextRunAt: '2000-01-01T00:00:00.000Z',
    });
    assert.ok(Date.parse(resumed.nextRunAt) > Date.now());
    const changed = await api.update('user-a', automation.id, { triggerConfig: { everyMinutes: 120 } });
    assert.ok(Date.parse(changed.nextRunAt) > Date.now() + 119 * 60_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('automation filters run before the list cap', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-list-filter-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: {} });
  const server = app.listen(0);
  try {
    const schedule = validateAutomationInput({ name: 'Older schedule', triggerType: 'schedule', triggerConfig: { everyMinutes: 60 } });
    store.saveAutomation('user-a', schedule);
    for (let index = 0; index < 101; index += 1) {
      store.saveAutomation('user-a', validateAutomationInput({ name: `Manual ${index}`, triggerType: 'manual' }));
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/automations?triggerType=schedule`, {
      headers: { 'x-user-id': 'user-a' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).automations.map((item) => item.name), ['Older schedule']);
    const firstPageResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/automations?page=1&limit=25`, {
      headers: { 'x-user-id': 'user-a' },
    });
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage.automations.length, 25);
    assert.equal(firstPage.hasMore, true);
    const lastPageResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/automations?page=5&limit=25`, {
      headers: { 'x-user-id': 'user-a' },
    });
    const lastPage = await lastPageResponse.json();
    assert.equal(lastPage.automations.length, 2);
    assert.equal(lastPage.hasMore, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('automation REST routes isolate definitions and retain manual run history without Gmail credentials', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-automation-api-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { openRouterApiKey: '', composioApiKey: '' } });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const create = await fetch(`${base}/api/automations`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': 'user-a' },
      body: JSON.stringify({ name: 'Daily read', triggerType: 'manual' }),
    });
    assert.equal(create.status, 201);
    const { automation } = await create.json();
    assert.equal(Object.hasOwn(automation, 'scheduleLeaseToken'), false);
    assert.equal(Object.hasOwn(automation, 'scheduleLeaseUntil'), false);
    assert.equal(Object.hasOwn(automation, 'userId'), false);

    const listAutomations = store.listAutomations;
    store.listAutomations = async (...args) => {
      const page = await listAutomations(...args);
      return { ...page, automations: page.automations.map((entry) => ({ ...entry, internalCredential: 'must not leak' })) };
    };
    const own = await fetch(`${base}/api/automations`, { headers: { 'x-user-id': 'user-a' } });
    const ownBody = await own.json();
    assert.equal(ownBody.automations.length, 1);
    assert.equal(Object.hasOwn(ownBody.automations[0], 'internalCredential'), false);
    const other = await fetch(`${base}/api/automations`, { headers: { 'x-user-id': 'user-b' } });
    assert.equal((await other.json()).automations.length, 0);

    const runResponse = await fetch(`${base}/api/automations/${automation.id}/run`, {
      method: 'POST', headers: { 'x-user-id': 'user-a' },
    });
    assert.equal(runResponse.status, 502);
    const failedRunBody = await runResponse.json();
    const run = failedRunBody.run;
    assert.equal(run.status, 'failed');
    assert.match(run.error, /AI is not configured/);
    assert.equal(failedRunBody.error, run.error);

    const otherRuns = await fetch(`${base}/api/automations/${automation.id}/runs`, { headers: { 'x-user-id': 'user-b' } });
    assert.equal(otherRuns.status, 404);
    const ownRuns = await fetch(`${base}/api/automations/${automation.id}/runs`, { headers: { 'x-user-id': 'user-a' } });
    assert.equal((await ownRuns.json()).runs.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('automation chats and account-wide run history are scoped, paginated, and independent', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-automation-chats-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { openRouterApiKey: '', composioApiKey: '' } });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headersFor = (userId) => ({ 'content-type': 'application/json', 'x-user-id': userId });
    const createAutomation = async (userId, name) => {
      const response = await fetch(`${base}/api/automations`, {
        method: 'POST', headers: headersFor(userId),
        body: JSON.stringify({ name, prompt: 'Read recent Gmail', triggerType: 'manual' }),
      });
      assert.equal(response.status, 201);
      return (await response.json()).automation;
    };
    const runAutomation = async (userId, id) => {
      const response = await fetch(`${base}/api/automations/${id}/run`, { method: 'POST', headers: headersFor(userId) });
      assert.equal(response.status, 502);
      return (await response.json()).run;
    };

    const firstAutomation = await createAutomation('user-a', 'First Gmail read');
    const secondAutomation = await createAutomation('user-a', 'Second Gmail read');
    const firstRun = await runAutomation('user-a', firstAutomation.id);
    const secondRun = await runAutomation('user-a', secondAutomation.id);
    assert.equal(firstRun.status, 'failed');
    assert.equal(secondRun.status, 'failed');

    const createChat = await fetch(`${base}/api/automation-chats`, {
      method: 'POST', headers: headersFor('user-a'), body: JSON.stringify({ model: 'openai/gpt-4o-mini' }),
    });
    assert.equal(createChat.status, 201);
    const { chat } = await createChat.json();
    const appendMessage = async (role, text) => fetch(`${base}/api/automation-chats/${chat.id}/messages`, {
      method: 'POST', headers: headersFor('user-a'), body: JSON.stringify({ role, text }),
    });
    assert.equal((await appendMessage('user', 'Summarize unread Gmail')).status, 201);
    assert.equal((await appendMessage('assistant', 'I drafted a read-only Gmail workflow.\n\nReview the schedule before activation.')).status, 201);

    const draft = { name: 'Unread summary', prompt: 'Summarize unread messages', triggerType: 'manual', maxMessages: 5 };
    const update = await fetch(`${base}/api/automation-chats/${chat.id}`, {
      method: 'PATCH', headers: headersFor('user-a'),
      body: JSON.stringify({ model: 'anthropic/claude-3.5-sonnet', draft, automationId: firstAutomation.id }),
    });
    assert.equal(update.status, 200);
    const ownChat = await fetch(`${base}/api/automation-chats/${chat.id}`, { headers: headersFor('user-a') });
    const savedChat = (await ownChat.json()).chat;
    assert.equal(savedChat.model, 'anthropic/claude-3.5-sonnet');
    assert.equal(savedChat.draft.status, 'draft');
    assert.equal(savedChat.automationId, firstAutomation.id);
    assert.deepEqual(savedChat.messages.map((message) => message.role), ['user', 'assistant']);
    assert.match(savedChat.messages[1].text, /workflow\.\n\nReview/);

    const otherChats = await fetch(`${base}/api/automation-chats`, { headers: headersFor('user-b') });
    assert.deepEqual((await otherChats.json()).chats, []);
    const otherGet = await fetch(`${base}/api/automation-chats/${chat.id}`, { headers: headersFor('user-b') });
    assert.equal(otherGet.status, 404);
    const otherUpdate = await fetch(`${base}/api/automation-chats/${chat.id}`, {
      method: 'PATCH', headers: headersFor('user-b'), body: JSON.stringify({ model: 'openai/gpt-4o-mini' }),
    });
    assert.equal(otherUpdate.status, 404);
    const invalidAutomationId = await fetch(`${base}/api/automation-chats/${chat.id}`, {
      method: 'PATCH', headers: headersFor('user-a'), body: JSON.stringify({ automationId: 'not-a-uuid' }),
    });
    assert.equal(invalidAutomationId.status, 400);

    const firstPageResponse = await fetch(`${base}/api/automation-runs?page=1&limit=1&status=failed`, { headers: headersFor('user-a') });
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.runs.length, 1);
    assert.equal(firstPage.hasMore, true);
    const secondPageResponse = await fetch(`${base}/api/automation-runs?page=2&limit=1&status=failed`, { headers: headersFor('user-a') });
    const secondPage = await secondPageResponse.json();
    assert.equal(secondPage.runs.length, 1);
    assert.notEqual(firstPage.runs[0].id, secondPage.runs[0].id);
    const otherHistory = await fetch(`${base}/api/automation-runs`, { headers: headersFor('user-b') });
    assert.equal((await otherHistory.json()).total, 0);
    const afterDateHistory = await fetch(`${base}/api/automation-runs?from=2099-01-01`, { headers: headersFor('user-a') });
    assert.equal((await afterDateHistory.json()).total, 0);

    const deleteLinkedAutomation = await fetch(`${base}/api/automations/${firstAutomation.id}`, {
      method: 'DELETE', headers: headersFor('user-a'),
    });
    assert.equal(deleteLinkedAutomation.status, 200);
    const unlinkedChat = await fetch(`${base}/api/automation-chats/${chat.id}`, { headers: headersFor('user-a') });
    assert.equal((await unlinkedChat.json()).chat.automationId, null);

    const deleteChat = await fetch(`${base}/api/automation-chats/${chat.id}`, { method: 'DELETE', headers: headersFor('user-a') });
    assert.deepEqual(await deleteChat.json(), { deleted: true });
    const missingChat = await fetch(`${base}/api/automation-chats/${chat.id}`, { headers: headersFor('user-a') });
    assert.equal(missingChat.status, 404);
    const automationsRemain = await fetch(`${base}/api/automations`, { headers: headersFor('user-a') });
    assert.equal((await automationsRemain.json()).automations.length, 1);
    const runsRemain = await fetch(`${base}/api/automation-runs`, { headers: headersFor('user-a') });
    assert.equal((await runsRemain.json()).total, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local mock mode completes the chat-to-run flow and scheduled runs without provider calls', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-automation-mock-'));
  const store = createLocalStore({ dataPath: dir });
  const api = createAutomations({
    store,
    config: { automationMockMode: true, nodeEnv: 'development', storageMode: 'local' },
    fetchImpl: async () => { throw new Error('Mock mode must not call external providers.'); },
  });
  try {
    const models = await api.getModels();
    assert.equal(models.mockMode, true);
    assert.ok(models.models.some((model) => model.id.startsWith('mock/openai')));
    assert.ok(models.models.some((model) => model.id.startsWith('mock/anthropic')));
    assert.equal((await api.listGmailConnections({ userId: 'user-a' })).length, 0);

    const draft = await api.draftFromChat('Every day, summarize my unread Gmail and call out urgent client messages.', 'mock/openai-gpt-4o-mini');
    assert.equal(draft.supported, true);
    assert.equal(draft.automation.triggerType, 'schedule');
    assert.equal(draft.automation.triggerConfig.everyMinutes, 1440);
    assert.equal(draft.mockMode, true);
    assert.equal((await api.draftFromChat('Send an automatic reply to every sender.')).supported, false);

    const revision = await api.reviseDraftFromChat(draft.automation, 'Make it weekly, only unread messages, and limit it to 5 emails.');
    assert.equal(revision.supported, true);
    assert.equal(revision.automation.triggerConfig.everyMinutes, 10080);
    assert.equal(revision.automation.gmailQuery, 'is:unread');
    assert.equal(revision.automation.maxMessages, 5);
    assert.equal(revision.automation.status, 'draft');
    assert.equal(revision.automation.id, null);
    const refused = await api.reviseDraftFromChat(revision.automation, 'Also send an automatic reply to every sender.');
    assert.equal(refused.supported, false);
    assert.equal(refused.automation, undefined);
    assert.equal(revision.automation.maxMessages, 5);

    const saved = await api.create('user-a', { ...draft.automation, triggerType: 'manual' });
    assert.equal((await api.run('user-a', saved.id)).status, 'needs_connection');
    await api.startGmailConnection({ userId: 'user-a' });
    assert.equal((await api.listGmailConnections({ userId: 'user-a' }))[0].alias, 'Demo Gmail (mock)');
    const run = await api.run('user-a', saved.id);
    assert.equal(run.status, 'completed');
    assert.match(run.summary, /Local demo result/);
    assert.match(run.summary, /no live Gmail account or AI provider was contacted/);
    assert.ok(run.activity.some((entry) => entry.state === 'mocked_provider'));

    const scheduled = await api.create('user-a', draft.automation);
    const due = store.getAutomation('user-a', scheduled.id);
    due.nextRunAt = new Date(Date.now() - 60_000).toISOString();
    store.saveAutomation('user-a', due);
    const workerStore = createLocalStore({ dataPath: dir });
    const workerApi = createAutomations({
      store: workerStore,
      config: { automationMockMode: true, nodeEnv: 'development', storageMode: 'local' },
      fetchImpl: async () => { throw new Error('Mock schedule must not call external providers.'); },
    });
    const schedulePass = await workerApi.runDueSchedules(5);
    assert.equal(schedulePass.claimed, 1);
    assert.equal(schedulePass.results[0].status, 'completed');
    assert.equal((await workerStore.listAutomationRuns('user-a', scheduled.id, 10)).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local mock mode is disabled for production or Supabase storage', async () => {
  for (const config of [
    { automationMockMode: true, nodeEnv: 'production', storageMode: 'local' },
    { automationMockMode: true, nodeEnv: 'development', storageMode: 'local', vercelEnv: 'production' },
    { automationMockMode: true, nodeEnv: 'development', storageMode: 'supabase' },
    { automationPreviewMockMode: true, nodeEnv: 'production', storageMode: 'local', vercelEnv: 'production' },
    { automationPreviewMockMode: true, nodeEnv: 'production', storageMode: 'supabase', vercelEnv: 'preview' },
  ]) {
    const api = createAutomations({ store: {}, config });
    assert.equal((await api.getModels()).mockMode, undefined);
    await assert.rejects(() => api.draftFromChat('Read Gmail every day'), /AI is not configured/);
    await assert.rejects(() => api.listGmailConnections({ userId: 'user-a' }), /not configured/);
  }
});

test('preview mock mode works on Vercel Preview even with production Node mode', async () => {
  const calls = [];
  const api = createAutomations({
    store: {},
    config: {
      automationPreviewMockMode: true,
      nodeEnv: 'production',
      storageMode: 'local',
      vercelEnv: 'preview',
    },
    fetchImpl: async (...args) => { calls.push(args); throw new Error('Preview mock must not call external providers.'); },
  });

  const models = await api.getModels();
  assert.equal(models.mockMode, true);
  assert.equal((await api.draftFromChat('Read my recent Gmail every day.')).mockMode, true);
  assert.deepEqual(calls, []);
});

test('local mock API clearly labels simulation and persists a successful run', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'icebreaker-automation-mock-api-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { automationMockMode: true, nodeEnv: 'development', storageMode: 'local' } });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'content-type': 'application/json', 'x-user-id': 'user-a' };
    const modelsResponse = await fetch(`${base}/api/automations/models`, { headers });
    assert.equal((await modelsResponse.json()).mockMode, true);

    const connectResponse = await fetch(`${base}/api/automations/gmail/connect`, { method: 'POST', headers, body: '{}' });
    assert.deepEqual(await connectResponse.json(), { mockMode: true, connected: true });
    const connectionState = await fetch(`${base}/api/automations/gmail/connections`, { headers });
    assert.equal((await connectionState.json()).connections[0].alias, 'Demo Gmail (mock)');

    const draftResponse = await fetch(`${base}/api/automations/draft`, {
      method: 'POST', headers, body: JSON.stringify({ message: 'Read recent Gmail and summarize anything urgent.' }),
    });
    const draft = (await draftResponse.json()).draft;
    assert.equal(draft.supported, true);
    const beforeRevision = await fetch(`${base}/api/automations`, { headers });
    assert.equal((await beforeRevision.json()).automations.length, 0);
    const reviseResponse = await fetch(`${base}/api/automations/revise`, {
      method: 'POST', headers, body: JSON.stringify({ draft: draft.automation, message: 'Make it weekly and only unread messages.' }),
    });
    assert.equal(reviseResponse.status, 200);
    const revision = (await reviseResponse.json()).revision;
    assert.equal(revision.supported, true);
    assert.equal(revision.automation.triggerConfig.everyMinutes, 10080);
    assert.equal(revision.automation.gmailQuery, 'is:unread');
    assert.equal(revision.automation.status, 'draft');
    const afterRevision = await fetch(`${base}/api/automations`, { headers });
    assert.equal((await afterRevision.json()).automations.length, 0, 'revising must never save the automation');
    const refusal = await fetch(`${base}/api/automations/revise`, {
      method: 'POST', headers, body: JSON.stringify({ draft: revision.automation, message: 'Send a reply to every unread sender.' }),
    });
    assert.equal((await refusal.json()).revision.supported, false);
    const createResponse = await fetch(`${base}/api/automations`, { method: 'POST', headers, body: JSON.stringify({ ...draft.automation, triggerType: 'manual' }) });
    const { automation } = await createResponse.json();
    const runResponse = await fetch(`${base}/api/automations/${automation.id}/run`, { method: 'POST', headers, body: '{}' });
    assert.equal(runResponse.status, 200);
    const run = (await runResponse.json()).run;
    assert.equal(run.status, 'completed');
    assert.match(run.summary, /Local demo result/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

function jsonResponse(value, ok = true, status = 200) {
  return { ok, status, json: async () => value };
}
