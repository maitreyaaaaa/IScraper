function registerAutomationRoutes(app, deps) {
  const { config, http, workflows } = deps;
  const { asyncRoute, captureWorkflow } = http;
  const automation = workflows.automations;
  const automationChats = workflows.automationChats;
  const { requireAccountNotDeleting, requireCompletedProfile } = http.auth;

  app.use('/api/automations', asyncRoute(async (req, _res, next) => {
    await requireAccountNotDeleting(req, deps.store);
    next();
  }));

  app.get('/api/automations/models', asyncRoute(async (_req, res) => {
    return res.json(await automation.getModels());
  }));

  app.get('/api/automations', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const triggerType = cleanQuery(req.query.triggerType);
    const status = cleanQuery(req.query.status);
    const sort = cleanQuery(req.query.sort);
    if (triggerType && !['manual', 'schedule'].includes(triggerType)) return res.status(400).json({ error: 'Unsupported automation trigger filter.' });
    if (status && !['active', 'paused'].includes(status)) return res.status(400).json({ error: 'Unsupported automation status filter.' });
    if (sort && !['updatedAt', 'nextRunAt'].includes(sort)) return res.status(400).json({ error: 'Unsupported automation sort.' });
    let automations = await automation.list(req.user.id);
    if (triggerType) automations = automations.filter((item) => item.triggerType === triggerType);
    if (status) automations = automations.filter((item) => item.status === status);
    if (sort === 'nextRunAt') automations.sort((a, b) => String(a.nextRunAt || '').localeCompare(String(b.nextRunAt || '')));
    return res.json({ automations });
  }));

  app.use('/api/automation-chats', asyncRoute(async (req, _res, next) => {
    await requireAccountNotDeleting(req, deps.store);
    next();
  }));

  app.get('/api/automation-chats', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    return res.json({ chats: await automationChats.list(req.user.id, parseLimit(req.query.limit)) });
  }));

  app.post('/api/automation-chats', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const chat = await automationChats.create(req.user.id, req.body || {});
    return res.status(201).json({ chat });
  }));

  app.get('/api/automation-chats/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const chat = await automationChats.get(req.user.id, req.params.id);
    if (!chat) return res.status(404).json({ error: 'Automation chat not found.' });
    return res.json({ chat });
  }));

  app.patch('/api/automation-chats/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const chat = await automationChats.update(req.user.id, req.params.id, req.body || {});
    if (!chat) return res.status(404).json({ error: 'Automation chat not found.' });
    return res.json({ chat });
  }));

  app.post('/api/automation-chats/:id/messages', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const message = await automationChats.appendMessage(req.user.id, req.params.id, req.body || {});
    if (!message) return res.status(404).json({ error: 'Automation chat not found.' });
    captureWorkflow(req, 'automation chat message saved', { chatId: req.params.id, role: message.role });
    return res.status(201).json({ message });
  }));

  app.delete('/api/automation-chats/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const deleted = await automationChats.delete(req.user.id, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Automation chat not found.' });
    return res.json({ deleted: true });
  }));

  app.get('/api/automation-runs', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const status = cleanQuery(req.query.status);
    if (status && !['running', 'completed', 'needs_connection', 'failed'].includes(status)) return res.status(400).json({ error: 'Unsupported run status filter.' });
    const automationId = cleanQuery(req.query.automationId);
    if (automationId && !isUuid(automationId)) return res.status(400).json({ error: 'Automation ID is invalid.' });
    const from = parseDateFilter(req.query.from, false);
    const to = parseDateFilter(req.query.to, true);
    if (from === false || to === false) return res.status(400).json({ error: 'Run date filters must be valid dates.' });
    const result = await automation.allRuns(req.user.id, {
      page: parsePage(req.query.page),
      limit: parseLimit(req.query.limit),
      status,
      automationId,
      from: from || '',
      to: to || '',
    });
    return res.json(result);
  }));

  app.post('/api/automations/draft', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const draft = await automation.draftFromChat(req.body?.message, req.body?.model);
    captureWorkflow(req, 'automation draft generated', { supported: draft.supported === true });
    return res.json({ draft });
  }));

  app.post('/api/automations/revise', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const revision = await automation.reviseDraftFromChat(req.body?.draft, req.body?.message, req.body?.model);
    captureWorkflow(req, 'automation draft revised', { supported: revision.supported === true });
    return res.json({ revision });
  }));

  app.post('/api/automations', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const saved = await automation.create(req.user.id, req.body || {});
    captureWorkflow(req, 'automation saved', { automationId: saved.id, triggerType: saved.triggerType });
    return res.status(201).json({ automation: saved });
  }));

  app.get('/api/automations/gmail/connections', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    return res.json({ connections: await automation.listGmailConnections({ userId: req.user.id }), mockMode: automation.isMockMode() });
  }));

  app.post('/api/automations/gmail/connect', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    if (automation.isMockMode()) {
      await automation.startGmailConnection({ userId: req.user.id });
      return res.json({ mockMode: true, connected: true });
    }
    const chatId = cleanQuery(req.body?.chatId);
    if (chatId && !await automationChats.get(req.user.id, chatId)) return res.status(404).json({ error: 'Automation chat not found.' });
    const state = automation.signConnectionState(req.user.id, chatId);
    const link = await automation.startGmailConnection({ userId: req.user.id });
    const secure = /^https:\/\//i.test(String(config.appUrl || ''));
    const cookie = [
      `icebreaker_gmail_connect=${state}`,
      'HttpOnly',
      'SameSite=Lax',
      `Path=/api/automations/gmail/callback`,
      'Max-Age=600',
      ...(secure ? ['Secure'] : []),
    ].join('; ');
    res.setHeader('Set-Cookie', cookie);
    return res.json({ redirectUrl: link.redirectUrl, expiresAt: link.expiresAt });
  }));

  app.get('/api/automations/:id/runs', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const runs = await automation.runs(req.user.id, req.params.id, parseLimit(req.query.limit));
    if (runs === null) return res.status(404).json({ error: 'Automation not found.' });
    return res.json({ runs });
  }));

  app.post('/api/automations/:id/run', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const run = await automation.run(req.user.id, req.params.id, 'manual');
    if (!run) return res.status(404).json({ error: 'Automation not found.' });
    captureWorkflow(req, 'gmail automation run finished', { automationId: req.params.id, runId: run.id, status: run.status });
    return res.status(run.status === 'completed' ? 200 : run.status === 'needs_connection' ? 409 : 502).json({ run });
  }));

  app.patch('/api/automations/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const updated = await automation.update(req.user.id, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Automation not found.' });
    return res.json({ automation: updated });
  }));

  app.delete('/api/automations/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, deps.store);
    const deleted = await automation.remove(req.user.id, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Automation not found.' });
    return res.json({ deleted: true });
  }));
}

function registerAutomationCallbackRoutes(app, deps) {
  const { workflows, config } = deps;
  const { asyncRoute } = deps.http;
  const automation = workflows.automations;

  app.get('/api/automations/gmail/callback', asyncRoute(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const userId = automation.verifyConnectionState(cookies.icebreaker_gmail_connect);
    const chatId = automation.connectionChatId(cookies.icebreaker_gmail_connect);
    const sessionUri = typeof req.query.session_uri === 'string' ? req.query.session_uri : '';
    const clearCookie = 'icebreaker_gmail_connect=; HttpOnly; SameSite=Lax; Path=/api/automations/gmail/callback; Max-Age=0';
    if (!userId || !sessionUri) {
      res.setHeader('Set-Cookie', clearCookie);
      return res.redirect(automationReturnUrl(config.appUrl, chatId, 'failed'));
    }
    try {
      await automation.completeGmailConnection({ userId, sessionUri });
      res.setHeader('Set-Cookie', clearCookie);
      return res.redirect(automationReturnUrl(config.appUrl, chatId, 'connected'));
    } catch {
      res.setHeader('Set-Cookie', clearCookie);
      return res.redirect(automationReturnUrl(config.appUrl, chatId, 'failed'));
    }
  }));
}

function parseCookies(header) {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return [name, value];
  }).filter(([name]) => name));
}

function parseLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(1, Math.min(50, number)) : 25;
}

function parsePage(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(1, Math.min(10000, number)) : 1;
}

function cleanQuery(value) {
  return typeof value === 'string' ? value.trim().slice(0, 160) : '';
}

function parseDateFilter(value, endOfDay) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const input = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? new Date(`${input}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(input);
  return Number.isNaN(date.getTime()) ? false : date.toISOString();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function automationReturnUrl(appUrl, chatId, connectionStatus) {
  const params = new URLSearchParams({ tab: 'automations', view: 'new-chat', gmailConnection: connectionStatus });
  if (isUuid(chatId)) params.set('chatId', chatId);
  return `${safeAppUrl(appUrl)}/app?${params.toString()}`;
}

function safeAppUrl(value) {
  try {
    const url = new URL(value || 'http://localhost:5173');
    return url.origin;
  } catch {
    return 'http://localhost:5173';
  }
}

module.exports = {
  registerAutomationCallbackRoutes,
  registerAutomationRoutes,
  parseCookies,
  parseDateFilter,
  parsePage,
};
