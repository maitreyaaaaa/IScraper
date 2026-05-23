const path = require('path');
require('dotenv').config();

const DATA_PATH = path.join(__dirname, '../../../data');

function getConfig() {
  return {
    port: Number(process.env.PORT || 3001),
    dataPath: process.env.DATA_PATH || DATA_PATH,
    storageMode: process.env.STORAGE_MODE || (process.env.SUPABASE_URL ? 'supabase' : 'local'),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    importUploadBucket: process.env.SUPABASE_IMPORT_BUCKET || 'instagram-assets',
    geminiApiKey: process.env.GEMINI_API_KEY,
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterModel: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro',
    openRouterMediaModel: process.env.OPENROUTER_MEDIA_MODEL || 'google/gemini-3.1-flash-lite-preview',
    openRouterEmbeddingModel: process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small',
    embeddingDimensions: Number(process.env.EMBEDDING_DIMENSIONS || 1536),
    credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY,
    adminApiKey: process.env.ADMIN_API_KEY,
    adminPassword: process.env.ADMIN_PASSWORD,
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
  };
}

module.exports = {
  getConfig,
};
