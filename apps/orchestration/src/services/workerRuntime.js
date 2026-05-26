const { getConfig } = require('../config');
const { createObservability } = require('./observability');
const { createLocalStore } = require('../stores/localStore');
const { createSupabaseStore } = require('../stores/supabaseStore');
const {
  createWorkerRuntime: createRuntime,
  getWorkerStatus,
  normalizeWorkerConfig,
  processWorkerScopes,
  runWorkerLoop,
  runWorkerPass,
  scanWorkerScopes,
} = require('../runtime/workerRuntime');

function createWorkerRuntime(config = getConfig()) {
  const store = config.storageMode === 'supabase'
    ? createSupabaseStore({
        url: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      })
    : createLocalStore({ dataPath: config.dataPath });
  return createRuntime({
    store,
    config,
    observability: createObservability(config),
  });
}

async function processIndexingScope({ store, config, userId, importId = null, maxJobs = null, download = false, shouldDownload = false }) {
  const runtime = createRuntime({
    store,
    config,
    observability: createObservability({ ...config, posthogEnabled: false }),
  });
  const result = await processWorkerScopes({
    runtime,
    scopes: [{ userId, importId }],
    maxJobs,
    download: download || shouldDownload,
  });
  return result.results[0]?.processed || [];
}

async function scanIndexingScopes({ store, config }) {
  const runtime = createRuntime({
    store,
    config,
    observability: createObservability({ ...config, posthogEnabled: false }),
  });
  return scanWorkerScopes({ runtime });
}

module.exports = {
  createWorkerRuntime,
  getWorkerStatus,
  normalizeWorkerConfig,
  processIndexingScope,
  processWorkerScopes,
  runWorkerLoop,
  runWorkerPass,
  scanIndexingScopes,
  scanWorkerScopes,
};
