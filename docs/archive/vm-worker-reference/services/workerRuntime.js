const { getConfig } = require('../config');
const { createLocalStore } = require('../stores/localStore');
const { createSupabaseStore } = require('../stores/supabaseStore');
const { processPendingStorageImports } = require('./storageImports');
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
  if (typeof store.listProcessableJobScopes !== 'function') {
    return [];
  }
  return store.listProcessableJobScopes({
    limit: config.workerScanLimit,
    perUserConcurrency: config.workerPerUserConcurrency,
  });
}

async function processIndexingScope({ store, config, userId, importId = null, maxJobs = null }) {
  return processImportJobs({
    store,
    userId,
    importId,
    videoDir: config.videoDir,
    shouldDownload: false,
    mediaAnalysisEnabled: false,
    geminiApiKey: config.geminiApiKey,
    openRouterApiKey: config.openRouterApiKey,
    openRouterModel: config.openRouterModel,
    openRouterMediaModel: config.openRouterMediaModel,
    openRouterEmbeddingModel: config.openRouterEmbeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    indexingConcurrency: config.workerBatchSize,
    credentialEncryptionKey: config.credentialEncryptionKey,
    leaseOwner: config.workerLeaseOwner,
    leaseMs: config.workerLeaseMs,
    perUserConcurrency: config.workerPerUserConcurrency,
    maxJobs,
  });
}

async function processStorageImportBatch({ store, config }) {
  return processPendingStorageImports({
    store,
    config,
    limit: config.storageImportBatchSize,
  });
}

module.exports = {
  createWorkerRuntime,
  processIndexingScope,
  processStorageImportBatch,
  scanIndexingScopes,
};
