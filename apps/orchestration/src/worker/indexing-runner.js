#!/usr/bin/env node

const { createWorkerRuntime, processIndexingScope, scanIndexingScopes } = require('../services/workerRuntime');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce({ store, config }) {
  const scopes = await scanIndexingScopes({ store, config });
  const concurrency = Math.max(1, Math.min(Number(config.workerGlobalConcurrency) || 1, 10));
  const maxJobs = Math.max(1, Number(config.workerBatchSize) || 5);
  const results = [];

  for (let index = 0; index < scopes.length; index += concurrency) {
    const slice = scopes.slice(index, index + concurrency);
    const settled = await Promise.all(slice.map(async (scope) => {
      try {
        const processed = await processIndexingScope({
          store,
          config,
          userId: scope.userId,
          importId: scope.importId,
          maxJobs,
        });
        return { scope, processedCount: processed.length, error: null };
      } catch (error) {
        return { scope, processedCount: 0, error };
      }
    }));
    results.push(...settled);
  }

  const processedCount = results.reduce((total, result) => total + result.processedCount, 0);
  const failedScopes = results.filter((result) => result.error);
  for (const failed of failedScopes) {
    console.error('indexing scope failed', {
      userId: failed.scope.userId,
      importId: failed.scope.importId,
      error: failed.error.message,
    });
  }
  console.info('indexing worker pass completed', {
    scopeCount: scopes.length,
    processedCount,
    failedScopeCount: failedScopes.length,
  });
  return { scopeCount: scopes.length, processedCount, failedScopeCount: failedScopes.length };
}

async function main() {
  const runtime = createWorkerRuntime();
  const { config } = runtime;
  const idleMs = Math.max(1000, Number(config.workerIdleMs) || 5000);

  console.info('indexing worker started', {
    storageMode: config.storageMode,
    runOnce: config.workerRunOnce,
    batchSize: config.workerBatchSize,
    scanLimit: config.workerScanLimit,
    maxAttempts: config.workerMaxAttempts,
  });

  if (config.workerRunOnce) {
    await runOnce(runtime);
    return;
  }

  while (true) {
    const result = await runOnce(runtime);
    await sleep(result.processedCount > 0 ? 250 : idleMs);
  }
}

main().catch((error) => {
  console.error('indexing worker fatal error', error);
  process.exitCode = 1;
});
