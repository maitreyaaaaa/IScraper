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
    openRouterModel: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro',
    openRouterMediaModel: process.env.OPENROUTER_MEDIA_MODEL || 'google/gemini-3.1-flash-lite-preview',
    openRouterEmbeddingModel: process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small',
    deepSeekApiKey: process.env.DEEPSEEK_API_KEY,
    deepSeekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    aiSearchEnabled: process.env.AI_SEARCH_ENABLED !== 'false',
    aiSearchResultLimit: Number(process.env.AI_SEARCH_RESULT_LIMIT || 8),
    aiSearchCacheTtlMs: Number(process.env.AI_SEARCH_CACHE_TTL_MS || 6 * 60 * 60 * 1000),
    aiSearchRateLimitMax: Number(process.env.AI_SEARCH_RATE_LIMIT_MAX || 60),
    aiSearchDailyLimit: Number(process.env.AI_SEARCH_DAILY_LIMIT || 1000),
    embeddingDimensions: Number(process.env.EMBEDDING_DIMENSIONS || 1536),
    indexingConcurrency: Number(process.env.INDEXING_CONCURRENCY || 1),
    credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY,
    adminApiKey: process.env.ADMIN_API_KEY,
    adminPassword: process.env.ADMIN_PASSWORD,
    workerApiKey: process.env.WORKER_API_KEY || process.env.CRON_SECRET,
    workerBatchSize: Number(process.env.WORKER_BATCH_SIZE || 5),
    workerScanLimit: Number(process.env.WORKER_SCAN_LIMIT || 20),
    workerLeaseMs: Number(process.env.WORKER_LEASE_MS || 15 * 60 * 1000),
    workerLeaseOwner: process.env.WORKER_LEASE_OWNER || `worker-${process.env.VERCEL_DEPLOYMENT_ID || process.env.HOSTNAME || 'local'}`,
    workerMaxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS || 3),
    workerRetryBackoffMs: Number(process.env.WORKER_RETRY_BACKOFF_MS || 60 * 1000),
    workerMaxRetryBackoffMs: Number(process.env.WORKER_MAX_RETRY_BACKOFF_MS || 30 * 60 * 1000),
    workerPerUserConcurrency: Number(process.env.WORKER_PER_USER_CONCURRENCY || 1),
    workerGlobalConcurrency: Number(process.env.WORKER_GLOBAL_CONCURRENCY || process.env.INDEXING_CONCURRENCY || 1),
    workerIdleMs: Number(process.env.WORKER_IDLE_MS || 5000),
    workerCanaryLimit: Number(process.env.WORKER_CANARY_LIMIT || 0),
    workerRunOnce: process.env.WORKER_RUN_ONCE === 'true',
    storageImportBatchSize: Number(process.env.STORAGE_IMPORT_BATCH_SIZE || 1),
    deferStorageImportProcessing: process.env.DEFER_STORAGE_IMPORT_PROCESSING === 'true',
    workerRateLimitMax: Number(process.env.WORKER_RATE_LIMIT_MAX || 30),
    inlineIndexingEnabled: process.env.INLINE_INDEXING_ENABLED === 'true',
    adminEmails: (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    appUrl: process.env.APP_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173',
    corsOrigins: (process.env.CORS_ORIGINS || process.env.APP_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
    maxUploadFileSizeBytes: Number(process.env.MAX_UPLOAD_FILE_SIZE_BYTES || 25 * 1024 * 1024),
    importChunkSizeBytes: Number(process.env.IMPORT_CHUNK_SIZE_BYTES || 4 * 1024 * 1024),
    importUploadBucket: process.env.IMPORT_UPLOAD_BUCKET || 'import-uploads',
    noteAssetBucket: process.env.NOTE_ASSET_BUCKET || 'note-assets',
    maxNoteImageFileSizeBytes: Number(process.env.MAX_NOTE_IMAGE_FILE_SIZE_BYTES || 5 * 1024 * 1024),
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 600),
    feedbackRateLimitMax: Number(process.env.FEEDBACK_RATE_LIMIT_MAX || 20),
    importRateLimitMax: Number(process.env.IMPORT_RATE_LIMIT_MAX || 10),
    searchRateLimitMax: Number(process.env.SEARCH_RATE_LIMIT_MAX || 180),
    checkoutRateLimitMax: Number(process.env.CHECKOUT_RATE_LIMIT_MAX || 10),
    adminRateLimitMax: Number(process.env.ADMIN_RATE_LIMIT_MAX || 30),
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    enableCreditCheckout: process.env.ENABLE_CREDIT_CHECKOUT === 'true',
    posthogProjectKey: process.env.POSTHOG_PROJECT_KEY,
    posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    posthogEnabled: process.env.POSTHOG_ENABLED !== 'false',
    posthogDebug: process.env.POSTHOG_DEBUG === 'true',
    posthogFlushImmediate: process.env.POSTHOG_FLUSH_IMMEDIATE
      ? process.env.POSTHOG_FLUSH_IMMEDIATE === 'true'
      : process.env.VERCEL === '1',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

module.exports = {
  getConfig,
};
