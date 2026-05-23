const { createWorkerRuntime, processIndexingScope, processStorageImportBatch, scanIndexingScopes } = require('../services/workerRuntime');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;

process.once('SIGINT', () => {
  stopping = true;
  console.log('[indexing-worker] received SIGINT, stopping after current batch');
});
process.once('SIGTERM', () => {
  stopping = true;
  console.log('[indexing-worker] received SIGTERM, stopping after current batch');
});

function log(event, details = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    worker: 'indexing-worker',
    event,
    ...details,
  }));
}

async function runPool(items, limit, task) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    const results = [];
    while (queue.length && !stopping) {
      const item = queue.shift();
      results.push(await task(item));
    }
    return results;
  });
  return (await Promise.all(workers)).flat();
}

async function runCycle({ store, config, remainingCanary = null }) {
  const storageImports = await processStorageImportBatch({ store, config });
  for (const entry of storageImports) {
    log('storage_import.processed', entry);
  }

  const scopes = await scanIndexingScopes({ store, config });
  if (!scopes.length) return { storageImports: storageImports.length, scopes: 0, processed: 0 };

  let remaining = remainingCanary;
  const runnable = remainingCanary
    ? scopes.slice(0, Math.ceil(remainingCanary / Math.max(config.workerBatchSize, 1)))
    : scopes;
  const results = await runPool(runnable, config.workerGlobalConcurrency, async (scope) => {
    const maxJobs = remaining === null ? config.workerBatchSize : Math.min(config.workerBatchSize, remaining);
    if (remaining !== null) remaining = Math.max(remaining - maxJobs, 0);
    if (remainingCanary && maxJobs <= 0) return { ...scope, processed: 0 };
    try {
      const processed = await processIndexingScope({
        store,
        config,
        userId: scope.userId,
        importId: scope.importId,
        maxJobs,
      });
      log('scope.processed', {
        userId: scope.userId,
        importId: scope.importId,
        processed: processed.length,
      });
      resultsState.processed += processed.length;
      return { ...scope, processed: processed.length };
    } catch (error) {
      log('scope.failed', {
        userId: scope.userId,
        importId: scope.importId,
        error: error.message,
      });
      return { ...scope, processed: 0, error: error.message };
    }
  });

  return {
    storageImports: storageImports.length,
    scopes: scopes.length,
    processed: results.reduce((sum, result) => sum + (result.processed || 0), 0),
  };
}

const resultsState = { processed: 0 };

async function main() {
  const { store, config } = createWorkerRuntime();
  log('started', {
    storageMode: config.storageMode,
    globalConcurrency: config.workerGlobalConcurrency,
    perUserConcurrency: config.workerPerUserConcurrency,
    batchSize: config.workerBatchSize,
    canaryLimit: config.workerCanaryLimit,
    runOnce: config.workerRunOnce,
  });

  while (!stopping) {
    const remainingCanary = config.workerCanaryLimit
      ? Math.max(config.workerCanaryLimit - resultsState.processed, 0)
      : null;
    if (config.workerCanaryLimit && remainingCanary <= 0) {
      log('canary.complete', { processed: resultsState.processed });
      break;
    }

    const result = await runCycle({ store, config, remainingCanary });
    log('cycle.complete', result);

    if (config.workerRunOnce) break;
    if (!result.processed) await sleep(config.workerIdleMs);
  }

  log('stopped', { processed: resultsState.processed });
}

main().catch((error) => {
  log('fatal', { error: error.message });
  process.exitCode = 1;
});
