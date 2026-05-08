const { getConfig } = require('../apps/orchestration/src/config');
const { createApp } = require('../apps/orchestration/src/server');
const { createLocalStore } = require('../apps/orchestration/src/stores/localStore');
const { createSupabaseStore } = require('../apps/orchestration/src/stores/supabaseStore');

const config = getConfig();
const store =
  config.storageMode === 'supabase'
    ? createSupabaseStore({
        url: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      })
    : createLocalStore({ dataPath: config.dataPath });

module.exports = createApp({ store, config });
