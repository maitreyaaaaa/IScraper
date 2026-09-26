const { isDeletionBlockingStatus, publicDeletionRequest } = require('../services/accountDeletion');
const { cleanLensText, describeLensCrop, parseLensCrop } = require('../services/lensSearch');
const { assertMediaAnalysisBudget } = require('../services/rateBudgets');

function registerPublicSearchRoutes(app, deps) {
  const { config, http, store, workflows } = deps;
  const { asyncRoute, captureWorkflow } = http;
  const { getExtensionUser } = http.auth;
  const { searchRateLimit } = http.rateLimiters;
  const { publicLensResult, runSearch } = workflows.search;

  app.post('/api/lens/search', searchRateLimit, asyncRoute(async (req, res) => {
    const user = await getExtensionUser(req, store, 'lens:search');
    if (typeof store.getActiveDeletionRequest === 'function') {
      const deletion = await store.getActiveDeletionRequest(user.id);
      if (deletion && isDeletionBlockingStatus(deletion.status)) {
        return res.status(423).json({
          error: 'Account deletion is pending. Lens search is disabled for this account.',
          deletion: publicDeletionRequest(deletion),
        });
      }
    }
    const type = req.body?.type === 'image' ? 'image' : 'text';
    let query = cleanLensText(req.body?.query, type === 'image' ? 500 : 240);
    let imageAnalysis = null;

    if (type === 'text' && query.length < 2) {
      return res.status(400).json({ error: 'Select at least 2 characters to search your brain.' });
    }

    if (type === 'image') {
      parseLensCrop(req.body?.imageDataUrl);
      if (!config.openAiApiKey) {
        return res.status(428).json({ error: 'IScraper image AI is not configured yet.' });
      }
      await assertMediaAnalysisBudget(store, config, user.id, 'Image search limit reached. Please try again later.');
      const mediaCredential = {
        id: 'app-openai-lens-search',
        provider: 'openai',
        purpose: 'media',
        model: config.openAiMediaModel || config.openAiModel || 'gpt-4o',
        apiKey: config.openAiApiKey,
      };
      const described = await describeLensCrop({ dataUrl: req.body?.imageDataUrl, credential: mediaCredential });
      query = described.query;
      imageAnalysis = described.analysis;
    }

    const results = (await runSearch({
      userId: user.id,
      query,
      filters: req.body?.filters || {},
    })).slice(0, 8).map(publicLensResult);

    if (typeof store.recordLensSearchEvent === 'function') {
      await store.recordLensSearchEvent({ userId: user.id, queryType: type, resultCount: results.length });
    }
    captureWorkflow(req, 'lens search completed', {
      userId: user.id,
      queryType: type,
      resultCount: results.length,
      hasImageAnalysis: Boolean(imageAnalysis),
    });

    return res.json({
      query,
      type,
      results,
      imageAnalysis: imageAnalysis ? {
        title: imageAnalysis.title || '',
        ocrText: imageAnalysis.ocrText || '',
        visualDescription: imageAnalysis.visualDescription || '',
      } : null,
    });
  }));

}

module.exports = {
  registerPublicSearchRoutes,
};
