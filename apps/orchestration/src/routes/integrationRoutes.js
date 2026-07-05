const { isDeletionBlockingStatus, publicDeletionRequest } = require('../services/accountDeletion');
const {
  buildAgentQueryResponse,
  handleMcpRequest,
  publicAgentItem,
} = require('../services/agentAccess');
const {
  buildNoteItem,
  noteInputFromBody,
} = require('../services/notes');
const { normalizeSavedUrl } = require('../services/linkSaver');
const {
  assertTelegramWebhookSecret,
  parseTelegramCommand,
  parseTelegramUpdate,
  sendTelegramReply,
  telegramReply,
  tokenHashFromConnectText,
} = require('../services/telegramCapture');
const { traceForRequest } = require('../services/observability');

function registerPublicIntegrationRoutes(app, deps) {
  const { config, http, store, workflows } = deps;
  const { asyncRoute, captureWorkflow, cleanText, warnWorkflow } = http;
  const { getAgentUser, getExtensionUser, requireCompletedProfile } = http.auth;
  const { importRateLimit, searchRateLimit } = http.rateLimiters;
  const { noteUpload } = http.uploaders;
  const { parseManualLinkPayload, saveLinkCapture } = workflows.imports;
  const { runSearch, createSearchEventId } = workflows.search;
  const { queueIndexingWork } = workflows.worker;
  const { refreshSmartCollectionsForUser } = workflows.library;
  const { persistNoteImages, removeNoteAssetObjects } = workflows.notes;
  const { analyzeExtensionScreenshot } = workflows.screenshots;

  function publicExtensionLibraryItem(item = {}) {
    const analysis = item.analysis || {};
    const firstLine = String(item.caption || '').split('\n').find(Boolean) || '';
    return {
      id: item.id,
      url: item.url || '',
      title: item.sourceTitle || analysis.title || firstLine || 'Saved item',
      description: item.sourceDescription || analysis.summary || firstLine || '',
      platform: item.platform || item.ownerName || 'Web',
      collection: (item.collections || [])[0] || '',
      collections: item.collections || [],
      thumbnailUrl: item.thumbnailUrl || '',
      status: item.status || '',
      savedAt: item.savedAt || item.createdAt || '',
      updatedAt: item.updatedAt || '',
      matchReason: item.searchMatch?.reason || item.searchMatch?.matchedField || '',
      tags: analysis.tags || item.hashtags || [],
    };
  }

  function normalizedComparableUrl(value) {
    try {
      return normalizeSavedUrl(value);
    } catch {
      return '';
    }
  }

  async function getExtensionRequestUser(req, scope) {
    const user = await getExtensionUser(req, store, scope);
    req.user = user;
    if (typeof store.getActiveDeletionRequest === 'function') {
      const deletion = await store.getActiveDeletionRequest(user.id);
      if (deletion && isDeletionBlockingStatus(deletion.status)) {
        const error = new Error('Account deletion is pending. Extension saves are disabled for this account.');
        error.statusCode = 423;
        error.deletion = publicDeletionRequest(deletion);
        throw error;
      }
    }
    await requireCompletedProfile(req, store);
    return user;
  }

  async function getAgentRequestUser(req, scope = 'agent:access') {
    const user = await getAgentUser(req, store, scope);
    req.user = user;
    if (typeof store.getActiveDeletionRequest === 'function') {
      const deletion = await store.getActiveDeletionRequest(user.id);
      if (deletion && isDeletionBlockingStatus(deletion.status)) {
        const error = new Error('Account deletion is pending. Agent access is disabled for this account.');
        error.statusCode = 423;
        error.deletion = publicDeletionRequest(deletion);
        throw error;
      }
    }
    await requireCompletedProfile(req, store);
    return user;
  }

  async function runAgentLibraryQuery({ req, userId, query, limit = 8 }) {
    const cleanQuery = cleanText(query || '', 240);
    if (!cleanQuery) {
      const error = new Error('Ask a question before searching your IScraper library.');
      error.statusCode = 400;
      throw error;
    }
    const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 20));
    const results = (await runSearch({ userId, query: cleanQuery, filters: { limit: safeLimit } })).slice(0, safeLimit);
    const searchEventId = createSearchEventId();
    if (typeof store.recordSearchEvent === 'function') {
      await store.recordSearchEvent({
        id: searchEventId,
        userId,
        query: results.length === 0 ? cleanQuery : '',
        queryLength: cleanQuery.length,
        filters: { source: 'agent-access', limit: safeLimit },
        resultCount: results.length,
        includeAi: false,
        resultIds: results.map((item) => item.id),
      });
    }
    captureWorkflow(req, 'agent library queried', {
      searchEventId,
      resultCount: results.length,
      client: cleanText(req.header('x-agent-client') || '', 80),
    });
    return { searchEventId, results, response: buildAgentQueryResponse({ query: cleanQuery, results }) };
  }

  app.post('/api/extension/saves/link', importRateLimit, asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'saves:create');
    const trace = traceForRequest(req);
    const parsed = parseManualLinkPayload(req.body || {});
    const importEntry = await store.createImport({
      userId: user.id,
      source: 'browser-extension',
      mode: 'export',
      fileNames: [parsed.items[0].url],
      requestId: trace.requestId,
      correlationId: trace.correlationId,
    });
    const items = await store.upsertImportData({ userId: user.id, importId: importEntry.id, parsed, initialStatus: 'queued' });
    const jobs = await store.createJobs({ userId: user.id, importId: importEntry.id, items, ...trace, sourceAction: 'extension-link' });

    let indexing = null;
    if (jobs.length) {
      indexing = await queueIndexingWork({
        reason: 'extension-link',
        userId: user.id,
        importId: importEntry.id,
        shouldDownload: false,
        requestId: trace.requestId,
        correlationId: trace.correlationId,
      });
    }
    captureWorkflow(req, 'extension link saved', {
      userId: user.id,
      importId: importEntry.id,
      newItemCount: items.length,
    });

    await refreshSmartCollectionsForUser(user.id);
    return res.status(201).json({
      import: importEntry,
      item: items[0] || parsed.items[0],
      newItemCount: items.length,
      skippedDuplicateCount: items.length ? 0 : 1,
      queuedJobCount: jobs.length,
      indexing,
      requestId: trace.requestId,
      correlationId: trace.correlationId,
    });
  }));

  app.delete('/api/extension/saves/:id', asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'saves:delete');
    if (typeof store.deleteSavedItem !== 'function') return res.status(501).json({ error: 'URL undo is not available.' });
    const existing = await store.getItem(user.id, req.params.id);
    if (!existing?.importId || typeof store.getImport !== 'function') {
      return res.status(404).json({ error: 'Extension URL capture not found.' });
    }
    const importEntry = await store.getImport(user.id, existing.importId);
    if (!importEntry || importEntry.source !== 'browser-extension') {
      return res.status(404).json({ error: 'Extension URL capture not found.' });
    }
    const deleted = await store.deleteSavedItem(user.id, existing.id);
    captureWorkflow(req, 'extension link undone', {
      userId: user.id,
      itemId: existing.id,
      importId: existing.importId,
    });
    await refreshSmartCollectionsForUser(user.id);
    return res.json({ deleted: Boolean(deleted), itemId: existing.id });
  }));

  app.post('/api/extension/captures/screenshot', noteUpload.single('image'), asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'captures:create');
    if (!req.file) return res.status(400).json({ error: 'Add a screenshot image before saving.' });
    if (typeof store.createNoteItem !== 'function' || typeof store.addItemAsset !== 'function') {
      return res.status(501).json({ error: 'Screenshot captures are not available.' });
    }

    const sourceUrl = cleanText(req.body?.sourceUrl || '', 1000);
    const sourceTitle = cleanText(req.body?.sourceTitle || '', 160);
    const captureTitle = cleanText(req.body?.title || sourceTitle || 'Screen capture', 160);
    const collection = cleanText(req.body?.collection || 'Browser captures', 80) || 'Browser captures';
    const shouldAnalyze = String(req.body?.autoAnalyze ?? 'true') !== 'false';
    const noteBody = [
      'Saved from the IScraper Chrome extension.',
      sourceTitle ? `Page: ${sourceTitle}` : '',
      sourceUrl ? `URL: ${sourceUrl}` : '',
    ].filter(Boolean).join('\n');
    const input = noteInputFromBody({
      title: captureTitle,
      body: noteBody,
      links: sourceUrl ? [sourceUrl] : [],
    });

    let item = await store.createNoteItem(user.id, buildNoteItem({ userId: user.id, input }));
    try {
      await persistNoteImages({ userId: user.id, itemId: item.id, files: [req.file] });
      item = await store.updateSavedItem(user.id, item.id, {
        collections: [collection],
        platform: 'IScraper Extension',
        platformKey: 'iscraper-extension-capture',
        sourceAuthor: 'Chrome extension',
        sourceTitle: sourceTitle || captureTitle,
        sourceDescription: 'Cropped screenshot captured from the browser.',
        status: 'done',
      }) || await store.getItem(user.id, item.id);
      item = await store.getItem(user.id, item.id);
      try {
        if (!shouldAnalyze) {
          captureWorkflow(req, 'extension screenshot analysis skipped', {
            userId: user.id,
            itemId: item.id,
            reason: 'extension_setting',
          });
        } else {
          item = await analyzeExtensionScreenshot({ userId: user.id, item, file: req.file }) || item;
        }
      } catch (analysisError) {
        warnWorkflow(req, 'extension screenshot analysis failed', {
          userId: user.id,
          itemId: item.id,
          error: analysisError.message,
        });
      }
    } catch (error) {
      if (item?.id && typeof store.deleteSavedItem === 'function') {
        await store.deleteSavedItem(user.id, item.id).catch(() => {});
      }
      throw error;
    }

    captureWorkflow(req, 'extension screenshot saved', {
      userId: user.id,
      itemId: item.id,
      imageCount: item.assets?.length || 0,
      hasImageAnalysis: Boolean(item.analysis),
    });
    await refreshSmartCollectionsForUser(user.id);
    return res.status(201).json({ item });
  }));

  app.post('/api/extension/captures/selection', asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'captures:create');
    if (typeof store.createNoteItem !== 'function' || typeof store.updateSavedItem !== 'function') {
      return res.status(501).json({ error: 'Selection captures are not available.' });
    }

    const kind = ['text', 'image', 'video'].includes(req.body?.kind) ? req.body.kind : 'text';
    const sourceUrl = cleanText(req.body?.sourceUrl || '', 1000);
    const sourceTitle = cleanText(req.body?.sourceTitle || '', 160);
    const collection = cleanText(req.body?.collection || 'Browser captures', 80) || 'Browser captures';
    const note = cleanText(req.body?.note || '', 500);
    const text = cleanText(req.body?.text || '', 1800);
    const mediaUrl = cleanText(req.body?.mediaUrl || '', 1000);
    const mediaAlt = cleanText(req.body?.mediaAlt || '', 300);

    if (kind === 'text' && !text) return res.status(400).json({ error: 'Select text before saving.' });
    if ((kind === 'image' || kind === 'video') && !mediaUrl) return res.status(400).json({ error: 'Choose media before saving.' });

    const title = kind === 'text'
      ? `Saved text - ${sourceTitle || 'browser page'}`
      : `Saved ${kind} - ${sourceTitle || 'browser page'}`;
    const body = [
      kind === 'text' ? `Quote:\n${text}` : `${kind === 'image' ? 'Image' : 'Video'} reference: ${mediaUrl}`,
      mediaAlt ? `Description: ${mediaAlt}` : '',
      note ? `Note: ${note}` : '',
      sourceTitle ? `Page: ${sourceTitle}` : '',
      sourceUrl ? `URL: ${sourceUrl}` : '',
    ].filter(Boolean).join('\n\n');
    const input = noteInputFromBody({
      title,
      body,
      links: [sourceUrl, mediaUrl].filter(Boolean),
    });
    let item = await store.createNoteItem(user.id, buildNoteItem({ userId: user.id, input }));
    item = await store.updateSavedItem(user.id, item.id, {
      collections: [collection],
      platform: 'IScraper Extension',
      platformKey: 'iscraper-extension-selection',
      sourceAuthor: 'Chrome extension',
      sourceTitle: sourceTitle || title,
      sourceDescription: kind === 'text' ? text : mediaAlt || mediaUrl,
      status: 'done',
      error: null,
    }) || await store.getItem(user.id, item.id);

    captureWorkflow(req, 'extension selection saved', {
      userId: user.id,
      itemId: item.id,
      kind,
      hasNote: Boolean(note),
    });
    await refreshSmartCollectionsForUser(user.id);
    return res.status(201).json({ item });
  }));

  app.delete('/api/extension/captures/:id', asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'captures:delete');
    if (typeof store.deleteSavedItem !== 'function') return res.status(501).json({ error: 'Screenshot undo is not available.' });
    const existing = await store.getItem(user.id, req.params.id);
    if (!existing || !['iscraper-extension-capture', 'iscraper-extension-selection'].includes(existing.platformKey)) {
      return res.status(404).json({ error: 'Extension capture not found.' });
    }
    const assets = typeof store.listItemAssets === 'function' ? await store.listItemAssets(user.id, existing.id) : existing.assets || [];
    const deleted = await store.deleteSavedItem(user.id, existing.id);
    await removeNoteAssetObjects({ assets });
    captureWorkflow(req, 'extension screenshot undone', {
      userId: user.id,
      itemId: existing.id,
      imageCount: assets.length,
    });
    await refreshSmartCollectionsForUser(user.id);
    return res.json({ deleted: Boolean(deleted), itemId: existing.id });
  }));

  app.get('/api/extension/library/recent', asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'lens:search');
    const limit = Math.max(1, Math.min(Number(req.query?.limit) || 8, 20));
    const page = typeof store.listItemsPage === 'function'
      ? await store.listItemsPage(user.id, { limit, sort: 'updated', state: 'all' })
      : { items: (await store.getItems(user.id)).slice(0, limit) };
    return res.json({ items: (page.items || []).map(publicExtensionLibraryItem) });
  }));

  app.get('/api/extension/library/search', searchRateLimit, asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'lens:search');
    const query = cleanText(req.query?.q || '', 160);
    if (!query) return res.json({ items: [] });
    const limit = Math.max(1, Math.min(Number(req.query?.limit) || 8, 20));
    const results = await runSearch({
      req,
      userId: user.id,
      query,
      filters: { limit, source: 'extension-side-panel' },
    });
    return res.json({ items: results.slice(0, limit).map(publicExtensionLibraryItem) });
  }));

  app.get('/api/extension/library/status', asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'lens:search');
    const targetUrl = normalizedComparableUrl(req.query?.url || '');
    if (!targetUrl) return res.json({ saved: false, item: null });
    const items = await store.getItems(user.id);
    const item = items.find((entry) => normalizedComparableUrl(entry.url) === targetUrl);
    return res.json({ saved: Boolean(item), item: item ? publicExtensionLibraryItem(item) : null });
  }));

  app.post('/api/agent-access/query', searchRateLimit, asyncRoute(async (req, res) => {
    const user = await getAgentRequestUser(req, 'library:search');
    const { searchEventId, response } = await runAgentLibraryQuery({
      req,
      userId: user.id,
      query: req.body?.question || req.body?.query,
      limit: req.body?.limit,
    });
    return res.json({ ...response, searchEventId });
  }));

  app.get('/api/agent-access/items/:id', searchRateLimit, asyncRoute(async (req, res) => {
    const user = await getAgentRequestUser(req, 'library:read');
    const item = await store.getItem(user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Saved item not found.' });
    captureWorkflow(req, 'agent item read', {
      itemId: item.id,
      client: cleanText(req.header('x-agent-client') || '', 80),
    });
    return res.json({ item: publicAgentItem(item) });
  }));

  app.post('/api/mcp', searchRateLimit, asyncRoute(async (req, res) => {
    const user = await getAgentRequestUser(req, 'library:search');
    const search = ({ userId, query, filters }) => runSearch({ userId, query, filters });
    const response = Array.isArray(req.body)
      ? await Promise.all(req.body.map((entry) => handleMcpRequest({ request: entry, userId: user.id, store, search })))
      : await handleMcpRequest({ request: req.body, userId: user.id, store, search });
    if (response === null) return res.status(202).json({});
    captureWorkflow(req, 'mcp request handled', {
      client: cleanText(req.header('x-agent-client') || 'mcp', 80),
      batched: Array.isArray(req.body),
    });
    return res.json(Array.isArray(response) ? response.filter(Boolean) : response);
  }));

  app.post('/api/telegram/webhook', asyncRoute(async (req, res) => {
    assertTelegramWebhookSecret(req, config);
    if (
      typeof store.upsertCaptureConnection !== 'function'
      || typeof store.getCaptureConnection !== 'function'
      || typeof store.markCaptureConnectionUsed !== 'function'
      || typeof store.revokeCaptureConnection !== 'function'
      || typeof store.getUserForExtensionToken !== 'function'
    ) {
      return res.status(501).json({ error: 'Telegram capture is not available.' });
    }

    const update = parseTelegramUpdate(req.body || {});
    if (!update) return res.json(telegramReply('Send a link to save it in IScraper.'));

    const sendAndReturn = async (reply, status = 200) => {
      try {
        await sendTelegramReply(config, update.chatId, reply.text);
      } catch (error) {
        warnWorkflow(req, 'telegram reply failed', { chatId: update.chatId, error: error.message });
      }
      return res.status(status).json(reply);
    };

    const command = parseTelegramCommand(update.text);
    if (command?.command === 'start' || command?.command === 'connect') {
      const tokenHash = tokenHashFromConnectText(update.text);
      if (!tokenHash) {
        return sendAndReturn(telegramReply('Open IScraper Settings, create a Telegram bot link code, then send /connect followed by that code.'));
      }
      const user = await store.getUserForExtensionToken(tokenHash, 'saves:create');
      if (!user) return sendAndReturn(telegramReply('That IScraper link code is invalid, expired, or revoked.'), 401);
      req.user = user;
      await requireCompletedProfile(req, store);
      await store.upsertCaptureConnection(user.id, {
        provider: 'telegram',
        externalId: update.chatId,
        tokenHash,
        username: update.username,
        displayName: update.displayName,
      });
      captureWorkflow(req, 'telegram chat connected', {
        userId: user.id,
        chatId: update.chatId,
      });
      return sendAndReturn(telegramReply('Connected. Send or forward a link here and I will save it to IScraper.'));
    }

    if (command?.command === 'disconnect') {
      const disconnected = await store.revokeCaptureConnection('telegram', update.chatId);
      captureWorkflow(req, 'telegram chat disconnected', { chatId: update.chatId, disconnected });
      return sendAndReturn(telegramReply(disconnected ? 'Disconnected from IScraper.' : 'This chat was not connected yet.'));
    }

    const connection = await store.getCaptureConnection('telegram', update.chatId);
    if (!connection) {
      return sendAndReturn(telegramReply('Connect this chat first. Open IScraper Settings, create a Telegram bot link code, then send /connect followed by that code.'));
    }
    const user = await store.getUserForExtensionToken(connection.tokenHash, 'saves:create');
    if (!user) return sendAndReturn(telegramReply('Your IScraper bot link was revoked or expired. Create a new Telegram bot link code in Settings and connect again.'), 401);
    req.user = user;
    await requireCompletedProfile(req, store);

    const url = update.links[0];
    if (!url) return sendAndReturn(telegramReply('Send or forward a message with one link and I will save it.'));
    const note = cleanText(update.text.replace(url, '').trim(), 500);
    const result = await saveLinkCapture({
      req,
      userId: user.id,
      source: 'telegram-bot',
      reason: 'telegram-bot',
      payload: {
        url,
        title: note ? note.split('\n')[0] : '',
        note: [
          'Saved via Telegram.',
          note,
        ].filter(Boolean).join(' '),
        collection: 'Telegram saves',
      },
    });
    await store.markCaptureConnectionUsed(connection.id);
    captureWorkflow(req, 'telegram link saved', {
      userId: user.id,
      itemId: result.item?.id,
      duplicate: !result.newItemCount,
    });
    return sendAndReturn(telegramReply(result.newItemCount ? 'Saved to IScraper.' : 'Already saved in IScraper.', {
      item: result.item,
      duplicate: !result.newItemCount,
    }), result.newItemCount ? 201 : 200);
  }));
}

module.exports = {
  registerPublicIntegrationRoutes,
};
