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
  const runtime = createWorkerRuntime({
    store: createStore(config),
    config,
    observability,
  });
  await runWorkerLoop({ runtime });
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

if (require.main === module) {
  runCli();
}

module.exports = {
  applyCliOverrides,
  createStore,
  main,
  runCli,
};
