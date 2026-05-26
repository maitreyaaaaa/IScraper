const { processImportJobs } = require('../services/worker');

function createWorkerRuntime({ store, config = {}, observability = null }) {
  return {
    store,
    config,
    observability: observability || noopObservability(),
    worker: normalizeWorkerConfig(config),
  };
}

function normalizeWorkerConfig(config = {}) {
  return {
    batchSize: clampNumber(config.workerBatchSize, 5, 1, 100),
    scanLimit: clampNumber(config.workerScanLimit, 20, 1, 100),
    globalConcurrency: clampNumber(config.workerGlobalConcurrency || config.indexingConcurrency, 1, 1, 10),
    perUserConcurrency: clampNumber(config.workerPerUserConcurrency, 1, 1, 10),
    maxAttempts: clampNumber(config.workerMaxAttempts, 3, 1, 20),
    leaseMs: clampNumber(config.workerLeaseMs, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
    leaseOwner: config.workerLeaseOwner || 'worker-local',
    retryBackoffMs: clampNumber(config.workerRetryBackoffMs, 60 * 1000, 1000, 24 * 60 * 60 * 1000),
    maxRetryBackoffMs: clampNumber(config.workerMaxRetryBackoffMs, 30 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
    idleMs: clampNumber(config.workerIdleMs, 5000, 1000, 60 * 60 * 1000),
    inlineIndexingEnabled: config.inlineIndexingEnabled === true,
    runOnce: config.workerRunOnce === true,
  };
}

async function scanWorkerScopes({ runtime, limit = null } = {}) {
  const { store, worker } = runtime;
  if (typeof store.getProcessableJobScopes !== 'function') return [];
  return store.getProcessableJobScopes({
    limit: limit || worker.scanLimit,
    perUserConcurrency: worker.perUserConcurrency,
    maxAttempts: worker.maxAttempts,
  });
}

async function processWorkerScopes({
  runtime,
  scopes,
  maxJobs = null,
  download = false,
  totalJobCap = null,
} = {}) {
  const { observability, worker } = runtime;
  const concurrency = totalJobCap ? 1 : worker.globalConcurrency;
  const perScopeMaxJobs = maxJobs || worker.batchSize;
  const results = [];
  const processed = [];
  let reservedJobCount = 0;

  for (let index = 0; index < scopes.length; index += concurrency) {
    if (totalJobCap && reservedJobCount >= totalJobCap) break;
    const remainingCap = totalJobCap ? Math.max(0, totalJobCap - reservedJobCount) : perScopeMaxJobs;
    const scopeMaxJobs = Math.min(perScopeMaxJobs, remainingCap || perScopeMaxJobs);
    reservedJobCount += totalJobCap ? scopeMaxJobs : 0;
    const slice = scopes.slice(index, index + concurrency);
    const settled = await Promise.all(slice.map(async (scope) => {
      try {
        const batch = await processIndexingScope({
          runtime,
          userId: scope.userId,
          importId: scope.importId,
          maxJobs: scopeMaxJobs,
          download,
        });
        return { scope, processed: batch, error: null };
      } catch (error) {
        observability.warn('worker scope failed', {
          userId: scope.userId,
          importId: scope.importId,
          errorName: error?.name || 'Error',
          errorMessage: error?.message || 'Worker scope failed.',
        });
        return { scope, processed: [], error };
      }
    }));
    for (const result of settled) {
      results.push(result);
      processed.push(...result.processed);
    }
  }

  return {
    scopeCount: scopes.length,
    processedCount: processed.length,
    failedScopeCount: results.filter((result) => result.error).length,
    results,
  };
}

async function runWorkerPass({
  runtime,
  maxJobs = null,
  download = false,
  scopeLimit = null,
  totalJobCap = null,
} = {}) {
  const { observability, worker } = runtime;
  const effectiveMaxJobs = Math.max(1, Number(maxJobs) || worker.batchSize);
  const effectiveScopeLimit = Math.max(1, Number(scopeLimit) || worker.scanLimit);
  const scopes = await scanWorkerScopes({ runtime, limit: effectiveScopeLimit });
  const result = await processWorkerScopes({
    runtime,
    scopes,
    maxJobs: effectiveMaxJobs,
    download,
    totalJobCap,
  });
  observability.info('worker pass completed', {
    scopeCount: result.scopeCount,
    processedCount: result.processedCount,
    failedScopeCount: result.failedScopeCount,
  });
  return result;
}

async function runWorkerLoop({ runtime, sleep = defaultSleep } = {}) {
  const { observability, worker, config } = runtime;
  observability.info('worker loop started', {
    storageMode: config.storageMode,
    runOnce: worker.runOnce,
    batchSize: worker.batchSize,
    scanLimit: worker.scanLimit,
    maxAttempts: worker.maxAttempts,
  });

  if (worker.runOnce) {
    return runWorkerPass({ runtime, maxJobs: worker.batchSize, scopeLimit: worker.scanLimit });
  }

  while (true) {
    const result = await runWorkerPass({ runtime, maxJobs: worker.batchSize, scopeLimit: worker.scanLimit });
    await sleep(result.processedCount > 0 ? 250 : worker.idleMs);
  }
}

async function processIndexingScope({ runtime, userId, importId = null, maxJobs = null, download = false }) {
  const { config, store, worker } = runtime;
  return processImportJobs({
    store,
    userId,
    importId,
    videoDir: config.videoDir,
    shouldDownload: download,
    geminiApiKey: config.geminiApiKey,
    openRouterApiKey: config.openRouterApiKey,
    openRouterModel: config.openRouterModel,
    openRouterMediaModel: config.openRouterMediaModel,
    openRouterEmbeddingModel: config.openRouterEmbeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    indexingConcurrency: config.indexingConcurrency,
    credentialEncryptionKey: config.credentialEncryptionKey,
    maxJobs: maxJobs || worker.batchSize,
    leaseOwner: worker.leaseOwner,
    leaseMs: worker.leaseMs,
    perUserConcurrency: worker.perUserConcurrency,
    maxAttempts: worker.maxAttempts,
    retryBackoffMs: worker.retryBackoffMs,
    maxRetryBackoffMs: worker.maxRetryBackoffMs,
  });
}

async function getWorkerStatus({ runtime }) {
  const { store, worker } = runtime;
  const queue = typeof store.getWorkerQueueStatus === 'function'
    ? await store.getWorkerQueueStatus({ maxAttempts: worker.maxAttempts })
    : emptyQueueStatus();
  return {
    queue: {
      totalJobs: queue.totalJobs || 0,
      queued: queue.queued || 0,
      active: queue.active || 0,
      retrying: queue.retrying || 0,
      paused: queue.paused || 0,
      failed: queue.failed || 0,
      exhausted: queue.exhausted || 0,
      oldestQueuedAt: queue.oldestQueuedAt || null,
    },
    worker: {
      batchSize: worker.batchSize,
      scanLimit: worker.scanLimit,
      globalConcurrency: worker.globalConcurrency,
      perUserConcurrency: worker.perUserConcurrency,
      maxAttempts: worker.maxAttempts,
      leaseMs: worker.leaseMs,
      inlineIndexingEnabled: worker.inlineIndexingEnabled,
    },
  };
}

function emptyQueueStatus() {
  return {
    totalJobs: 0,
    queued: 0,
    active: 0,
    retrying: 0,
    paused: 0,
    failed: 0,
    exhausted: 0,
    oldestQueuedAt: null,
  };
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function noopObservability() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createWorkerRuntime,
  getWorkerStatus,
  normalizeWorkerConfig,
  processWorkerScopes,
  runWorkerLoop,
  runWorkerPass,
  scanWorkerScopes,
};
