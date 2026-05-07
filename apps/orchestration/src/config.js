const path = require('path');
require('dotenv').config();

const DATA_PATH = path.join(__dirname, '../../../data');

function getConfig() {
  return {
    port: Number(process.env.PORT || 3001),
    dataPath: process.env.DATA_PATH || DATA_PATH,
    videoDir: process.env.VIDEO_DIR || path.join(process.env.DATA_PATH || DATA_PATH, 'videos'),
    storageMode: process.env.STORAGE_MODE || (process.env.SUPABASE_URL ? 'supabase' : 'local'),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  };
}

module.exports = {
  getConfig,
};
