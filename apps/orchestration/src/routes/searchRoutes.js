const { isDeletionBlockingStatus, publicDeletionRequest } = require('../services/accountDeletion');
const { cleanLensText, describeLensCrop } = require('../services/lensSearch');

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
      if (!config.credentialEncryptionKey || typeof store.getPreferredProviderCredential !== 'function') {
        return res.status(428).json({ error: 'Connect a media AI key before using Lens image search.' });
      }
      const mediaCredential = await store.getPreferredProviderCredential(user.id, 'media', config.credentialEncryptionKey);
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
