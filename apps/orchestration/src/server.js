const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const Stripe = require('stripe');
const JSZip = require('jszip');
const { parseImportExport } = require('./services/exportParser');
const { processImportJobs } = require('./services/worker');
const { createOpenRouterEmbedding } = require('./services/embeddings');
const { credentialOptions } = require('./services/providers');
const { testProviderCredential } = require('./services/providerClients');
const { formatPrice } = require('./services/credits');
const { buildKnowledgeGraph, buildObsidianFiles } = require('./services/graph');
const { createDeepSeekSearchAnswer } = require('./services/aiSearch');
const { parseManualLinkPayload } = require('./services/linkSaver');
const { validateProfileInput } = require('./services/profiles');
const {
  DEFAULT_EXTENSION_SCOPES,
  defaultExtensionExpiry,
  generateExtensionToken,
  hashExtensionToken,
} = require('./services/extensionTokens');
const { cleanLensText, describeLensCrop } = require('./services/lensSearch');

const EXPORT_UPLOAD_EXTENSIONS = new Set(['.html', '.htm', '.zip', '.json', '.csv']);
const EXPORT_UPLOAD_MIME_TYPES = new Set([
  'text/html',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  '',
]);
const IMPORT_UPLOAD_BUCKET = 'import-uploads';
const rateBuckets = new Map();
const aiSearchCache = new Map();
const aiUsageBuckets = new Map();

async function getUser(req, store) {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (token && typeof store.getUserFromToken === 'function') {
    return store.getUserFromToken(token);
  }
  if (store.requiresAuth) {
    const error = new Error('Sign in is required.');
    error.statusCode = 401;
    throw error;
  }
  return {
    id: req.header('x-user-id') || 'local-dev-user',
    email: req.header('x-user-email') || 'local@example.com',
  };
}

async function getExtensionUser(req, store, requiredScope = 'lens:search') {
  const token = String(req.header('x-iscraper-extension-token') || '').trim();
  if (!token || typeof store.getUserForExtensionToken !== 'function') {
    const error = new Error('Connect the IScraper extension before using Lens search.');
    error.statusCode = 401;
    throw error;
  }
  const user = await store.getUserForExtensionToken(hashExtensionToken(token), requiredScope);
  if (!user) {
    const error = new Error('Extension token is invalid, expired, or revoked.');
    error.statusCode = 401;
    throw error;
  }
  return user;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function assertAdmin(req, config, store) {
  const provided = req.header('x-admin-api-key') || '';
  if (config.adminApiKey && provided) {
    const expected = String(config.adminApiKey);
    const validLength = Buffer.byteLength(provided) === Buffer.byteLength(expected);
    const valid = validLength && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (valid) return { id: 'admin-api-key', email: req.header('x-admin-actor') || 'admin-api' };
  }

  const adminEmails = new Set((config.adminEmails || []).map((email) => String(email).toLowerCase()));
  const email = String(req.header('x-admin-email') || '').trim().toLowerCase();
  const password = String(req.header('x-admin-password') || '');
  if (adminEmails.size && config.adminPassword && email && password) {
    const expected = String(config.adminPassword);
    const validLength = Buffer.byteLength(password) === Buffer.byteLength(expected);
    const validPassword = validLength && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
    if (validPassword && adminEmails.has(email)) return { id: email, email };
  }

  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (adminEmails.size && token && typeof store.getUserFromToken === 'function') {
    const user = await store.getUserFromToken(token);
    if (adminEmails.has(String(user.email || '').toLowerCase())) return user;
  }

  if (!config.adminApiKey && !adminEmails.size) {
    const error = new Error('Admin API is not configured.');
    error.statusCode = 503;
    throw error;
  }

  const error = new Error('Admin access denied.');
  error.statusCode = 403;
  throw error;
}

function stripeFor(config) {
  return config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
}

async function requireCompletedProfile(req, store) {
  if (!store.requiresAuth || typeof store.getProfile !== 'function') return;
  if (typeof store.getUserAdminState === 'function') {
    const state = await store.getUserAdminState(req.user.id);
    if (state?.status === 'blocked') {
      const error = new Error('This account is blocked. Contact support if this looks wrong.');
      error.statusCode = 403;
      throw error;
    }
  }
  const profile = await store.getProfile(req.user.id);
  if (!profile?.username) {
    const error = new Error('Create your username before importing saved posts.');
    error.statusCode = 428;
    throw error;
  }
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function createRateLimiter({ windowMs, max, name, namespace = 'app' }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${namespace}:${name}:${clientIp(req)}`;
    const current = rateBuckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    rateBuckets.set(key, bucket);

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    if (rateBuckets.size > 5000) {
      for (const [bucketKey, value] of rateBuckets.entries()) {
        if (value.resetAt <= now) rateBuckets.delete(bucketKey);
      }
    }
    return next();
  };
}

function currentUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

function assertAiSearchUsageAllowed(req, config) {
  const now = Date.now();
  const userKey = req.user?.id || clientIp(req);
  const minuteKey = `minute:${userKey}`;
  const dayKey = `day:${currentUtcDay()}:${userKey}`;
  const minuteMax = config.aiSearchRateLimitMax || 60;
  const dayMax = config.aiSearchDailyLimit || 1000;
  const minute = aiUsageBuckets.get(minuteKey);
  const minuteBucket = minute && minute.resetAt > now ? minute : { count: 0, resetAt: now + 60 * 1000 };
  const day = aiUsageBuckets.get(dayKey);
  const dayBucket = day && day.resetAt > now ? day : { count: 0, resetAt: now + 24 * 60 * 60 * 1000 };

  minuteBucket.count += 1;
  dayBucket.count += 1;
  aiUsageBuckets.set(minuteKey, minuteBucket);
  aiUsageBuckets.set(dayKey, dayBucket);

  if (minuteBucket.count > minuteMax || dayBucket.count > dayMax) {
    const error = new Error('AI search is busy. Please try again later.');
    error.statusCode = 429;
    throw error;
  }

  if (aiUsageBuckets.size > 5000) {
    for (const [bucketKey, value] of aiUsageBuckets.entries()) {
      if (value.resetAt <= now) aiUsageBuckets.delete(bucketKey);
    }
  }
}

function aiSearchCacheKey({ userId, query, results, model }) {
  const ids = results.map((item) => item.id).join(',');
  return crypto
    .createHash('sha256')
    .update([userId, model, String(query || '').trim().toLowerCase(), ids].join('\n'))
    .digest('hex');
}

async function runAiSearchAnswer({ config, req, userId, query, results }) {
  if (config.aiSearchEnabled === false || !config.deepSeekApiKey || !query || !results.length) return null;
  const topResults = results.slice(0, Math.max(1, Math.min(config.aiSearchResultLimit || 8, 12)));
  const model = config.deepSeekModel || 'deepseek-v4-flash';
  const cacheKey = aiSearchCacheKey({ userId, query, results: topResults, model });
  const cached = aiSearchCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return { ...cached.value, cached: true };

  assertAiSearchUsageAllowed(req, config);
  const ai = await createDeepSeekSearchAnswer({
    apiKey: config.deepSeekApiKey,
    model,
    query,
    results: topResults,
  });
  if (!ai) return null;

  const value = { ...ai, model, resultIds: topResults.map((item) => item.id), cached: false };
  aiSearchCache.set(cacheKey, {
    value,
    expiresAt: now + (config.aiSearchCacheTtlMs || 6 * 60 * 60 * 1000),
  });

  if (aiSearchCache.size > 500) {
    for (const [entryKey, entry] of aiSearchCache.entries()) {
      if (entry.expiresAt <= now || aiSearchCache.size > 500) aiSearchCache.delete(entryKey);
    }
  }

  return value;
}

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy());
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://us.i.posthog.com https://eu.i.posthog.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function uploadFileFilter(_req, file, callback) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!EXPORT_UPLOAD_EXTENSIONS.has(extension) || !EXPORT_UPLOAD_MIME_TYPES.has(file.mimetype || '')) {
    return callback(new Error('Upload Instagram ZIP/HTML/JSON files or Pinterest export ZIP/JSON/CSV files.'));
  }
  return callback(null, true);
}

function assertImportFileAllowed(file, maxUploadFileSizeBytes) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!EXPORT_UPLOAD_EXTENSIONS.has(extension) || !EXPORT_UPLOAD_MIME_TYPES.has(file.mimetype || '')) {
    const error = new Error('Upload Instagram ZIP/HTML/JSON files or Pinterest export ZIP/JSON/CSV files.');
    error.statusCode = 400;
    throw error;
  }
  if (file.size > maxUploadFileSizeBytes) {
    const error = new Error(`Upload files must be ${(maxUploadFileSizeBytes / (1024 * 1024)).toFixed(0)} MB or smaller.`);
    error.statusCode = 413;
    throw error;
  }
}

async function createImportFromFiles({ store, userId, files, config }) {
  const parsed = await parseImportExport(files);
  if (!parsed.items.length) {
    const error = new Error('No saves were found in those files. Upload Instagram saved-post ZIP/HTML/JSON files or Pinterest export ZIP/JSON/CSV files.');
    error.statusCode = 400;
    throw error;
  }
  const importEntry = await store.createImport({
    userId,
    source: parsed.source || 'user-export',
    mode: 'export',
    fileNames: files.map((file) => file.originalname),
  });
  const items = await store.upsertImportData({ userId, importId: importEntry.id, parsed });
  const jobs = await store.createJobs({ userId, importId: importEntry.id, items });

  return {
    import: importEntry,
    itemCount: parsed.items.length,
    totalItemCount: parsed.items.length,
    newItemCount: items.length,
    skippedDuplicateCount: Math.max(parsed.items.length - items.length, 0),
    collectionCount: parsed.collections.length,
    queuedJobCount: jobs.length,
    jobCount: jobs.length,
  };
}

function storagePathBelongsToUser(userId, storagePath = '') {
  const normalized = String(storagePath).replace(/^\/+/, '');
  return normalized.startsWith(`${userId}/`);
}

async function ensureImportUploadBucket(store, config) {
  if (!store.client?.storage) {
    const error = new Error('Large file upload storage is not configured.');
    error.statusCode = 503;
    throw error;
  }
  const bucket = config.importUploadBucket || IMPORT_UPLOAD_BUCKET;
  const options = {
    public: false,
    fileSizeLimit: config.maxUploadFileSizeBytes || 25 * 1024 * 1024,
    allowedMimeTypes: [...EXPORT_UPLOAD_MIME_TYPES].filter(Boolean),
  };
  const { error } = await store.client.storage.getBucket(bucket);
  if (!error) return bucket;

  const created = await store.client.storage.createBucket(bucket, options);
  if (created.error && !/already exists/i.test(created.error.message || '')) {
    throw created.error;
  }
  return bucket;
}

function fileNameForStorage(fileName = 'upload') {
  return String(fileName)
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'upload';
}

function signedUploadFileFromBody(file = {}) {
  return {
    originalname: String(file.name || 'upload'),
    mimetype: String(file.type || 'application/octet-stream'),
    size: Number(file.size || 0),
  };
}

async function loadImportFilesFromStorage({ store, userId, storageFiles, config }) {
  if (!store.client?.storage) {
    const error = new Error('Large file upload storage is not configured.');
    error.statusCode = 503;
    throw error;
  }
  const bucket = config.importUploadBucket || IMPORT_UPLOAD_BUCKET;
  const files = [];
  const pathsToRemove = [];

  for (const entry of storageFiles) {
    const storagePath = String(entry.path || '').replace(/^\/+/, '');
    const originalname = String(entry.name || path.basename(storagePath));
    const mimetype = String(entry.type || 'application/octet-stream');

    if (!storagePath || !storagePathBelongsToUser(userId, storagePath)) {
      const error = new Error('Uploaded file path is invalid.');
      error.statusCode = 400;
      throw error;
    }

    const { data, error } = await store.client.storage.from(bucket).download(storagePath);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    const file = {
      originalname,
      mimetype,
      size: buffer.length,
      buffer,
    };
    assertImportFileAllowed(file, config.maxUploadFileSizeBytes || 25 * 1024 * 1024);
    files.push(file);
    pathsToRemove.push(storagePath);
  }

  return { files, bucket, pathsToRemove };
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function reviewUpdatesFromBody(body = {}, item = {}) {
  const sourceTitle = cleanText(body.sourceTitle ?? body.title ?? item.sourceTitle, 160);
  const sourceAuthor = cleanText(body.sourceAuthor ?? body.author ?? item.sourceAuthor, 120);
  const sourceDescription = cleanText(body.sourceDescription ?? body.description ?? item.sourceDescription, 500);
  const note = cleanText(body.note, 500);
  const collections = Array.isArray(body.collections)
    ? body.collections.map((entry) => cleanText(entry, 80)).filter(Boolean).slice(0, 12)
    : cleanText(body.collection, 80)
      ? [cleanText(body.collection, 80)]
      : item.collections || [];
  const caption = [
    sourceTitle || item.sourceTitle || item.url,
    sourceDescription ? `Description: ${sourceDescription}` : '',
    note ? `Note: ${note}` : '',
    `Source: ${item.platform || 'Web'}`,
    `URL: ${item.url}`,
  ].filter(Boolean).join('\n');

  return {
    sourceTitle,
    sourceAuthor,
    sourceDescription,
    collections,
    caption,
  };
}

function publicLensResult(item) {
  const analysis = item.analysis || {};
  return {
    id: item.id,
    url: item.url,
    platform: item.platform || 'Web',
    sourceTitle: item.sourceTitle || analysis.title || firstLine(item.caption) || 'Saved item',
    sourceAuthor: item.sourceAuthor || item.ownerUsername || item.ownerName || '',
    sourceDescription: item.sourceDescription || analysis.summary || item.caption || '',
    thumbnailUrl: item.thumbnailUrl || '',
    status: item.status,
    summary: analysis.summary || '',
    tags: analysis.tags || item.hashtags || [],
  };
}

function firstLine(value = '') {
  return String(value).split('\n').find(Boolean)?.slice(0, 160);
}

async function runSearch({ store, config, userId, query, filters = {} }) {
  let queryEmbedding = null;
  if (query && config.credentialEncryptionKey && store.supportsSemanticSearch && typeof store.getPreferredProviderCredential === 'function') {
    try {
      const embeddingCredential = await store.getPreferredProviderCredential(userId, 'embedding', config.credentialEncryptionKey);
      if (embeddingCredential) {
        queryEmbedding = await createOpenRouterEmbedding({
          apiKey: embeddingCredential.apiKey,
          model: embeddingCredential.model || config.openRouterEmbeddingModel,
          input: query,
          dimensions: config.embeddingDimensions,
          inputType: 'search_query',
        });
      }
    } catch (error) {
      console.warn(`Semantic query embedding failed: ${error.message}`);
    }
  }
  return store.search(userId, query, filters, { queryEmbedding });
}

function createApp({ store, config = {} }) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: uploadFileFilter,
    limits: {
      fileSize: config.maxUploadFileSizeBytes || 25 * 1024 * 1024,
      files: 20,
    },
  });
  const rateWindowMs = config.rateLimitWindowMs || 15 * 60 * 1000;
  const rateLimitNamespace = config.rateLimitNamespace || crypto.randomUUID();
  const generalRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.rateLimitMax || 600, name: 'general', namespace: rateLimitNamespace });
  const feedbackRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.feedbackRateLimitMax || 20, name: 'feedback', namespace: rateLimitNamespace });
  const importRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.importRateLimitMax || 10, name: 'import', namespace: rateLimitNamespace });
  const searchRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: config.searchRateLimitMax || 180, name: 'search', namespace: rateLimitNamespace });
  const checkoutRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.checkoutRateLimitMax || 10, name: 'checkout', namespace: rateLimitNamespace });
  const adminRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.adminRateLimitMax || 30, name: 'admin', namespace: rateLimitNamespace });
  const allowedOrigins = new Set((config.corsOrigins || []).map((origin) => String(origin).replace(/\/$/, '')));
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(generalRateLimit);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || !allowedOrigins.size || allowedOrigins.has(String(origin).replace(/\/$/, ''))) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  }));

  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), asyncRoute(async (req, res) => {
    const stripe = stripeFor(config);
    if (!stripe || !config.stripeWebhookSecret) {
      return res.status(503).json({ error: 'Stripe webhook is not configured.' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.header('stripe-signature'), config.stripeWebhookSecret);
    } catch (_error) {
      return res.status(400).json({ error: 'Invalid Stripe signature.' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await store.completeCreditPurchase({
        purchaseId: session.metadata?.purchaseId,
        checkoutSessionId: session.id,
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      });
    }

    return res.json({ received: true });
  }));

  app.use(express.json({ limit: config.jsonBodyLimit || '1mb' }));

  app.get('/api/credit-packages', asyncRoute(async (_req, res) => {
    const packages = await store.listCreditPackages();
    res.json({
      checkoutEnabled: Boolean(config.enableCreditCheckout && config.stripeSecretKey),
      packages: packages.map((entry) => ({
        ...entry,
        priceLabel: formatPrice(entry),
      })),
    });
  }));

  app.get('/api/feedback', asyncRoute(async (_req, res) => {
    res.json({ feedback: await store.listPublicFeedback() });
  }));

  app.post('/api/feedback', feedbackRateLimit, asyncRoute(async (req, res) => {
    const message = String(req.body?.message || '').trim();
    const feature = String(req.body?.feature || '').trim();
    if (message.length < 3) return res.status(400).json({ error: 'Feedback must be at least 3 characters.' });
    if (message.length > 500) return res.status(400).json({ error: 'Feedback must be 500 characters or less.' });

    const feedback = await store.createPublicFeedback({ feature, message });
    return res.status(201).json({ feedback });
  }));

  app.post('/api/admin/login', adminRateLimit, asyncRoute(async (req, res) => {
    const email = cleanText(req.body?.email, 240).toLowerCase();
    const password = String(req.body?.password || '');
    const adminEmails = new Set((config.adminEmails || []).map((entry) => String(entry).toLowerCase()));
    if (!adminEmails.size || !config.adminPassword) return res.status(503).json({ error: 'Admin password login is not configured.' });

    const expected = String(config.adminPassword);
    const validLength = Buffer.byteLength(password) === Buffer.byteLength(expected);
    const validPassword = validLength && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
    if (!email || !adminEmails.has(email) || !validPassword) {
      return res.status(403).json({ error: 'Invalid admin email or password.' });
    }

    return res.json({ admin: { email } });
  }));

  app.get('/api/admin/summary', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.getAdminSummary !== 'function') return res.status(501).json({ error: 'Admin summary is not available.' });
    res.json({ summary: await store.getAdminSummary() });
  }));

  app.get('/api/admin/users', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listAdminUsers !== 'function') return res.status(501).json({ error: 'Admin users are not available.' });
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const query = String(req.query.q || '').trim();
    res.json(await store.listAdminUsers({ query, limit, offset }));
  }));

  app.get('/api/admin/users/:userId', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.getAdminUserDetail !== 'function') return res.status(501).json({ error: 'Admin user details are not available.' });
    const user = await store.getAdminUserDetail(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  }));

  app.post('/api/admin/users/:userId/block', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.setUserBlocked !== 'function') return res.status(501).json({ error: 'User blocking is not available.' });
    const reason = cleanText(req.body?.reason || 'Blocked by admin', 240);
    const user = await store.setUserBlocked({
      userId: req.params.userId,
      blocked: true,
      reason,
      adminActor: adminUser.email || 'admin',
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  }));

  app.post('/api/admin/users/:userId/unblock', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.setUserBlocked !== 'function') return res.status(501).json({ error: 'User blocking is not available.' });
    const user = await store.setUserBlocked({
      userId: req.params.userId,
      blocked: false,
      reason: cleanText(req.body?.reason || 'Unblocked by admin', 240),
      adminActor: adminUser.email || 'admin',
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  }));

  app.get('/api/admin/imports', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listAdminImports !== 'function') return res.status(501).json({ error: 'Admin imports are not available.' });
    res.json({ imports: await store.listAdminImports({ limit: 50 }) });
  }));

  app.get('/api/admin/activity', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listAdminActivity !== 'function') return res.status(501).json({ error: 'Admin activity is not available.' });
    res.json({ activity: await store.listAdminActivity({ limit: 100 }) });
  }));

  app.get('/api/admin/feedback', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listAdminFeedback !== 'function') return res.status(501).json({ error: 'Admin feedback is not available.' });
    res.json({ feedback: await store.listAdminFeedback({ limit: 100 }) });
  }));

  app.post('/api/admin/feedback/:id/hide', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.setFeedbackStatus !== 'function') return res.status(501).json({ error: 'Feedback moderation is not available.' });
    const feedback = await store.setFeedbackStatus(req.params.id, 'hidden');
    if (!feedback) return res.status(404).json({ error: 'Feedback not found.' });
    res.json({ feedback });
  }));

  app.post('/api/admin/feedback/:id/show', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.setFeedbackStatus !== 'function') return res.status(501).json({ error: 'Feedback moderation is not available.' });
    const feedback = await store.setFeedbackStatus(req.params.id, 'visible');
    if (!feedback) return res.status(404).json({ error: 'Feedback not found.' });
    res.json({ feedback });
  }));

  app.get('/api/admin/credits/:userId', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    res.json({ credits: await store.getCredits(req.params.userId) });
  }));

  app.post('/api/admin/credits/adjust', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    const userId = String(req.body?.userId || '').trim();
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    const adminActor = String(req.header('x-admin-actor') || adminUser.email || 'admin-api').trim().slice(0, 120);

    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    if (!Number.isInteger(amount) || amount === 0) return res.status(400).json({ error: 'amount must be a non-zero whole number.' });
    if (!reason) return res.status(400).json({ error: 'reason is required.' });

    const result = await store.addAdminCreditAdjustment({ userId, amount, reason, adminActor });
    return res.status(201).json(result);
  }));

  app.post('/api/lens/search', searchRateLimit, asyncRoute(async (req, res) => {
    const user = await getExtensionUser(req, store, 'lens:search');
    const type = req.body?.type === 'image' ? 'image' : 'text';
    let query = cleanLensText(req.body?.query, type === 'image' ? 500 : 240);
    let imageAnalysis = null;

    if (type === 'text' && query.length < 2) {
      return res.status(400).json({ error: 'Select at least 2 characters to search your brain.' });
    }

    if (type === 'image') {
      if (!config.credentialEncryptionKey || typeof store.getPreferredProviderCredential !== 'function') {
        return res.status(428).json({ error: 'Connect a media AI key before using Lens image search.' });
      }
      const mediaCredential = await store.getPreferredProviderCredential(user.id, 'media', config.credentialEncryptionKey);
      const described = await describeLensCrop({ dataUrl: req.body?.imageDataUrl, credential: mediaCredential });
      query = described.query;
      imageAnalysis = described.analysis;
    }

    const results = (await runSearch({
      store,
      config,
      userId: user.id,
      query,
      filters: req.body?.filters || {},
    })).slice(0, 8).map(publicLensResult);

    if (typeof store.recordLensSearchEvent === 'function') {
      await store.recordLensSearchEvent({ userId: user.id, queryType: type, resultCount: results.length });
    }

    return res.json({
      query,
      type,
      results,
      imageAnalysis: imageAnalysis ? {
        title: imageAnalysis.title || '',
        ocrText: imageAnalysis.ocrText || '',
        visualDescription: imageAnalysis.visualDescription || '',
      } : null,
    });
  }));

  app.use(asyncRoute(async (req, _res, next) => {
    const user = await getUser(req, store);
    await store.ensureUser(user.id, user.email);
    req.user = user;
    next();
  }));

  app.get('/api/data', asyncRoute(async (req, res) => {
    const data = await store.getItems(req.user.id);
    res.json({ data });
  }));

  app.get('/api/items', asyncRoute(async (req, res) => {
    const items = await store.getItems(req.user.id);
    res.json({ items });
  }));

  app.get('/api/items/:id', asyncRoute(async (req, res) => {
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    return res.json({ item });
  }));

  app.patch('/api/items/:id/review', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSavedItem !== 'function') return res.status(501).json({ error: 'Review updates are not available.' });
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    const updated = await store.updateSavedItem(req.user.id, item.id, reviewUpdatesFromBody(req.body || {}, item));
    return res.json({ item: updated });
  }));

  app.post('/api/items/:id/approve', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSavedItem !== 'function') return res.status(501).json({ error: 'Review approval is not available.' });
    let item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });

    item = await store.updateSavedItem(req.user.id, item.id, {
      ...reviewUpdatesFromBody(req.body || {}, item),
      status: item.status === 'done' ? 'done' : 'queued',
      error: null,
    });

    let importId = item.importId;
    if (!importId) {
      const importEntry = await store.createImport({
        userId: req.user.id,
        source: 'review-approval',
        mode: 'export',
        fileNames: [item.url],
      });
      importId = importEntry.id;
      item = await store.updateSavedItem(req.user.id, item.id, { importId });
    }

    const jobs = item.status === 'done' ? [] : await store.createJobs({ userId: req.user.id, importId, items: [item] });
    if (req.body?.startProcessing !== false && jobs.length) {
      startProcessing({ store, userId: req.user.id, importId, config, shouldDownload: false });
    }

    return res.json({ item, queuedJobCount: jobs.length, jobs });
  }));

  app.get('/api/credits', asyncRoute(async (req, res) => {
    res.json({ credits: await store.getCredits(req.user.id) });
  }));

  app.get('/api/profile', asyncRoute(async (req, res) => {
    const profile = typeof store.getProfile === 'function' ? await store.getProfile(req.user.id) : null;
    res.json({ profile, required: Boolean(store.requiresAuth && !profile?.username) });
  }));

  app.post('/api/activity/sign-in', asyncRoute(async (req, res) => {
    if (typeof store.recordUserActivity === 'function') {
      await store.recordUserActivity({
        userId: req.user.id,
        eventType: 'sign_in',
        metadata: { email: req.user.email },
      });
    }
    res.json({ ok: true });
  }));

  app.post('/api/profile', asyncRoute(async (req, res) => {
    const input = validateProfileInput({
      username: req.body?.username,
      avatarUrl: req.body?.avatarUrl,
    });
    const profile = await store.saveProfile(req.user.id, input);
    res.json({ profile });
  }));

  app.get('/api/extension-tokens', asyncRoute(async (req, res) => {
    if (typeof store.listExtensionTokens !== 'function') return res.json({ tokens: [] });
    return res.json({ tokens: await store.listExtensionTokens(req.user.id) });
  }));

  app.post('/api/extension-tokens', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.createExtensionToken !== 'function') return res.status(501).json({ error: 'Extension tokens are not available.' });
    const rawToken = generateExtensionToken();
    const token = await store.createExtensionToken(req.user.id, {
      tokenHash: hashExtensionToken(rawToken),
      name: cleanText(req.body?.name || 'Browser extension', 80),
      scopes: DEFAULT_EXTENSION_SCOPES,
      expiresAt: defaultExtensionExpiry(),
    });
    return res.status(201).json({ token, secret: rawToken });
  }));

  app.delete('/api/extension-tokens/:id', asyncRoute(async (req, res) => {
    if (typeof store.revokeExtensionToken !== 'function') return res.status(501).json({ error: 'Extension tokens are not available.' });
    const revoked = await store.revokeExtensionToken(req.user.id, req.params.id);
    if (!revoked) return res.status(404).json({ error: 'Extension token not found.' });
    return res.json({ revoked: true });
  }));

  app.get('/api/graph', asyncRoute(async (req, res) => {
    const items = await store.getItems(req.user.id);
    res.json({ graph: buildKnowledgeGraph(items) });
  }));

  app.get('/api/graph/obsidian-export', asyncRoute(async (req, res) => {
    const items = await store.getItems(req.user.id);
    const graph = buildKnowledgeGraph(items);
    const files = buildObsidianFiles(graph);
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.path, file.content);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="iscraper-obsidian-graph.zip"');
    res.send(buffer);
  }));

  app.post('/api/credits/checkout', checkoutRateLimit, asyncRoute(async (req, res) => {
    if (!config.enableCreditCheckout) return res.status(503).json({ error: 'Credit checkout is coming soon.' });

    const stripe = stripeFor(config);
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet.' });

    const packageId = String(req.body?.packageId || '').trim();
    const packageEntry = await store.getCreditPackage(packageId);
    if (!packageEntry) return res.status(404).json({ error: 'Credit package not found.' });

    const purchase = await store.createCreditPurchase({ userId: req.user.id, packageEntry });
    const appUrl = String(config.appUrl || req.get('origin') || 'http://localhost:5173').replace(/\/$/, '');
    const lineItem = packageEntry.stripePriceId
      ? { price: packageEntry.stripePriceId, quantity: 1 }
      : {
          price_data: {
            currency: packageEntry.currency,
            unit_amount: packageEntry.amountCents,
            product_data: { name: `${packageEntry.credits} IScraper credits` },
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: req.user.id,
      customer_email: req.user.email,
      line_items: [lineItem],
      success_url: `${appUrl}/?checkout=success#app`,
      cancel_url: `${appUrl}/?checkout=cancelled#app`,
      metadata: {
        purchaseId: purchase.id,
        userId: req.user.id,
        packageId: packageEntry.id,
        credits: String(packageEntry.credits),
      },
    });

    await store.updateCreditPurchaseSession({ purchaseId: purchase.id, checkoutSessionId: session.id });
    return res.json({ url: session.url, sessionId: session.id });
  }));

  app.get('/api/provider-credentials', asyncRoute(async (req, res) => {
    res.json({
      credentials: await store.listProviderCredentials(req.user.id),
      options: credentialOptions(),
    });
  }));

  app.post('/api/provider-credentials', asyncRoute(async (req, res) => {
    const credential = await store.saveProviderCredential(req.user.id, {
      provider: req.body.provider,
      purpose: req.body.purpose,
      model: req.body.model,
      apiKey: req.body.apiKey,
      encryptionKey: config.credentialEncryptionKey,
    });
    res.json({ credential });
  }));

  app.delete('/api/provider-credentials/:id', asyncRoute(async (req, res) => {
    const deleted = await store.deleteProviderCredential(req.user.id, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Credential not found.' });
    return res.json({ deleted: true });
  }));

  app.post('/api/provider-credentials/:id/test', asyncRoute(async (req, res) => {
    const credential = await store.getProviderCredential(req.user.id, req.params.id, config.credentialEncryptionKey);
    if (!credential) return res.status(404).json({ error: 'Credential not found.' });
    await testProviderCredential({ credential });
    return res.json({ ok: true, provider: credential.provider, purpose: credential.purpose, model: credential.model });
  }));

  app.post('/api/provider-credentials/:id/reveal', asyncRoute(async (req, res) => {
    const credential = await store.getProviderCredential(req.user.id, req.params.id, config.credentialEncryptionKey);
    if (!credential) return res.status(404).json({ error: 'Credential not found.' });
    return res.json({ apiKey: credential.apiKey });
  }));

  app.post('/api/imports', importRateLimit, upload.array('exportFiles', 20), asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const files = req.files?.length ? req.files : req.file ? [req.file] : [];
    if (!files.length) return res.status(400).json({ error: 'Upload Instagram ZIP/HTML/JSON files or your Pinterest export ZIP/JSON/CSV.' });

    files.forEach((file) => assertImportFileAllowed(file, config.maxUploadFileSizeBytes || 25 * 1024 * 1024));
    res.json(await createImportFromFiles({ store, userId: req.user.id, files, config }));
  }));

  app.post('/api/imports/upload-urls', importRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const requestedFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!requestedFiles.length) return res.status(400).json({ error: 'Choose files before uploading.' });
    if (requestedFiles.length > 20) return res.status(400).json({ error: 'Upload 20 files or fewer at once.' });

    const bucket = await ensureImportUploadBucket(store, config);
    const uploads = [];
    for (const requestedFile of requestedFiles) {
      const file = signedUploadFileFromBody(requestedFile);
      assertImportFileAllowed(file, config.maxUploadFileSizeBytes || 25 * 1024 * 1024);
      const storagePath = `${req.user.id}/${Date.now()}-${crypto.randomUUID()}-${fileNameForStorage(file.originalname)}`;
      const { data, error } = await store.client.storage.from(bucket).createSignedUploadUrl(storagePath);
      if (error) throw error;
      uploads.push({
        path: storagePath,
        token: data.token,
        signedUrl: data.signedUrl,
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
      });
    }

    res.json({ bucket, uploads });
  }));

  app.post('/api/imports/storage', importRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const storageFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!storageFiles.length) return res.status(400).json({ error: 'Upload files to storage before importing.' });
    if (storageFiles.length > 20) return res.status(400).json({ error: 'Upload 20 files or fewer at once.' });

    const { files, bucket, pathsToRemove } = await loadImportFilesFromStorage({
      store,
      userId: req.user.id,
      storageFiles,
      config,
    });

    try {
      res.json(await createImportFromFiles({ store, userId: req.user.id, files, config }));
    } finally {
      if (pathsToRemove.length) {
        await store.client.storage.from(bucket).remove(pathsToRemove).catch((error) => {
          console.warn(`Could not remove import upload files: ${error.message}`);
        });
      }
    }
  }));

  app.post('/api/saves/link', importRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const parsed = parseManualLinkPayload(req.body || {});
    const importEntry = await store.createImport({
      userId: req.user.id,
      source: 'manual-link',
      mode: 'export',
      fileNames: [parsed.items[0].url],
    });
    const initialStatus = req.body?.startProcessing === true ? 'queued' : 'needs_review';
    const items = await store.upsertImportData({ userId: req.user.id, importId: importEntry.id, parsed, initialStatus });
    const jobs = initialStatus === 'queued' ? await store.createJobs({ userId: req.user.id, importId: importEntry.id, items }) : [];

    if (req.body?.startProcessing === true && jobs.length) {
      startProcessing({ store, userId: req.user.id, importId: importEntry.id, config, shouldDownload: false });
    }

    res.status(201).json({
      import: importEntry,
      item: items[0] || parsed.items[0],
      newItemCount: items.length,
      skippedDuplicateCount: items.length ? 0 : 1,
      queuedJobCount: jobs.length,
    });
  }));

  app.post('/api/imports/:id/process', asyncRoute(async (req, res) => {
    const jobs = await store.getJobs(req.user.id, req.params.id);
    startProcessing({ store, userId: req.user.id, importId: req.params.id, config, shouldDownload: req.body?.download !== false });

    res.json({ message: 'Processing started', jobCount: jobs.length });
  }));

  app.post('/api/jobs/restart', asyncRoute(async (req, res) => {
    const importId = req.body?.importId || null;
    const resetCount = typeof store.restartJobs === 'function' ? await store.restartJobs(req.user.id, importId) : 0;
    const jobs = await store.getJobs(req.user.id, importId);
    if (req.body?.start !== false) {
      startProcessing({ store, userId: req.user.id, importId, config, shouldDownload: req.body?.download !== false });
    }

    res.json({
      message: 'Queue restart requested',
      resetCount,
      jobCount: jobs.length,
    });
  }));

  app.get('/api/jobs/:id', asyncRoute(async (req, res) => {
    const job = await store.getJob(req.user.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    return res.json({ job });
  }));

  app.post('/api/search', searchRateLimit, asyncRoute(async (req, res) => {
    const query = String(req.body.query || '').trim().slice(0, 240);
    const results = await runSearch({ store, config, userId: req.user.id, query, filters: req.body.filters || {} });
    let ai = null;
    if (req.body.includeAi && query && results.length) {
      try {
        ai = await runAiSearchAnswer({ config, req, userId: req.user.id, query, results });
      } catch (error) {
        if (error.statusCode === 429) throw error;
        console.warn(`AI search answer failed: ${error.message}`);
        ai = { error: 'AI answer is unavailable right now. Showing regular search results.' };
      }
    }
    res.json({ results, ai });
  }));

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || (error instanceof multer.MulterError || /Upload Instagram/.test(error.message) ? 400 : 500);
    if (statusCode >= 500) console.error(error);
    res.status(statusCode).json({ error: error.message });
  });

  return app;
}

function startProcessing({ store, userId, importId, config, shouldDownload = true }) {
  processImportJobs({
    store,
    userId,
    importId,
    videoDir: config.videoDir,
    shouldDownload,
    geminiApiKey: config.geminiApiKey,
    openRouterApiKey: config.openRouterApiKey,
    openRouterModel: config.openRouterModel,
    openRouterMediaModel: config.openRouterMediaModel,
    openRouterEmbeddingModel: config.openRouterEmbeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    indexingConcurrency: config.indexingConcurrency,
    credentialEncryptionKey: config.credentialEncryptionKey,
  }).catch((error) => {
    console.error('Background processing failed:', error);
  });
}

module.exports = {
  createApp,
};
