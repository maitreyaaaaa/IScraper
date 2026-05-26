const { describeLensCrop } = require('../services/lensSearch');
const {
  findSimilarVisualItems: findVisualSearchItems,
  publicVisualSearchAnalysis,
} = require('../services/visualSimilarity');

function registerPrivateSearchRoutes(app, deps) {
  const { config, http, store, workflows } = deps;
  const { asyncRoute, captureWorkflow, warnWorkflow } = http;
  const { requireCompletedProfile } = http.auth;
  const { searchRateLimit } = http.rateLimiters;
  const { queueSingleItemEnrichment } = workflows.library;
  const { createSearchEventId, runAiSearchAnswer, runLibraryChatAnswer, runSearch } = workflows.search;

  app.post('/api/enrichment/intent-batch', searchRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds.slice(0, 5) : [];
    const results = [];
    for (const itemId of itemIds) {
      try {
        results.push(await queueSingleItemEnrichment(req, itemId, { reason: 'search-intent' }));
      } catch (error) {
        results.push({ itemId, error: error.message });
      }
    }
    captureWorkflow(req, 'enrichment intent batch queued', {
      requestedCount: itemIds.length,
      queuedCount: results.filter((entry) => entry.queued).length,
      failedCount: results.filter((entry) => entry.error).length,
    });
    res.json({ results, processedCount: results.length });
  }));

  app.post('/api/search', searchRateLimit, asyncRoute(async (req, res) => {
    const rawQuery = String(req.body.query || '').trim();
    const query = rawQuery.slice(0, 240);
    const results = await runSearch({ userId: req.user.id, query, filters: req.body.filters || {} });
    let ai = null;
    if (req.body.includeAi && query && results.length) {
      try {
        ai = await runAiSearchAnswer({ req, userId: req.user.id, query, results });
      } catch (error) {
        if (error.statusCode === 429) throw error;
        console.warn(`AI search answer failed: ${error.message}`);
        ai = { error: 'AI answer is unavailable right now. Showing regular search results.' };
      }
    }
    const searchEventId = createSearchEventId();
    if (typeof store.recordSearchEvent === 'function') {
      await store.recordSearchEvent({
        id: searchEventId,
        userId: req.user.id,
        query: results.length === 0 ? query : '',
        queryLength: rawQuery.length,
        filters: req.body.filters || {},
        resultCount: results.length,
        includeAi: Boolean(req.body.includeAi),
        resultIds: results.map((item) => item.id),
      });
    }
    captureWorkflow(req, 'search completed', {
      searchEventId,
      resultCount: results.length,
      hasFilters: Boolean(Object.keys(req.body.filters || {}).length),
      includeAi: Boolean(req.body.includeAi),
      noResults: results.length === 0,
    });
    res.json({ results, ai, searchEventId });
  }));

  app.post('/api/library-chat', searchRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const rawQuestion = String(req.body.question || '').trim();
    const question = rawQuestion.slice(0, 240);
    const results = await runSearch({ userId: req.user.id, query: question, filters: { limit: 12 } });
    try {
      const answer = await runLibraryChatAnswer({
        req,
        userId: req.user.id,
        question,
        messages: req.body.messages || [],
        results,
      });
      captureWorkflow(req, 'library chat answered', {
        searchEventId: answer.searchEventId,
        resultCount: answer.results.length,
        citationCount: answer.ai?.citations?.length || 0,
      });
      return res.json(answer);
    } catch (error) {
      warnWorkflow(req, 'library chat failed', {
        statusCode: error.statusCode || 500,
        resultCount: results.length,
      });
      throw error;
    }
  }));

  app.post('/api/visual-search', searchRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (!config.credentialEncryptionKey || typeof store.getPreferredProviderCredential !== 'function') {
      return res.status(428).json({ error: 'Connect a media AI key before using Same Vibe Search.' });
    }
    const mediaCredential = await store.getPreferredProviderCredential(req.user.id, 'media', config.credentialEncryptionKey);
    const described = await describeLensCrop({ dataUrl: req.body?.imageDataUrl, credential: mediaCredential });
    const allItems = await store.getItems(req.user.id);
    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 24, 60));
    const results = findVisualSearchItems(allItems, described.analysis, { limit });
    const searchEventId = createSearchEventId();
    if (typeof store.recordSearchEvent === 'function') {
      await store.recordSearchEvent({
        id: searchEventId,
        userId: req.user.id,
        query: '',
        queryLength: 0,
        filters: { type: 'visual' },
        resultCount: results.length,
        includeAi: false,
        resultIds: results.map((item) => item.id),
      });
    }
    captureWorkflow(req, 'visual search completed', {
      searchEventId,
      resultCount: results.length,
      hasImageAnalysis: true,
    });
    res.json({
      results,
      searchEventId,
      visualSearch: publicVisualSearchAnalysis(described.analysis, described.query),
    });
  }));

  app.post('/api/search/feedback', searchRateLimit, asyncRoute(async (req, res) => {
    if (typeof store.recordSearchFeedback !== 'function') {
      return res.status(501).json({ error: 'Search feedback is not available for this store.' });
    }
    const searchEventId = String(req.body.searchEventId || '').trim();
    const itemId = String(req.body.itemId || '').trim();
    const rating = String(req.body.rating || '').trim();
    const reason = String(req.body.reason || '').trim();
    if (!searchEventId || !itemId || !['helpful', 'not_helpful'].includes(rating)) {
      return res.status(400).json({ error: 'Search feedback requires a search event, item, and valid rating.' });
    }
    const feedback = await store.recordSearchFeedback({
      userId: req.user.id,
      searchEventId,
      itemId,
      rating,
      reason,
    });
    captureWorkflow(req, 'search feedback recorded', {
      searchEventId,
      itemId,
      rating,
    });
    res.status(201).json({ feedback });
  }));
}

module.exports = {
  registerPrivateSearchRoutes,
};
