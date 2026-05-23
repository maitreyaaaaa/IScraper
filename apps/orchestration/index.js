const { getConfig } = require('./src/config');
const { createApp } = require('./src/server');
const { createLocalStore } = require('./src/stores/localStore');
const { createSupabaseStore } = require('./src/stores/supabaseStore');
const { createObservability } = require('./src/services/observability');

const config = getConfig();
const store =
  config.storageMode === 'supabase'
    ? createSupabaseStore({
        url: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      })
    : createLocalStore({ dataPath: config.dataPath });

const observability = createObservability(config);
const app = createApp({ store, config, observability });

app.listen(config.port, () => {
  observability.info('server started', {
    port: config.port,
    storageMode: config.storageMode,
    posthogEnabled: observability.enabled,
  });
});
