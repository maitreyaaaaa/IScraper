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
const { analyzeImageBufferWithCredential, testProviderCredential } = require('./services/providerClients');
const { formatPrice } = require('./services/credits');
const { buildKnowledgeGraph, buildObsidianFiles } = require('./services/graph');
const { createDeepSeekSearchAnswer } = require('./services/aiSearch');
const { parseManualLinkPayload } = require('./services/linkSaver');
const {
  PageArchiveError,
  captureReadableCopy,
  checkPageReachable,
  shouldAttemptPageArchive,
} = require('./services/pageArchive');
const {
  buildLibraryCareSummary,
  linkCheckCandidates,
  normalizeReminderInput,
} = require('./services/libraryCare');
const { validateProfileInput } = require('./services/profiles');
const { contextForRequest, createObservability } = require('./services/observability');
const {
  DEFAULT_EXTENSION_SCOPES,
  defaultExtensionExpiry,
  generateExtensionToken,
  hashExtensionToken,
} = require('./services/extensionTokens');
const { cleanLensText, describeLensCrop } = require('./services/lensSearch');
const { findSimilarVisualItems, publicVisualSearchAnalysis } = require('./services/visualSimilarity');
const {
  assertTelegramWebhookSecret,
  parseTelegramCommand,
  parseTelegramUpdate,
  sendTelegramReply,
  telegramReply,
  tokenHashFromConnectText,
} = require('./services/telegramCapture');
const {
  isDeletionBlockingStatus,
  processAccountDeletionRequest,
  publicDeletionRequest,
} = require('./services/accountDeletion');
const {
  MAX_NOTE_IMAGES,
  MAX_NOTE_IMAGE_BYTES,
  NOTE_ASSET_BUCKET,
  NOTE_CONTENT_TYPE,
  assertNoteImageFile,
  buildNoteItem,
  noteAssetStoragePath,
  noteInputFromBody,
} = require('./services/notes');

const EXPORT_UPLOAD_EXTENSIONS = new Set(['.html', '.htm', '.zip', '.json', '.csv', '.js', '.txt']);
const EXPORT_UPLOAD_MIME_TYPES = new Set([
  'text/html',
  'text/plain',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
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
const IMPORT_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
const rateBuckets = new Map();
const aiSearchCache = new Map();
const aiUsageBuckets = new Map();
const SCREENSHOT_ANALYSIS_TIMEOUT_MS = 60 * 1000;

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
    const error = new Error('Connect the IScraper extension before saving from Chrome.');
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

function assertWorker(req, config) {
  const expected = config.workerApiKey;
  if (!expected) {
    const error = new Error('Worker API is not configured.');
    error.statusCode = 503;
    throw error;
  }

  const auth = req.header('authorization') || '';
  const provided = req.header('x-worker-api-key') || (auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '');
  const validLength = Buffer.byteLength(provided) === Buffer.byteLength(expected);
  const valid = validLength && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (valid) return;

  const error = new Error('Worker access denied.');
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

async function requireAccountNotDeleting(req, store) {
  if (typeof store.getActiveDeletionRequest !== 'function') return;
  const deletion = await store.getActiveDeletionRequest(req.user.id);
  if (deletion && isDeletionBlockingStatus(deletion.status)) {
    const error = new Error('Account deletion is pending. You can export data, check deletion status, cancel while allowed, or log out.');
    error.statusCode = 423;
    error.deletion = publicDeletionRequest(deletion);
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
      req.app?.locals?.observability?.warn('rate limit exceeded', contextForRequest(req, {
        limiter: name,
        windowMs,
        max,
      }));
      req.app?.locals?.observability?.capture('rate limit exceeded', contextForRequest(req, {
        limiter: name,
        windowMs,
        max,
        statusCode: 429,
      }), req.user?.id || 'server');
      return res.status(429).json({ error: 'Too many requests. Please try again later.', requestId: req.context?.requestId });
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

function createSearchEventId() {
  return crypto.randomUUID();
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
    return callback(new Error('Upload Instagram, Pinterest, or X bookmark export files.'));
  }
  return callback(null, true);
}

function noteImageFileFilter(_req, file, callback) {
  try {
    assertNoteImageFile({ ...file, buffer: Buffer.from('x'), size: 1 });
    return callback(null, true);
  } catch (error) {
    return callback(error);
  }
}

function assertImportFileAllowed(file, maxUploadFileSizeBytes) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!EXPORT_UPLOAD_EXTENSIONS.has(extension) || !EXPORT_UPLOAD_MIME_TYPES.has(file.mimetype || '')) {
    const error = new Error('Upload Instagram, Pinterest, or X bookmark export files.');
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
    const error = new Error('No saves were found in those files. Upload Instagram saved-post files, Pinterest export files, or X bookmark export files.');
    error.statusCode = 400;
    throw error;
  }
  const importEntry = await store.createImport({
    userId,
    source: parsed.source || 'user-export',
    mode: 'export',
    fileNames: files.map((file) => file.originalname),
  });
  const items = await store.upsertImportData({
    userId,
    importId: importEntry.id,
    parsed,
    initialStatus: 'queued',
    duplicateMode: 'skipExisting',
  });
  const jobs = typeof store.createJobs === 'function'
    ? await store.createJobs({ userId, importId: importEntry.id, items })
    : [];

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

async function ensureNoteAssetBucket(store, config) {
  if (!store.client?.storage) {
    const error = new Error('Note image storage is not configured.');
    error.statusCode = 503;
    throw error;
  }
  const bucket = config.noteAssetBucket || NOTE_ASSET_BUCKET;
  const { error } = await store.client.storage.getBucket(bucket);
  if (!error) return bucket;

  const created = await store.client.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: MAX_NOTE_IMAGE_BYTES,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  });
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

function storagePathForUpload(userId, originalName = 'upload') {
  const extension = path.extname(fileNameForStorage(originalName)).toLowerCase();
  const safeExtension = EXPORT_UPLOAD_EXTENSIONS.has(extension) ? extension : '';
  return `${userId}/${Date.now()}-${crypto.randomUUID()}${safeExtension}`;
}

function chunkPartPath(storagePath, index) {
  return `${storagePath}.parts/${String(index).padStart(5, '0')}`;
}

function parseChunkCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 && count <= 100 ? count : 0;
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

    const totalChunks = parseChunkCount(entry.totalChunks);
    let buffer;
    if (entry.chunked || totalChunks) {
      if (!totalChunks) {
        const error = new Error('Uploaded file chunks are invalid.');
        error.statusCode = 400;
        throw error;
      }
      const buffers = [];
      for (let index = 0; index < totalChunks; index += 1) {
        const partPath = chunkPartPath(storagePath, index);
        const { data, error } = await store.client.storage.from(bucket).download(partPath);
        if (error) throw error;
        buffers.push(Buffer.from(await data.arrayBuffer()));
        pathsToRemove.push(partPath);
      }
      buffer = Buffer.concat(buffers);
    } else {
      const { data, error } = await store.client.storage.from(bucket).download(storagePath);
      if (error) throw error;
      buffer = Buffer.from(await data.arrayBuffer());
      pathsToRemove.push(storagePath);
    }
    const file = {
      originalname,
      mimetype,
      size: buffer.length,
      buffer,
    };
    assertImportFileAllowed(file, config.maxUploadFileSizeBytes || 25 * 1024 * 1024);
    files.push(file);
  }

  return { files, bucket, pathsToRemove };
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function extensionScopesFromBody(body = {}) {
  if (!Array.isArray(body.scopes) || !body.scopes.length) return DEFAULT_EXTENSION_SCOPES;
  const allowed = new Set(DEFAULT_EXTENSION_SCOPES);
  const scopes = [...new Set(body.scopes.map((scope) => String(scope || '').trim()).filter((scope) => allowed.has(scope)))];
  return scopes.length ? scopes : DEFAULT_EXTENSION_SCOPES;
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

async function approveReviewItemsForIndexing({ store, userId, items }) {
  const queuedItems = [];
  const jobs = [];
  let fallbackImportId = null;

  for (const item of items) {
    let importId = item.importId;
    if (!importId) {
      if (!fallbackImportId) {
        const importEntry = await store.createImport({
          userId,
          source: 'bulk-review-approval',
          mode: 'export',
          fileNames: items.map((entry) => entry.url).slice(0, 20),
        });
        fallbackImportId = importEntry.id;
      }
      importId = fallbackImportId;
    }

    const updated = await store.updateSavedItem(userId, item.id, {
      importId,
      status: item.status === 'done' ? 'done' : 'queued',
      error: null,
    });
    if (updated && updated.status !== 'done') queuedItems.push(updated);
  }

  const itemsByImportId = queuedItems.reduce((groups, item) => {
    const importId = item.importId;
    if (!groups.has(importId)) groups.set(importId, []);
    groups.get(importId).push(item);
    return groups;
  }, new Map());

  for (const [importId, importItems] of itemsByImportId.entries()) {
    jobs.push(...await store.createJobs({ userId, importId, items: importItems }));
  }

  return { items: queuedItems, jobs };
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

function captureWorkflow(req, event, properties = {}) {
  req.app?.locals?.observability?.capture(event, contextForRequest(req, properties), req.user?.id || properties.userId || 'server');
}

function warnWorkflow(req, event, properties = {}) {
  req.app?.locals?.observability?.warn(event, contextForRequest(req, properties));
}

function archiveHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function failedArchivePayload(error) {
  const archiveError = error instanceof PageArchiveError ? error : null;
  const errorCode = archiveError?.code || 'capture_failed';
  return {
    status: ['unsupported_protocol', 'blocked_host', 'blocked_port', 'unsupported_content_type', 'no_readable_content'].includes(errorCode) ? 'skipped' : 'failed',
    errorCode,
    errorMessage: archiveError?.message || 'This page could not be backed up.',
    httpStatus: archiveError?.statusCode || null,
    capturedAt: new Date().toISOString(),
  };
}

async function captureReadableCopyForItem({ store, userId, item, force = false }) {
  if (!item || !shouldAttemptPageArchive(item) || typeof store.upsertItemArchive !== 'function') return null;
  const existing = typeof store.getItemArchive === 'function' ? await store.getItemArchive(userId, item.id) : null;
  if (existing?.status === 'ready' && !force) return existing;
  await store.upsertItemArchive(userId, item.id, {
    status: 'pending',
    sourceUrl: item.url,
    errorCode: '',
    errorMessage: '',
  });
  try {
    const archive = await captureReadableCopy(item.url);
    return await store.upsertItemArchive(userId, item.id, archive);
  } catch (error) {
    return store.upsertItemArchive(userId, item.id, {
      sourceUrl: item.url,
      ...failedArchivePayload(error),
    });
  }
}

async function startReadableCopyForItem({ req, store, userId, item, force = false }) {
  if (!item || !shouldAttemptPageArchive(item) || typeof store.upsertItemArchive !== 'function') return null;
  const existing = typeof store.getItemArchive === 'function' ? await store.getItemArchive(userId, item.id) : null;
  if (existing?.status === 'ready' && !force) return existing;
  const pending = await store.upsertItemArchive(userId, item.id, {
    status: 'pending',
    sourceUrl: item.url,
    errorCode: '',
    errorMessage: '',
  });
  captureWorkflow(req, 'page backup queued', { itemId: item.id, host: archiveHost(item.url) });
  setTimeout(() => {
    captureReadableCopyForItem({ store, userId, item, force })
      .then((archive) => {
        const event = archive?.status === 'ready' ? 'page backup saved' : 'page backup skipped';
        req.app?.locals?.observability?.capture(event, {
          itemId: item.id,
          userId,
          host: archiveHost(item.url),
          status: archive?.status || 'failed',
          errorCode: archive?.errorCode || '',
          byteSize: archive?.byteSize || 0,
        }, userId);
      })
      .catch((error) => {
        req.app?.locals?.observability?.warn('page backup failed', {
          itemId: item.id,
          userId,
          host: archiveHost(item.url),
          errorCode: error?.code || 'capture_failed',
        });
      });
  }, 0);
  return pending;
}

async function libraryCareSummary(store, userId) {
  const [items, linkChecks, reminders] = await Promise.all([
    store.getItems(userId),
    typeof store.listLinkHealthChecks === 'function' ? store.listLinkHealthChecks(userId) : [],
    typeof store.listItemReminders === 'function' ? store.listItemReminders(userId) : [],
  ]);
  return buildLibraryCareSummary({ items, linkChecks, reminders });
}

async function checkLibraryLinks({ store, userId, limit = 20 }) {
  if (typeof store.upsertLinkHealthCheck !== 'function') return { checked: [], skipped: true };
  const [items, checks] = await Promise.all([
    store.getItems(userId),
    typeof store.listLinkHealthChecks === 'function' ? store.listLinkHealthChecks(userId) : [],
  ]);
  const candidates = linkCheckCandidates(items, checks, limit);
  const checked = [];
  for (const item of candidates) {
    let result;
    try {
      result = await checkPageReachable(item.url);
    } catch (error) {
      result = {
        status: 'unknown',
        sourceUrl: item.url,
        finalUrl: '',
        httpStatus: null,
        errorCode: error?.code || 'check_failed',
        errorMessage: 'This link could not be checked right now.',
        checkedAt: new Date().toISOString(),
      };
    }
    const saved = await store.upsertLinkHealthCheck(userId, item.id, result);
    if (saved) checked.push(saved);
  }
  return { checked, skipped: false };
}

async function persistNoteImages({ store, config, userId, itemId, files = [] }) {
  if (!files.length) return [];
  if (files.length > MAX_NOTE_IMAGES) {
    const error = new Error(`Notes support up to ${MAX_NOTE_IMAGES} images.`);
    error.statusCode = 400;
    throw error;
  }

  const assets = [];
  for (const file of files) assertNoteImageFile(file);

  if (store.client?.storage) {
    const bucket = await ensureNoteAssetBucket(store, config);
    for (const file of files) {
      const storagePath = noteAssetStoragePath({ userId, itemId, file });
      const { error } = await store.client.storage.from(bucket).upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
      if (error) throw error;
      assets.push(await store.addItemAsset(userId, itemId, {
        assetType: 'image',
        storagePath,
        mimeType: file.mimetype,
      }));
    }
    return assets.filter(Boolean);
  }

  for (const file of files) {
    assets.push(await store.addItemAsset(userId, itemId, {
      assetType: 'image',
      storagePath: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      mimeType: file.mimetype,
    }));
  }
  return assets.filter(Boolean);
}

async function analyzeExtensionScreenshot({ store, config, userId, item, file }) {
  if (typeof store.saveAnalysis !== 'function' || !file?.buffer?.length) return null;
  const plan = await chooseScreenshotAnalysisPlan({ store, config, userId });
  if (!plan?.credential) return null;

  const analysis = await withTimeout(
    analyzeImageBufferWithCredential({
      credential: plan.credential,
      imageBuffer: file.buffer,
      mimeType: file.mimetype || 'image/png',
      item,
    }),
    SCREENSHOT_ANALYSIS_TIMEOUT_MS,
    'Screenshot image analysis timed out.',
  );
  if (!analysis) return null;

  const updatedMetadata = await store.updateSavedItem?.(userId, item.id, {
    sourceDescription: analysis.summary || analysis.visualDescription || item.sourceDescription,
  });
  const saved = await store.saveAnalysis(userId, item.id, analysis);
  if (['free', 'paid'].includes(plan.source) && typeof store.recordUsage === 'function') {
    await store.recordUsage({
      userId,
      itemId: item.id,
      source: plan.source,
      provider: plan.credential.provider,
      model: plan.credential.model,
    }).catch(() => {});
  }
  return saved || updatedMetadata || await store.getItem(userId, item.id);
}

async function chooseScreenshotAnalysisPlan({ store, config, userId }) {
  if (config.openRouterApiKey) {
    const appCredential = {
      id: 'app-openrouter-screenshot-media',
      provider: 'openrouter',
      purpose: 'media',
      model: config.openRouterMediaModel,
      apiKey: config.openRouterApiKey,
    };

    if (typeof store.getCredits !== 'function') return { credential: appCredential, source: null };
    const credits = await store.getCredits(userId);
    if (credits.paidCredits > 0) return { credential: appCredential, source: 'paid' };
  }

  const userCredential =
    config.credentialEncryptionKey && typeof store.getPreferredProviderCredential === 'function'
      ? await store.getPreferredProviderCredential(userId, 'media', config.credentialEncryptionKey)
      : null;
  return userCredential ? { credential: userCredential, source: 'byok' } : null;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function removeNoteAssetObjects({ store, config, assets = [] }) {
  const storagePaths = assets
    .map((asset) => asset.storagePath)
    .filter((storagePath) => storagePath && !String(storagePath).startsWith('data:'));
  if (!storagePaths.length || !store.client?.storage) return;
  const bucket = config.noteAssetBucket || NOTE_ASSET_BUCKET;
  await store.client.storage.from(bucket).remove(storagePaths).catch((error) => {
    console.warn(`Could not remove note image files: ${error.message}`);
  });
}

function createApp({ store, config = {}, observability = createObservability(config) }) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: uploadFileFilter,
    limits: {
      fileSize: config.maxUploadFileSizeBytes || 25 * 1024 * 1024,
      files: 20,
    },
  });
  const chunkUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.importChunkSizeBytes || IMPORT_CHUNK_SIZE_BYTES,
      files: 1,
    },
  });
  const noteUpload = multer({
    storage: multer.memoryStorage(),
    fileFilter: noteImageFileFilter,
    limits: {
      fileSize: config.maxNoteImageFileSizeBytes || MAX_NOTE_IMAGE_BYTES,
      files: MAX_NOTE_IMAGES,
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
  const workerRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: config.workerRateLimitMax || 30, name: 'worker', namespace: rateLimitNamespace });
  const allowedOrigins = new Set((config.corsOrigins || []).map((origin) => String(origin).replace(/\/$/, '')));
  async function queueIndexingWork({ reason, userId, importId = null, shouldDownload = false, forceInline = false }) {
    if (forceInline || config.inlineIndexingEnabled === true) {
      startProcessing({ store, userId, importId, config, shouldDownload });
      return { mode: 'inline', triggered: false };
    }
    return { mode: 'vm-worker', queued: true, reason, userId, importId };
  }

  async function saveLinkCapture({
    req,
    userId,
    payload,
    source = 'manual-link',
    reason = 'manual-link',
    initialStatus = 'queued',
    shouldArchive = true,
  }) {
    const parsed = parseManualLinkPayload(payload || {});
    const importEntry = await store.createImport({
      userId,
      source,
      mode: 'export',
      fileNames: [parsed.items[0].url],
    });
    const items = await store.upsertImportData({ userId, importId: importEntry.id, parsed, initialStatus });
    const jobs = initialStatus === 'queued' ? await store.createJobs({ userId, importId: importEntry.id, items }) : [];
    let responseItem = null;
    try {
      responseItem = await Promise.resolve(store.getItem(userId, items[0]?.id || parsed.items[0].id));
    } catch {
      responseItem = null;
    }
    if (shouldArchive && responseItem) {
      const archive = await startReadableCopyForItem({ req, store, userId, item: responseItem });
      if (archive) responseItem = { ...responseItem, archive };
    }
    let indexing = null;
    if (jobs.length) {
      indexing = await queueIndexingWork({
        reason,
        userId,
        importId: importEntry.id,
        shouldDownload: false,
      });
    }
    await refreshSmartCollectionsForUser(userId);
    return {
      import: importEntry,
      item: responseItem || items[0] || parsed.items[0],
      newItemCount: items.length,
      skippedDuplicateCount: items.length ? 0 : 1,
      queuedJobCount: jobs.length,
      indexing,
    };
  }

  const workerProcessHandler = asyncRoute(async (req, res) => {
    assertWorker(req, config);
    if (typeof store.getProcessableJobScopes !== 'function') return res.status(501).json({ error: 'Worker job discovery is not available.' });

    const workerBatchCap = Math.max(1, Math.min(Number(config.workerBatchSize) || 2, 5));
    const oneJobRoute = req.path === '/api/worker/process-one';
    const requestedMaxJobs = oneJobRoute ? 1 : Number(req.body?.maxJobs || req.query?.maxJobs) || workerBatchCap;
    const maxJobs = Math.max(1, Math.min(requestedMaxJobs, workerBatchCap));
    const downloadValue = req.body?.download ?? req.query?.download;
    const scopes = await store.getProcessableJobScopes({
      limit: maxJobs,
      perUserConcurrency: config.workerPerUserConcurrency || 1,
      maxAttempts: config.workerMaxAttempts || 3,
    });
    const processed = [];

    for (const scope of scopes) {
      if (processed.length >= maxJobs) break;
      const batch = await runProcessImportJobs({
        store,
        userId: scope.userId,
        importId: scope.importId,
        config,
        shouldDownload: downloadValue === true || downloadValue === 'true',
        maxJobs: Math.max(1, maxJobs - processed.length),
      });
      processed.push(...batch);
    }

    return res.json({
      processedCount: processed.length,
      scopeCount: scopes.length,
    });
  });

  async function queueSingleItemEnrichment(req, itemId, { force = false, reason = 'detail-opened' } = {}) {
    if (typeof store.updateSavedItem !== 'function' || typeof store.createJobs !== 'function') {
      const error = new Error('Indexing jobs are not available.');
      error.statusCode = 501;
      throw error;
    }

    let item = await store.getItem(req.user.id, itemId);
    if (!item) {
      const error = new Error('Item not found.');
      error.statusCode = 404;
      throw error;
    }
    if (item.status === 'needs_review') {
      return { item, skipped: true, reason: 'needs_review' };
    }
    if (!force && ['queued', 'downloading', 'analyzing'].includes(item.status)) {
      return { item: { ...item, indexingStage: 'visual_indexing', lastEnrichmentRequestedAt: new Date().toISOString() }, skipped: true, reason: 'already_queued' };
    }

    const importEntry = await store.createImport({
      userId: req.user.id,
      source: reason,
      mode: 'export',
      fileNames: [item.url || item.id],
    });
    item = await store.updateSavedItem(req.user.id, item.id, {
      importId: importEntry.id,
      status: 'queued',
      error: null,
    });
    const jobs = await store.createJobs({ userId: req.user.id, importId: importEntry.id, items: [item] });
    const indexing = jobs.length
      ? await queueIndexingWork({
        reason,
        userId: req.user.id,
        importId: importEntry.id,
        shouldDownload: req.body?.allowMedia !== false,
      })
      : null;
    const responseItem = { ...item, indexingStage: 'visual_indexing', lastEnrichmentRequestedAt: new Date().toISOString() };
    captureWorkflow(req, 'enrichment queued', { itemId: item.id, importId: importEntry.id, queuedJobCount: jobs.length, reason });
    return { item: responseItem, enriched: false, queued: Boolean(jobs.length), queuedJobCount: jobs.length, jobs, indexing, reason };
  }

  async function refreshSmartCollectionsForUser(userId) {
    if (typeof store.refreshSmartCollections !== 'function') return [];
    try {
      return await store.refreshSmartCollections(userId);
    } catch (error) {
      console.warn('Smart Collections refresh failed:', error.message);
      return [];
    }
  }

  app.locals.observability = observability;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(observability.requestMiddleware);
  app.use(securityHeaders);
  app.use(generalRateLimit);
  app.use(cors({
    exposedHeaders: ['X-Request-ID'],
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(String(origin).replace(/\/$/, ''))) {
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
      warnWorkflow(req, 'stripe webhook rejected', { reason: 'invalid_signature', statusCode: 400 });
      return res.status(400).json({ error: 'Invalid Stripe signature.' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await store.completeCreditPurchase({
        purchaseId: session.metadata?.purchaseId,
        checkoutSessionId: session.id,
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      });
      captureWorkflow(req, 'stripe checkout completed', {
        checkoutSessionId: session.id,
        purchaseId: session.metadata?.purchaseId,
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
      warnWorkflow(req, 'admin login rejected', { statusCode: 403 });
      return res.status(403).json({ error: 'Invalid admin email or password.' });
    }

    captureWorkflow(req, 'admin login completed', { actorType: 'password_admin' });
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
    captureWorkflow(req, 'admin user blocked', { targetUserId: req.params.userId, actorType: 'admin' });
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
    captureWorkflow(req, 'admin user unblocked', { targetUserId: req.params.userId, actorType: 'admin' });
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
    captureWorkflow(req, 'admin feedback moderated', { feedbackId: req.params.id, status: 'hidden' });
    res.json({ feedback });
  }));

  app.post('/api/admin/feedback/:id/show', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.setFeedbackStatus !== 'function') return res.status(501).json({ error: 'Feedback moderation is not available.' });
    const feedback = await store.setFeedbackStatus(req.params.id, 'visible');
    if (!feedback) return res.status(404).json({ error: 'Feedback not found.' });
    captureWorkflow(req, 'admin feedback moderated', { feedbackId: req.params.id, status: 'visible' });
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
    captureWorkflow(req, 'admin credits adjusted', { targetUserId: userId, amount, actorType: 'admin' });
    return res.status(201).json(result);
  }));

  app.get('/api/admin/deletion-requests', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listDeletionRequests !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 100));
    res.json({ requests: await store.listDeletionRequests({ limit }) });
  }));

  app.post('/api/admin/deletion-requests/:id/approve', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.approveDeletionRequest !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    const request = await store.approveDeletionRequest({
      id: req.params.id,
      adminActor: String(req.header('x-admin-actor') || adminUser.email || 'admin').slice(0, 160),
    });
    if (!request) return res.status(404).json({ error: 'Deletion request not found.' });
    captureWorkflow(req, 'admin deletion request approved', { deletionRequestId: req.params.id, actorType: 'admin' });
    res.json({ deletion: publicDeletionRequest(request) });
  }));

  app.post('/api/admin/deletion-requests/:id/cancel', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.cancelDeletionRequestAsAdmin !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    const request = await store.cancelDeletionRequestAsAdmin({
      id: req.params.id,
      adminActor: String(req.header('x-admin-actor') || adminUser.email || 'admin').slice(0, 160),
      reason: cleanText(req.body?.reason || 'Canceled by admin', 500),
    });
    if (!request) return res.status(404).json({ error: 'Deletion request not found.' });
    captureWorkflow(req, 'admin deletion request canceled', { deletionRequestId: req.params.id, actorType: 'admin' });
    res.json({ deletion: publicDeletionRequest(request) });
  }));

  app.post('/api/admin/deletion-requests/:id/process', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    const result = await processAccountDeletionRequest({
      store,
      requestId: req.params.id,
      actor: String(req.header('x-admin-actor') || adminUser.email || 'admin').slice(0, 160),
      maxSteps: Number(req.body?.maxSteps || req.query?.maxSteps) || 7,
    });
    captureWorkflow(req, 'admin deletion request processed', {
      deletionRequestId: req.params.id,
      executedCount: result.executed.length,
      complete: result.complete,
      failedStep: result.failedStep || null,
    });
    res.json(result);
  }));

  app.get('/api/worker/process', workerRateLimit, workerProcessHandler);
  app.post('/api/worker/process', workerRateLimit, workerProcessHandler);
  app.get('/api/worker/process-one', workerRateLimit, workerProcessHandler);
  app.post('/api/worker/process-one', workerRateLimit, workerProcessHandler);

  app.post('/api/lens/search', searchRateLimit, asyncRoute(async (req, res) => {
    const user = await getExtensionUser(req, store, 'lens:search');
    if (typeof store.getActiveDeletionRequest === 'function') {
      const deletion = await store.getActiveDeletionRequest(user.id);
      if (deletion && isDeletionBlockingStatus(deletion.status)) {
        return res.status(423).json({
          error: 'Account deletion is pending. Lens search is disabled for this account.',
          deletion: publicDeletionRequest(deletion),
        });
      }
    }
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
    captureWorkflow(req, 'lens search completed', {
      userId: user.id,
      queryType: type,
      resultCount: results.length,
      hasImageAnalysis: Boolean(imageAnalysis),
    });

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

  async function getExtensionRequestUser(req, scope) {
    const user = await getExtensionUser(req, store, scope);
    req.user = user;
    if (typeof store.getActiveDeletionRequest === 'function') {
      const deletion = await store.getActiveDeletionRequest(user.id);
      if (deletion && isDeletionBlockingStatus(deletion.status)) {
        const error = new Error('Account deletion is pending. Extension saves are disabled for this account.');
        error.statusCode = 423;
        error.deletion = publicDeletionRequest(deletion);
        throw error;
      }
    }
    await requireCompletedProfile(req, store);
    return user;
  }

  app.post('/api/extension/saves/link', importRateLimit, asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'saves:create');
    const parsed = parseManualLinkPayload(req.body || {});
    const importEntry = await store.createImport({
      userId: user.id,
      source: 'browser-extension',
      mode: 'export',
      fileNames: [parsed.items[0].url],
    });
    const items = await store.upsertImportData({ userId: user.id, importId: importEntry.id, parsed, initialStatus: 'queued' });
    const jobs = await store.createJobs({ userId: user.id, importId: importEntry.id, items });

    let indexing = null;
    if (jobs.length) {
      indexing = await queueIndexingWork({
        reason: 'extension-link',
        userId: user.id,
        importId: importEntry.id,
        shouldDownload: false,
      });
    }
    captureWorkflow(req, 'extension link saved', {
      userId: user.id,
      importId: importEntry.id,
      newItemCount: items.length,
    });

    await refreshSmartCollectionsForUser(user.id);
    return res.status(201).json({
      import: importEntry,
      item: items[0] || parsed.items[0],
      newItemCount: items.length,
      skippedDuplicateCount: items.length ? 0 : 1,
      queuedJobCount: jobs.length,
      indexing,
    });
  }));

  app.delete('/api/extension/saves/:id', asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'saves:delete');
    if (typeof store.deleteSavedItem !== 'function') return res.status(501).json({ error: 'URL undo is not available.' });
    const existing = await store.getItem(user.id, req.params.id);
    if (!existing?.importId || typeof store.getImport !== 'function') {
      return res.status(404).json({ error: 'Extension URL capture not found.' });
    }
    const importEntry = await store.getImport(user.id, existing.importId);
    if (!importEntry || importEntry.source !== 'browser-extension') {
      return res.status(404).json({ error: 'Extension URL capture not found.' });
    }
    const deleted = await store.deleteSavedItem(user.id, existing.id);
    captureWorkflow(req, 'extension link undone', {
      userId: user.id,
      itemId: existing.id,
      importId: existing.importId,
    });
    await refreshSmartCollectionsForUser(user.id);
    return res.json({ deleted: Boolean(deleted), itemId: existing.id });
  }));

  app.post('/api/extension/captures/screenshot', noteUpload.single('image'), asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'captures:create');
    if (!req.file) return res.status(400).json({ error: 'Add a screenshot image before saving.' });
    if (typeof store.createNoteItem !== 'function' || typeof store.addItemAsset !== 'function') {
      return res.status(501).json({ error: 'Screenshot captures are not available.' });
    }

    const sourceUrl = cleanText(req.body?.sourceUrl || '', 1000);
    const sourceTitle = cleanText(req.body?.sourceTitle || '', 160);
    const captureTitle = cleanText(req.body?.title || sourceTitle || 'Screen capture', 160);
    const collection = cleanText(req.body?.collection || 'Browser captures', 80) || 'Browser captures';
    const shouldAnalyze = String(req.body?.autoAnalyze ?? 'true') !== 'false';
    const noteBody = [
      'Saved from the IScraper Chrome extension.',
      sourceTitle ? `Page: ${sourceTitle}` : '',
      sourceUrl ? `URL: ${sourceUrl}` : '',
    ].filter(Boolean).join('\n');
    const input = noteInputFromBody({
      title: captureTitle,
      body: noteBody,
      links: sourceUrl ? [sourceUrl] : [],
    });

    let item = await store.createNoteItem(user.id, buildNoteItem({ userId: user.id, input }));
    try {
      await persistNoteImages({ store, config, userId: user.id, itemId: item.id, files: [req.file] });
      item = await store.updateSavedItem(user.id, item.id, {
        collections: [collection],
        platform: 'IScraper Extension',
        platformKey: 'iscraper-extension-capture',
        sourceAuthor: 'Chrome extension',
        sourceTitle: sourceTitle || captureTitle,
        sourceDescription: 'Cropped screenshot captured from the browser.',
        status: 'done',
      }) || await store.getItem(user.id, item.id);
      item = await store.getItem(user.id, item.id);
      try {
        if (!shouldAnalyze) {
          captureWorkflow(req, 'extension screenshot analysis skipped', {
            userId: user.id,
            itemId: item.id,
            reason: 'extension_setting',
          });
        } else {
          item = await analyzeExtensionScreenshot({ store, config, userId: user.id, item, file: req.file }) || item;
        }
      } catch (analysisError) {
        warnWorkflow(req, 'extension screenshot analysis failed', {
          userId: user.id,
          itemId: item.id,
          error: analysisError.message,
        });
      }
    } catch (error) {
      if (item?.id && typeof store.deleteSavedItem === 'function') {
        await store.deleteSavedItem(user.id, item.id).catch(() => {});
      }
      throw error;
    }

    captureWorkflow(req, 'extension screenshot saved', {
      userId: user.id,
      itemId: item.id,
      imageCount: item.assets?.length || 0,
      hasImageAnalysis: Boolean(item.analysis),
    });
    await refreshSmartCollectionsForUser(user.id);
    return res.status(201).json({ item });
  }));

  app.delete('/api/extension/captures/:id', asyncRoute(async (req, res) => {
    const user = await getExtensionRequestUser(req, 'captures:delete');
    if (typeof store.deleteSavedItem !== 'function') return res.status(501).json({ error: 'Screenshot undo is not available.' });
    const existing = await store.getItem(user.id, req.params.id);
    if (!existing || existing.platformKey !== 'iscraper-extension-capture') {
      return res.status(404).json({ error: 'Extension capture not found.' });
    }
    const assets = typeof store.listItemAssets === 'function' ? await store.listItemAssets(user.id, existing.id) : existing.assets || [];
    const deleted = await store.deleteSavedItem(user.id, existing.id);
    await removeNoteAssetObjects({ store, config, assets });
    captureWorkflow(req, 'extension screenshot undone', {
      userId: user.id,
      itemId: existing.id,
      imageCount: assets.length,
    });
    await refreshSmartCollectionsForUser(user.id);
    return res.json({ deleted: Boolean(deleted), itemId: existing.id });
  }));

  app.post('/api/telegram/webhook', asyncRoute(async (req, res) => {
    assertTelegramWebhookSecret(req, config);
    if (
      typeof store.upsertCaptureConnection !== 'function'
      || typeof store.getCaptureConnection !== 'function'
      || typeof store.markCaptureConnectionUsed !== 'function'
      || typeof store.revokeCaptureConnection !== 'function'
      || typeof store.getUserForExtensionToken !== 'function'
    ) {
      return res.status(501).json({ error: 'Telegram capture is not available.' });
    }

    const update = parseTelegramUpdate(req.body || {});
    if (!update) return res.json(telegramReply('Send a link to save it in IScraper.'));

    const sendAndReturn = async (reply, status = 200) => {
      try {
        await sendTelegramReply(config, update.chatId, reply.text);
      } catch (error) {
        warnWorkflow(req, 'telegram reply failed', { chatId: update.chatId, error: error.message });
      }
      return res.status(status).json(reply);
    };

    const command = parseTelegramCommand(update.text);
    if (command?.command === 'start' || command?.command === 'connect') {
      const tokenHash = tokenHashFromConnectText(update.text);
      if (!tokenHash) {
        return sendAndReturn(telegramReply('Open IScraper Settings, create a Telegram bot link code, then send /connect followed by that code.'));
      }
      const user = await store.getUserForExtensionToken(tokenHash, 'saves:create');
      if (!user) return sendAndReturn(telegramReply('That IScraper link code is invalid, expired, or revoked.'), 401);
      req.user = user;
      await requireCompletedProfile(req, store);
      await store.upsertCaptureConnection(user.id, {
        provider: 'telegram',
        externalId: update.chatId,
        tokenHash,
        username: update.username,
        displayName: update.displayName,
      });
      captureWorkflow(req, 'telegram chat connected', {
        userId: user.id,
        chatId: update.chatId,
      });
      return sendAndReturn(telegramReply('Connected. Send or forward a link here and I will save it to IScraper.'));
    }

    if (command?.command === 'disconnect') {
      const disconnected = await store.revokeCaptureConnection('telegram', update.chatId);
      captureWorkflow(req, 'telegram chat disconnected', { chatId: update.chatId, disconnected });
      return sendAndReturn(telegramReply(disconnected ? 'Disconnected from IScraper.' : 'This chat was not connected yet.'));
    }

    const connection = await store.getCaptureConnection('telegram', update.chatId);
    if (!connection) {
      return sendAndReturn(telegramReply('Connect this chat first. Open IScraper Settings, create a Telegram bot link code, then send /connect followed by that code.'));
    }
    const user = await store.getUserForExtensionToken(connection.tokenHash, 'saves:create');
    if (!user) return sendAndReturn(telegramReply('Your IScraper bot link was revoked or expired. Create a new Telegram bot link code in Settings and connect again.'), 401);
    req.user = user;
    await requireCompletedProfile(req, store);

    const url = update.links[0];
    if (!url) return sendAndReturn(telegramReply('Send or forward a message with one link and I will save it.'));
    const note = cleanText(update.text.replace(url, '').trim(), 500);
    const result = await saveLinkCapture({
      req,
      userId: user.id,
      source: 'telegram-bot',
      reason: 'telegram-bot',
      payload: {
        url,
        title: note ? note.split('\n')[0] : '',
        note: [
          'Saved via Telegram.',
          note,
        ].filter(Boolean).join(' '),
        collection: 'Telegram saves',
      },
    });
    await store.markCaptureConnectionUsed(connection.id);
    captureWorkflow(req, 'telegram link saved', {
      userId: user.id,
      itemId: result.item?.id,
      duplicate: !result.newItemCount,
    });
    return sendAndReturn(telegramReply(result.newItemCount ? 'Saved to IScraper.' : 'Already saved in IScraper.', {
      item: result.item,
      duplicate: !result.newItemCount,
    }), result.newItemCount ? 201 : 200);
  }));

  app.use(asyncRoute(async (req, _res, next) => {
    const user = await getUser(req, store);
    await store.ensureUser(user.id, user.email);
    req.user = user;
    next();
  }));

  app.get('/api/account/deletion', asyncRoute(async (req, res) => {
    const deletion = typeof store.getActiveDeletionRequest === 'function'
      ? await store.getActiveDeletionRequest(req.user.id)
      : null;
    res.json({ deletion: publicDeletionRequest(deletion) });
  }));

  app.post('/api/account/deletion', asyncRoute(async (req, res) => {
    if (typeof store.createDeletionRequest !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    if (req.body?.exportConfirmed !== true) {
      return res.status(400).json({ error: 'Confirm that you exported or intentionally skipped exporting your data first.' });
    }
    const request = await store.createDeletionRequest({
      userId: req.user.id,
      email: req.user.email,
      reason: cleanText(req.body?.reason || '', 500),
      exportConfirmed: true,
    });
    if (typeof store.freezeUserForDeletion === 'function') {
      await store.freezeUserForDeletion(req.user.id, { requestId: request.id, actor: 'user-request' });
    }
    captureWorkflow(req, 'account deletion requested', { deletionRequestId: request.id });
    res.status(201).json({ deletion: publicDeletionRequest(request) });
  }));

  app.post('/api/account/deletion/cancel', asyncRoute(async (req, res) => {
    if (typeof store.cancelDeletionRequestForUser !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    const request = await store.cancelDeletionRequestForUser(req.user.id);
    if (!request) return res.status(409).json({ error: 'This deletion request can no longer be canceled.' });
    captureWorkflow(req, 'account deletion canceled', { deletionRequestId: request.id });
    res.json({ deletion: publicDeletionRequest(request) });
  }));

  app.get('/api/privacy-export', asyncRoute(async (req, res) => {
    if (typeof store.getPrivacyExport !== 'function') return res.status(501).json({ error: 'Privacy export is not available.' });
    const exportData = await store.getPrivacyExport(req.user.id);
    captureWorkflow(req, 'privacy export generated', {
      itemCount: exportData.items?.length || 0,
      importCount: exportData.imports?.length || 0,
    });
    res.json({ export: exportData });
  }));

  app.use(asyncRoute(async (req, _res, next) => {
    await requireAccountNotDeleting(req, store);
    next();
  }));

  app.get('/api/data', asyncRoute(async (req, res) => {
    const data = await store.getItems(req.user.id);
    res.json({ data });
  }));

  app.get('/api/items', asyncRoute(async (req, res) => {
    const paged = ['limit', 'cursor', 'sort', 'type', 'state', 'collection', 'platform'].some((key) => Object.prototype.hasOwnProperty.call(req.query, key));
    if (paged && typeof store.listItemsPage === 'function') {
      const page = await store.listItemsPage(req.user.id, {
        limit: req.query.limit,
        cursor: req.query.cursor,
        sort: req.query.sort,
        type: req.query.type,
        state: req.query.state,
        collection: req.query.collection,
        platform: req.query.platform,
      });
      return res.json(page);
    }
    const items = await store.getItems(req.user.id);
    return res.json({ items });
  }));

  app.get('/api/smart-collections', asyncRoute(async (req, res) => {
    if (typeof store.listSmartCollections !== 'function') return res.json({ collections: [] });
    const collections = await store.listSmartCollections(req.user.id, {
      limit: req.query.limit,
      includeHidden: req.query.includeHidden === 'true',
    });
    return res.json({ collections });
  }));

  app.post('/api/smart-collections/refresh', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const collections = await refreshSmartCollectionsForUser(req.user.id);
    captureWorkflow(req, 'smart collections refreshed', { collectionCount: collections.length });
    return res.json({ collections });
  }));

  app.get('/api/smart-collections/:id/items', asyncRoute(async (req, res) => {
    if (typeof store.listSmartCollectionItems !== 'function') return res.status(501).json({ error: 'Smart Collections are not available.' });
    const page = await store.listSmartCollectionItems(req.user.id, req.params.id, {
      limit: req.query.limit,
      cursor: req.query.cursor,
      sort: req.query.sort,
      type: req.query.type,
      state: req.query.state,
      collection: req.query.collection,
      platform: req.query.platform,
    });
    if (!page) return res.status(404).json({ error: 'Smart Collection not found.' });
    return res.json(page);
  }));

  app.patch('/api/smart-collections/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSmartCollection !== 'function') return res.status(501).json({ error: 'Smart Collections are not available.' });
    const collection = await store.updateSmartCollection(req.user.id, req.params.id, req.body || {});
    if (!collection) return res.status(404).json({ error: 'Smart Collection not found.' });
    captureWorkflow(req, 'smart collection updated', { collectionId: req.params.id });
    return res.json({ collection });
  }));

  app.post('/api/smart-collections/:id/items/:itemId', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.setSmartCollectionItemOverride !== 'function') return res.status(501).json({ error: 'Smart Collections are not available.' });
    const collection = await store.setSmartCollectionItemOverride(
      req.user.id,
      req.params.id,
      req.params.itemId,
      req.body?.action,
    );
    if (!collection) return res.status(404).json({ error: 'Smart Collection or item not found.' });
    captureWorkflow(req, 'smart collection item override updated', { collectionId: req.params.id, itemId: req.params.itemId, action: req.body?.action || 'exclude' });
    return res.json({ collection });
  }));

  app.get('/api/library-care', asyncRoute(async (req, res) => {
    if (typeof store.getItems !== 'function') return res.status(501).json({ error: 'Library checkup is not available.' });
    return res.json(await libraryCareSummary(store, req.user.id));
  }));

  app.post('/api/library-care/check-links', importRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 20, 50));
    const result = await checkLibraryLinks({ store, userId: req.user.id, limit });
    const summary = await libraryCareSummary(store, req.user.id);
    captureWorkflow(req, 'library links checked', {
      checkedCount: result.checked?.length || 0,
      brokenCount: summary.cleanup.brokenLinkCount,
      unknownCount: (result.checked || []).filter((entry) => entry.status === 'unknown').length,
    });
    return res.json({ ...summary, checked: result.checked || [] });
  }));

  app.post('/api/items/:id/reminders', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.createItemReminder !== 'function') return res.status(501).json({ error: 'Reminders are not available.' });
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    const input = normalizeReminderInput(req.body || {});
    const reminder = await store.createItemReminder(req.user.id, item.id, input);
    if (!reminder) return res.status(404).json({ error: 'Item not found.' });
    captureWorkflow(req, 'item reminder created', { itemId: item.id, reminderId: reminder.id, reason: reminder.reason });
    return res.status(201).json({ reminder, item });
  }));

  app.patch('/api/reminders/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateItemReminder !== 'function') return res.status(501).json({ error: 'Reminders are not available.' });
    const status = ['done', 'dismissed', 'pending'].includes(req.body?.status) ? req.body.status : 'done';
    const reminder = await store.updateItemReminder(req.user.id, req.params.id, {
      status,
      completedAt: status === 'done' || status === 'dismissed' ? new Date().toISOString() : null,
    });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found.' });
    captureWorkflow(req, 'item reminder updated', { reminderId: reminder.id, status });
    return res.json({ reminder });
  }));

  app.post('/api/notes', noteUpload.array('images', MAX_NOTE_IMAGES), asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.createNoteItem !== 'function' || typeof store.addItemAsset !== 'function') {
      return res.status(501).json({ error: 'Notes are not available.' });
    }
    const input = noteInputFromBody(req.body || {});
    if (!input.body && !input.links.length && !req.files?.length) {
      return res.status(400).json({ error: 'Write a note, add a link, or attach an image before saving.' });
    }
    let item = await store.createNoteItem(req.user.id, buildNoteItem({ userId: req.user.id, input }));
    try {
      if (req.files?.length) {
        await persistNoteImages({ store, config, userId: req.user.id, itemId: item.id, files: req.files });
        item = await store.getItem(req.user.id, item.id);
      }
    } catch (error) {
      if (item?.id && typeof store.deleteSavedItem === 'function') {
        await store.deleteSavedItem(req.user.id, item.id).catch(() => {});
      }
      throw error;
    }
    captureWorkflow(req, 'note created', {
      itemId: item.id,
      linkCount: input.links.length,
      imageCount: item.assets?.length || 0,
    });
    await refreshSmartCollectionsForUser(req.user.id);
    return res.status(201).json({ item });
  }));

  app.patch('/api/notes/:id', noteUpload.array('images', MAX_NOTE_IMAGES), asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSavedItem !== 'function') return res.status(501).json({ error: 'Notes are not available.' });
    const existing = await store.getItem(req.user.id, req.params.id);
    if (!existing || existing.contentType !== NOTE_CONTENT_TYPE) return res.status(404).json({ error: 'Note not found.' });
    const input = noteInputFromBody(req.body || {});
    const assetIds = typeof req.body?.removeAssetIds === 'string'
      ? req.body.removeAssetIds.split(',').map((entry) => entry.trim()).filter(Boolean)
      : Array.isArray(req.body?.removeAssetIds)
        ? req.body.removeAssetIds
        : [];
    const existingAssets = typeof store.listItemAssets === 'function' ? await store.listItemAssets(req.user.id, existing.id) : existing.assets || [];
    const remainingCount = existingAssets.filter((asset) => !assetIds.includes(asset.id)).length;
    if (remainingCount + (req.files?.length || 0) > MAX_NOTE_IMAGES) {
      return res.status(400).json({ error: `Notes support up to ${MAX_NOTE_IMAGES} images.` });
    }
    const nextItem = buildNoteItem({
      userId: req.user.id,
      id: existing.id,
      input,
      createdAt: existing.savedAt || existing.createdAt || new Date().toISOString(),
    });
    let removedAssets = [];
    if (assetIds.length && typeof store.removeItemAssets === 'function') {
      removedAssets = await store.removeItemAssets(req.user.id, existing.id, assetIds);
      await removeNoteAssetObjects({ store, config, assets: removedAssets });
    }
    await store.updateSavedItem(req.user.id, existing.id, {
      caption: nextItem.caption,
      collections: nextItem.collections,
      sourceTitle: nextItem.sourceTitle,
      sourceAuthor: nextItem.sourceAuthor,
      sourceDescription: nextItem.sourceDescription,
      platform: nextItem.platform,
      platformKey: nextItem.platformKey,
      sourceId: nextItem.sourceId,
      status: 'done',
      error: null,
      note: nextItem.note,
    });
    if (req.files?.length) {
      await persistNoteImages({ store, config, userId: req.user.id, itemId: existing.id, files: req.files });
    }
    const item = await store.getItem(req.user.id, existing.id);
    captureWorkflow(req, 'note updated', {
      itemId: item.id,
      linkCount: input.links.length,
      imageCount: item.assets?.length || 0,
      removedImageCount: removedAssets.length,
    });
    await refreshSmartCollectionsForUser(req.user.id);
    return res.json({ item });
  }));

  app.delete('/api/notes/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.deleteSavedItem !== 'function') return res.status(501).json({ error: 'Notes are not available.' });
    const existing = await store.getItem(req.user.id, req.params.id);
    if (!existing || existing.contentType !== NOTE_CONTENT_TYPE) return res.status(404).json({ error: 'Note not found.' });
    const assets = typeof store.listItemAssets === 'function' ? await store.listItemAssets(req.user.id, existing.id) : existing.assets || [];
    const deleted = await store.deleteSavedItem(req.user.id, existing.id);
    await removeNoteAssetObjects({ store, config, assets });
    captureWorkflow(req, 'note deleted', { itemId: existing.id, imageCount: assets.length });
    await refreshSmartCollectionsForUser(req.user.id);
    return res.json({ deleted: Boolean(deleted), itemId: existing.id });
  }));

  app.get('/api/items/:id', asyncRoute(async (req, res) => {
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    return res.json({ item });
  }));

  app.post('/api/items/:id/archive', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.upsertItemArchive !== 'function') return res.status(501).json({ error: 'Page backup is not available.' });
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    if (!shouldAttemptPageArchive(item)) return res.status(400).json({ error: 'This save cannot be backed up as a readable page.' });
    const archive = await captureReadableCopyForItem({ store, userId: req.user.id, item, force: true });
    const updated = await store.getItem(req.user.id, req.params.id);
    captureWorkflow(req, archive?.status === 'ready' ? 'page backup saved' : 'page backup failed', {
      itemId: item.id,
      host: archiveHost(item.url),
      status: archive?.status || 'failed',
      errorCode: archive?.errorCode || '',
      byteSize: archive?.byteSize || 0,
    });
    return res.json({ item: updated ? { ...updated, archive: archive || updated.archive } : item, archive });
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
    captureWorkflow(req, 'review item approved', { itemId: item.id, importId });

    const jobs = item.status === 'done' ? [] : await store.createJobs({ userId: req.user.id, importId, items: [item] });
    let indexing = null;
    if (req.body?.startProcessing !== false && jobs.length) {
      indexing = await queueIndexingWork({
        reason: 'review-approve',
        userId: req.user.id,
        importId,
        shouldDownload: req.body?.download !== false,
      });
    }

    await refreshSmartCollectionsForUser(req.user.id);
    return res.json({ item, queuedJobCount: jobs.length, jobs, indexing });
  }));

  app.post('/api/items/:id/enrich', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const result = await queueSingleItemEnrichment(req, req.params.id, {
      force: req.body?.force === true,
      reason: 'detail-opened',
    });
    return res.json(result);
  }));

  app.post('/api/indexing/start', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSavedItem !== 'function' || typeof store.createJobs !== 'function') {
      return res.status(501).json({ error: 'Indexing jobs are not available.' });
    }

    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 1000, 1000));
    const allItems = await store.getItems(req.user.id);
    const pendingReviewItems = allItems.filter((item) => item.status === 'needs_review');
    const selectedItems = pendingReviewItems.slice(0, limit);
    const { items, jobs } = await approveReviewItemsForIndexing({
      store,
      userId: req.user.id,
      items: selectedItems,
    });

    let indexing = null;
    if (jobs.length && req.body?.startProcessing !== false) {
      indexing = await queueIndexingWork({
        reason: 'indexing-start',
        userId: req.user.id,
        importId: null,
        shouldDownload: req.body?.download !== false,
      });
    }

    await refreshSmartCollectionsForUser(req.user.id);
    return res.json({
      message: jobs.length ? 'Saves queued for batch indexing.' : 'No saves are waiting for indexing.',
      approvedCount: items.length,
      queuedJobCount: jobs.length,
      remainingPendingCount: Math.max(pendingReviewItems.length - selectedItems.length, 0),
      items,
      jobs,
      indexing,
    });
  }));

  app.get('/api/indexing/summary', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.getIndexingSummary !== 'function') {
      return res.status(501).json({ error: 'Indexing summary is not available.' });
    }
    const summary = await store.getIndexingSummary(req.user.id);
    return res.json({ summary });
  }));

  app.post('/api/enrichment/intent-batch', searchRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds.slice(0, 5) : [];
    const results = [];
    for (const itemId of itemIds) {
      try {
        results.push(await queueSingleItemEnrichment(req, itemId, { reason: 'search-intent' }));
      } catch (error) {
        results.push({ itemId, error: error.message });
      }
    }
    captureWorkflow(req, 'enrichment intent batch queued', {
      requestedCount: itemIds.length,
      queuedCount: results.filter((entry) => entry.queued).length,
      failedCount: results.filter((entry) => entry.error).length,
    });
    res.json({ results, processedCount: results.length });
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
    captureWorkflow(req, 'sign in activity recorded', {});
    res.json({ ok: true });
  }));

  app.post('/api/profile', asyncRoute(async (req, res) => {
    const input = validateProfileInput({
      username: req.body?.username,
      avatarUrl: req.body?.avatarUrl,
    });
    const profile = await store.saveProfile(req.user.id, input);
    captureWorkflow(req, 'profile saved', { hasAvatar: Boolean(profile.avatarUrl) });
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
    const scopes = extensionScopesFromBody(req.body || {});
    const token = await store.createExtensionToken(req.user.id, {
      tokenHash: hashExtensionToken(rawToken),
      name: cleanText(req.body?.name || 'Browser extension', 80),
      scopes,
      expiresAt: defaultExtensionExpiry(),
    });
    captureWorkflow(req, 'extension token created', { extensionTokenId: token.id, scopeCount: scopes.length });
    return res.status(201).json({ token, secret: rawToken });
  }));

  app.delete('/api/extension-tokens/:id', asyncRoute(async (req, res) => {
    if (typeof store.revokeExtensionToken !== 'function') return res.status(501).json({ error: 'Extension tokens are not available.' });
    const revoked = await store.revokeExtensionToken(req.user.id, req.params.id);
    if (!revoked) return res.status(404).json({ error: 'Extension token not found.' });
    captureWorkflow(req, 'extension token revoked', { extensionTokenId: req.params.id });
    return res.json({ revoked: true });
  }));

  app.get('/api/graph', asyncRoute(async (req, res) => {
    const items = await store.getItems(req.user.id);
    const graph = buildKnowledgeGraph(items);
    captureWorkflow(req, 'knowledge graph built', { itemCount: items.length, nodeCount: graph.nodes.length, linkCount: graph.links.length });
    res.json({ graph });
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
    captureWorkflow(req, 'obsidian graph exported', { itemCount: items.length, fileCount: files.length });
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
    captureWorkflow(req, 'credit checkout created', { purchaseId: purchase.id, checkoutSessionId: session.id, packageId: packageEntry.id, credits: packageEntry.credits });
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
      baseUrl: req.body.baseUrl,
      displayName: req.body.displayName,
      encryptionKey: config.credentialEncryptionKey,
    });
    captureWorkflow(req, 'provider credential saved', { provider: credential.provider, purpose: credential.purpose, model: credential.model, displayName: credential.displayName, credentialId: credential.id });
    res.json({ credential });
  }));

  app.delete('/api/provider-credentials/:id', asyncRoute(async (req, res) => {
    const deleted = await store.deleteProviderCredential(req.user.id, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Credential not found.' });
    captureWorkflow(req, 'provider credential deleted', { credentialId: req.params.id });
    return res.json({ deleted: true });
  }));

  app.post('/api/provider-credentials/:id/test', asyncRoute(async (req, res) => {
    const credential = await store.getProviderCredential(req.user.id, req.params.id, config.credentialEncryptionKey);
    if (!credential) return res.status(404).json({ error: 'Credential not found.' });
    await testProviderCredential({ credential });
    captureWorkflow(req, 'provider credential tested', { credentialId: req.params.id, provider: credential.provider, purpose: credential.purpose, model: credential.model });
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
    if (!files.length) return res.status(400).json({ error: 'Upload Instagram, Pinterest, or X bookmark export files.' });

    files.forEach((file) => assertImportFileAllowed(file, config.maxUploadFileSizeBytes || 25 * 1024 * 1024));
    const result = await createImportFromFiles({ store, userId: req.user.id, files, config });
    if (result.queuedJobCount) {
      result.indexing = await queueIndexingWork({
        reason: 'import-upload',
        userId: req.user.id,
        importId: result.import.id,
        shouldDownload: false,
      });
    }
    captureWorkflow(req, 'import completed', {
      importId: result.import.id,
      source: result.import.source,
      fileCount: files.length,
      newItemCount: result.newItemCount,
      queuedJobCount: result.queuedJobCount,
    });
    await refreshSmartCollectionsForUser(req.user.id);
    return res.json(result);
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
      const storagePath = storagePathForUpload(req.user.id, file.originalname);
      uploads.push({
        path: storagePath,
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
      });
    }

    res.json({ bucket, uploads });
  }));

  app.post('/api/imports/upload-chunk', chunkUpload.single('chunk'), asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (!store.client?.storage) return res.status(503).json({ error: 'Large file upload storage is not configured.' });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Upload chunk is missing.' });

    const storagePath = String(req.body?.path || '').replace(/^\/+/, '');
    if (!storagePath || !storagePathBelongsToUser(req.user.id, storagePath)) {
      return res.status(400).json({ error: 'Uploaded file path is invalid.' });
    }

    const index = Number(req.body?.index);
    const totalChunks = parseChunkCount(req.body?.totalChunks);
    if (!Number.isInteger(index) || index < 0 || !totalChunks || index >= totalChunks) {
      return res.status(400).json({ error: 'Upload chunk index is invalid.' });
    }

    const bucket = await ensureImportUploadBucket(store, config);
    const partPath = chunkPartPath(storagePath, index);
    const { error } = await store.client.storage.from(bucket).upload(partPath, req.file.buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
    if (error) throw error;
    res.json({ path: storagePath, partPath, index, totalChunks });
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

    let result;
    try {
      result = await createImportFromFiles({ store, userId: req.user.id, files, config });
    } finally {
      if (pathsToRemove.length) {
        await store.client.storage.from(bucket).remove(pathsToRemove).catch((error) => {
          console.warn(`Could not remove import upload files: ${error.message}`);
        });
      }
    }
    if (result.queuedJobCount) {
      result.indexing = await queueIndexingWork({
        reason: 'storage-import',
        userId: req.user.id,
        importId: result.import.id,
        shouldDownload: false,
      });
    }
    captureWorkflow(req, 'storage import completed', {
      importId: result.import.id,
      source: result.import.source,
      fileCount: storageFiles.length,
      newItemCount: result.newItemCount,
      queuedJobCount: result.queuedJobCount,
    });
    await refreshSmartCollectionsForUser(req.user.id);
    return res.json(result);
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
    const initialStatus = req.body?.review === true ? 'needs_review' : 'queued';
    const items = await store.upsertImportData({ userId: req.user.id, importId: importEntry.id, parsed, initialStatus });
    const jobs = initialStatus === 'queued' ? await store.createJobs({ userId: req.user.id, importId: importEntry.id, items }) : [];
    let responseItem = null;
    try {
      responseItem = await Promise.resolve(store.getItem(req.user.id, items[0]?.id || parsed.items[0].id));
    } catch {
      responseItem = null;
    }
    if (responseItem) {
      const archive = await startReadableCopyForItem({ req, store, userId: req.user.id, item: responseItem });
      if (archive) responseItem = { ...responseItem, archive };
    }

    let indexing = null;
    if (jobs.length) {
      indexing = await queueIndexingWork({
        reason: 'manual-link',
        userId: req.user.id,
        importId: importEntry.id,
        shouldDownload: false,
      });
    }
    captureWorkflow(req, 'manual save created', {
      importId: importEntry.id,
      newItemCount: items.length,
      initialStatus,
    });

    await refreshSmartCollectionsForUser(req.user.id);
    return res.status(201).json({
      import: importEntry,
      item: responseItem || items[0] || parsed.items[0],
      newItemCount: items.length,
      skippedDuplicateCount: items.length ? 0 : 1,
      queuedJobCount: jobs.length,
      indexing,
    });
  }));

  app.post('/api/imports/:id/process', asyncRoute(async (req, res) => {
    const jobs = await store.getJobs(req.user.id, req.params.id);
    const indexing = await queueIndexingWork({
      reason: 'import-process',
      userId: req.user.id,
      importId: req.params.id,
      shouldDownload: req.body?.download !== false,
    });

    res.json({ message: 'Batch indexing queued', jobCount: jobs.length, indexing });
  }));

  app.post('/api/jobs/restart', asyncRoute(async (req, res) => {
    const importId = req.body?.importId || null;
    const resetCount = typeof store.restartJobs === 'function' ? await store.restartJobs(req.user.id, importId) : 0;
    const jobs = await store.getJobs(req.user.id, importId);
    let indexing = null;
    if (req.body?.start !== false) {
      indexing = await queueIndexingWork({
        reason: 'jobs-restart',
        userId: req.user.id,
        importId,
        shouldDownload: req.body?.download !== false,
      });
    }

    res.json({
      message: 'Queue restart requested',
      resetCount,
      jobCount: jobs.length,
      indexing,
    });
  }));

  app.get('/api/jobs/:id', asyncRoute(async (req, res) => {
    const job = await store.getJob(req.user.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    return res.json({ job });
  }));

  app.post('/api/search', searchRateLimit, asyncRoute(async (req, res) => {
    const rawQuery = String(req.body.query || '').trim();
    const query = rawQuery.slice(0, 240);
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
    const searchEventId = createSearchEventId();
    if (typeof store.recordSearchEvent === 'function') {
      await store.recordSearchEvent({
        id: searchEventId,
        userId: req.user.id,
        query: results.length === 0 ? query : '',
        queryLength: rawQuery.length,
        filters: req.body.filters || {},
        resultCount: results.length,
        includeAi: Boolean(req.body.includeAi),
        resultIds: results.map((item) => item.id),
      });
    }
    captureWorkflow(req, 'search completed', {
      searchEventId,
      resultCount: results.length,
      hasFilters: Boolean(Object.keys(req.body.filters || {}).length),
      includeAi: Boolean(req.body.includeAi),
      noResults: results.length === 0,
    });
    res.json({ results, ai, searchEventId });
  }));

  app.post('/api/visual-search', searchRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (!config.credentialEncryptionKey || typeof store.getPreferredProviderCredential !== 'function') {
      return res.status(428).json({ error: 'Connect a media AI key before using Same Vibe Search.' });
    }
    const mediaCredential = await store.getPreferredProviderCredential(req.user.id, 'media', config.credentialEncryptionKey);
    const described = await describeLensCrop({ dataUrl: req.body?.imageDataUrl, credential: mediaCredential });
    const allItems = await store.getItems(req.user.id);
    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 24, 60));
    const results = findSimilarVisualItems(allItems, described.analysis, { limit });
    const searchEventId = createSearchEventId();
    if (typeof store.recordSearchEvent === 'function') {
      await store.recordSearchEvent({
        id: searchEventId,
        userId: req.user.id,
        query: '',
        queryLength: 0,
        filters: { type: 'visual' },
        resultCount: results.length,
        includeAi: false,
        resultIds: results.map((item) => item.id),
      });
    }
    captureWorkflow(req, 'visual search completed', {
      searchEventId,
      resultCount: results.length,
      hasImageAnalysis: true,
    });
    res.json({
      results,
      searchEventId,
      visualSearch: publicVisualSearchAnalysis(described.analysis, described.query),
    });
  }));

  app.post('/api/search/feedback', searchRateLimit, asyncRoute(async (req, res) => {
    if (typeof store.recordSearchFeedback !== 'function') {
      return res.status(501).json({ error: 'Search feedback is not available for this store.' });
    }
    const searchEventId = String(req.body.searchEventId || '').trim();
    const itemId = String(req.body.itemId || '').trim();
    const rating = String(req.body.rating || '').trim();
    const reason = String(req.body.reason || '').trim();
    if (!searchEventId || !itemId || !['helpful', 'not_helpful'].includes(rating)) {
      return res.status(400).json({ error: 'Search feedback requires a search event, item, and valid rating.' });
    }
    const feedback = await store.recordSearchFeedback({
      userId: req.user.id,
      searchEventId,
      itemId,
      rating,
      reason,
    });
    captureWorkflow(req, 'search feedback recorded', {
      searchEventId,
      itemId,
      rating,
    });
    res.status(201).json({ feedback });
  }));

  app.use((error, req, res, _next) => {
    const statusCode = error.statusCode || (error instanceof multer.MulterError || /Upload Instagram|bookmark export/.test(error.message) ? 400 : 500);
    const properties = contextForRequest(req, { statusCode });
    if (statusCode >= 500) {
      req.app?.locals?.observability?.captureError(error, properties, req.user?.id || 'server');
    } else {
      warnWorkflow(req, 'api request rejected', { statusCode, errorCategory: error.name || 'request_error' });
    }
    res.status(statusCode).json({
      error: error.message,
      requestId: req.context?.requestId,
      ...(error.deletion ? { deletion: error.deletion } : {}),
    });
  });

  return app;
}

function startProcessing({ store, userId, importId, config, shouldDownload = false, maxJobs = null }) {
  runProcessImportJobs({ store, userId, importId, config, shouldDownload, maxJobs: maxJobs || config.workerBatchSize || 2 }).catch((error) => {
    console.error('Background processing failed:', error);
  });
}

function runProcessImportJobs({ store, userId, importId, config, shouldDownload = false, maxJobs = null }) {
  return processImportJobs({
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
    maxJobs: maxJobs || config.workerBatchSize || 2,
    leaseOwner: config.workerLeaseOwner,
    leaseMs: config.workerLeaseMs,
    perUserConcurrency: config.workerPerUserConcurrency || 1,
    maxAttempts: config.workerMaxAttempts || 3,
    retryBackoffMs: config.workerRetryBackoffMs,
    maxRetryBackoffMs: config.workerMaxRetryBackoffMs,
  });
}

module.exports = {
  createApp,
};
