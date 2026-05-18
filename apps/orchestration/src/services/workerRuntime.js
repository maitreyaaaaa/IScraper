const { getConfig } = require('../config');
const { createLocalStore } = require('../stores/localStore');
const { createSupabaseStore } = require('../stores/supabaseStore');
const { processImportJobs } = require('./worker');

function createWorkerRuntime(config = getConfig()) {
  const store = config.storageMode === 'supabase'
    ? createSupabaseStore({
        url: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      })
    : createLocalStore({ dataPath: config.dataPath });
  return { config, store };
}

async function scanIndexingScopes({ store, config }) {
  if (typeof store.getProcessableJobScopes !== 'function') return [];
  return store.getProcessableJobScopes({
    limit: config.workerScanLimit || 20,
    perUserConcurrency: config.workerPerUserConcurrency || 1,
  });
}

async function processIndexingScope({ store, config, userId, importId = null, maxJobs = null }) {
  return processImportJobs({
    store,
    userId,
    importId,
    videoDir: config.videoDir,
    shouldDownload: false,
    geminiApiKey: config.geminiApiKey,
    openRouterApiKey: config.openRouterApiKey,
    openRouterModel: config.openRouterModel,
    openRouterMediaModel: config.openRouterMediaModel,
    openRouterEmbeddingModel: config.openRouterEmbeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    indexingConcurrency: config.indexingConcurrency,
    credentialEncryptionKey: config.credentialEncryptionKey,
    maxJobs: maxJobs || config.workerBatchSize || 5,
    leaseOwner: config.workerLeaseOwner,
    leaseMs: config.workerLeaseMs,
    perUserConcurrency: config.workerPerUserConcurrency || 1,
  });
}

module.exports = {
  createWorkerRuntime,
  processIndexingScope,
  scanIndexingScopes,
};
