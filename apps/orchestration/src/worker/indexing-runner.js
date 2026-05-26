#!/usr/bin/env node

const { getConfig } = require('../config');
const { createObservability } = require('../services/observability');
const { createLocalStore } = require('../stores/localStore');
const { createSupabaseStore } = require('../stores/supabaseStore');
const { createWorkerRuntime, runWorkerLoop } = require('../runtime/workerRuntime');

function createStore(config) {
  return config.storageMode === 'supabase'
    ? createSupabaseStore({
        url: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      })
    : createLocalStore({ dataPath: config.dataPath });
}

async function main() {
  const config = getConfig();
  const observability = createObservability(config);
  const runtime = createWorkerRuntime({
    store: createStore(config),
    config,
    observability,
  });
  await runWorkerLoop({ runtime });
}

main().catch((error) => {
  console.error('indexing worker fatal error', error);
  process.exitCode = 1;
});
