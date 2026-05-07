const { getConfig } = require('./src/config');
const { createApp } = require('./src/server');
const { createLocalStore } = require('./src/stores/localStore');
const { createSupabaseStore } = require('./src/stores/supabaseStore');

const config = getConfig();
const store =
  config.storageMode === 'supabase'
    ? createSupabaseStore({
        url: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      })
    : createLocalStore({ dataPath: config.dataPath });

const app = createApp({ store, config });

app.listen(config.port, () => {
  console.log(`Instagram Brain API running at http://localhost:${config.port}`);
  console.log(`Storage mode: ${config.storageMode}`);
});
