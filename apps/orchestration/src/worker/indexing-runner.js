#!/usr/bin/env node

const { getConfig } = require('../config');
const { createObservability } = require('../services/observability');
const { createLocalStore } = require('../stores/localStore');
const { createSupabaseStore } = require('../stores/supabaseStore');
const { createWorkerRuntime, runWorkerLoop } = require('../runtime/workerRuntime');
const { assertWorkerPreflight, shouldRunWorkerPreflight } = require('./preflight');

function createStore(config) {
  return config.storageMode === 'supabase'
    ? createSupabaseStore({
        url: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      })
    : createLocalStore({ dataPath: config.dataPath });
}

async function main() {
  applyCliOverrides(process.argv.slice(2));
  const config = getConfig();
  const preflight = shouldRunWorkerPreflight(config)
    ? assertWorkerPreflight(config)
    : { warnings: [] };
  const observability = createObservability(config);
  for (const warning of preflight.warnings || []) {
    observability.warn('worker preflight warning', { warning });
  }
  const shutdown = createShutdownController({ observability });
  registerShutdownHandlers(shutdown);
  const runtime = createWorkerRuntime({
    store: createStore(config),
    config,
    observability,
  });
  await runWorkerLoop({
    runtime,
    sleep: shutdown.sleep,
    shouldContinue: shutdown.shouldContinue,
  });
}

function applyCliOverrides(args = []) {
  if (args.includes('--once')) {
    process.env.WORKER_RUN_ONCE = 'true';
  }
}

function runCli() {
  return main().catch((error) => {
    if (error?.name === 'WorkerPreflightError') {
      console.error('indexing worker preflight failed', error.details);
    } else {
      console.error('indexing worker fatal error', error);
    }
    process.exitCode = 1;
  });
}

function createShutdownController({ observability }) {
  let stopping = false;
  let releaseWait = null;
  const stopped = new Promise((resolve) => {
    releaseWait = resolve;
  });

  function requestShutdown(signal) {
    if (stopping) return;
    stopping = true;
    observability.warn('worker shutdown requested', { signal });
    releaseWait();
  }

  async function sleep(ms) {
    if (stopping) return;
    await Promise.race([
      defaultSleep(ms),
      stopped,
    ]);
  }

  return {
    requestShutdown,
    shouldContinue: () => !stopping,
    sleep,
  };
}

function registerShutdownHandlers(shutdown) {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => shutdown.requestShutdown(signal));
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  runCli();
}

module.exports = {
  applyCliOverrides,
  createShutdownController,
  createStore,
  main,
  registerShutdownHandlers,
  runCli,
};
