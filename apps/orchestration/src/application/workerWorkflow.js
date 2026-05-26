const { processImportJobs } = require('../services/worker');

function createWorkerWorkflow({ store, config, http }) {
  const { asyncRoute } = http;
  const { assertWorker } = http.auth;

  function runProcessImportJobs({ userId, importId, shouldDownload = false, maxJobs = null }) {
    return processImportJobs({
      store,
      userId,
      importId,
      videoDir: config.videoDir,
      shouldDownload,
      geminiApiKey: config.geminiApiKey,
      openRouterApiKey: config.openRouterApiKey,
      openRouterModel: config.openRouterModel,
      openRouterMediaModel: config.openRouterMediaModel,
      openRouterEmbeddingModel: config.openRouterEmbeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      indexingConcurrency: config.indexingConcurrency,
      credentialEncryptionKey: config.credentialEncryptionKey,
      maxJobs: maxJobs || config.workerBatchSize || 2,
      leaseOwner: config.workerLeaseOwner,
      leaseMs: config.workerLeaseMs,
      perUserConcurrency: config.workerPerUserConcurrency || 1,
      maxAttempts: config.workerMaxAttempts || 3,
      retryBackoffMs: config.workerRetryBackoffMs,
      maxRetryBackoffMs: config.workerMaxRetryBackoffMs,
    });
  }

  function startProcessing({ userId, importId, shouldDownload = false, maxJobs = null }) {
    runProcessImportJobs({ userId, importId, shouldDownload, maxJobs: maxJobs || config.workerBatchSize || 2 }).catch((error) => {
      console.error('Background processing failed:', error);
    });
  }

  async function queueIndexingWork({ reason, userId, importId = null, shouldDownload = false, forceInline = false }) {
    if (forceInline || config.inlineIndexingEnabled === true) {
      startProcessing({ userId, importId, shouldDownload });
      return { mode: 'inline', triggered: false };
    }
    return { mode: 'vm-worker', queued: true, reason, userId, importId };
  }

  const workerProcessHandler = asyncRoute(async (req, res) => {
    assertWorker(req, config);
    if (typeof store.getProcessableJobScopes !== 'function') return res.status(501).json({ error: 'Worker job discovery is not available.' });

    const workerBatchCap = Math.max(1, Math.min(Number(config.workerBatchSize) || 2, 5));
    const oneJobRoute = req.path === '/api/worker/process-one';
    const requestedMaxJobs = oneJobRoute ? 1 : Number(req.body?.maxJobs || req.query?.maxJobs) || workerBatchCap;
    const maxJobs = Math.max(1, Math.min(requestedMaxJobs, workerBatchCap));
    const downloadValue = req.body?.download ?? req.query?.download;
    const scopes = await store.getProcessableJobScopes({
      limit: maxJobs,
      perUserConcurrency: config.workerPerUserConcurrency || 1,
      maxAttempts: config.workerMaxAttempts || 3,
    });
    const processed = [];

    for (const scope of scopes) {
      if (processed.length >= maxJobs) break;
      const batch = await runProcessImportJobs({
        userId: scope.userId,
        importId: scope.importId,
        shouldDownload: downloadValue === true || downloadValue === 'true',
        maxJobs: Math.max(1, maxJobs - processed.length),
      });
      processed.push(...batch);
    }

    return res.json({
      processedCount: processed.length,
      scopeCount: scopes.length,
    });
  });

  return {
    queueIndexingWork,
    runProcessImportJobs,
    startProcessing,
    workerProcessHandler,
  };
}

module.exports = {
  createWorkerWorkflow,
};
