const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const { createObservability, recordRequestTiming } = require('./services/observability');
const {
  MAX_NOTE_IMAGES,
  MAX_NOTE_IMAGE_BYTES,
} = require('./services/notes');
const { registerAdminRoutes } = require('./routes/adminRoutes');
const { registerAccountRoutes } = require('./routes/accountRoutes');
const { registerDataExportRoutes } = require('./routes/dataExportRoutes');
const { registerImportRoutes } = require('./routes/importRoutes');
const { registerLibraryRoutes } = require('./routes/libraryRoutes');
const { registerPrivateIntegrationRoutes } = require('./routes/integrationPrivateRoutes');
const { registerPublicIntegrationRoutes } = require('./routes/integrationRoutes');
const { registerRawIntegrationRoutes } = require('./routes/integrationRawRoutes');
const { registerPrivateSearchRoutes } = require('./routes/searchPrivateRoutes');
const { registerPublicSearchRoutes } = require('./routes/searchRoutes');
const { registerPublicRoutes } = require('./routes/publicRoutes');
const { registerWorkerRoutes } = require('./routes/workerRoutes');
const { createWorkflows } = require('./application');
const {
  assertAdmin,
  assertWorker,
  getAgentUser,
  getExtensionUser,
  getUser,
  requireAccountNotDeleting,
  requireCompletedProfile,
} = require('./http/auth');
const { asyncRoute, createErrorHandler } = require('./http/errors');
const { clientIp, createInMemoryRateLimitStore, createRateLimiter } = require('./http/rateLimit');
const { securityHeaders } = require('./http/security');
const {
  IMPORT_CHUNK_SIZE_BYTES,
  noteImageFileFilter,
  uploadFileFilter,
} = require('./http/uploads');
const { captureWorkflow, cleanText, warnWorkflow } = require('./application/common');

function createApp({ store, config = {}, observability = createObservability(config) }) {
  const app = express();
  const authUserCache = new Map();
  const ensuredUserCache = new Map();
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
  const rateLimitStore = config.rateLimitStore || createInMemoryRateLimitStore();
  const generalRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.rateLimitMax || 600, name: 'general', namespace: rateLimitNamespace, store: rateLimitStore });
  const feedbackRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.feedbackRateLimitMax || 20, name: 'feedback', namespace: rateLimitNamespace, store: rateLimitStore });
  const importRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.importRateLimitMax || 10, name: 'import', namespace: rateLimitNamespace, store: rateLimitStore });
  const searchRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: config.searchRateLimitMax || 180, name: 'search', namespace: rateLimitNamespace, store: rateLimitStore });
  const checkoutRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.checkoutRateLimitMax || 10, name: 'checkout', namespace: rateLimitNamespace, store: rateLimitStore });
  const adminRateLimit = createRateLimiter({ windowMs: rateWindowMs, max: config.adminRateLimitMax || 30, name: 'admin', namespace: rateLimitNamespace, store: rateLimitStore });
  const workerRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: config.workerRateLimitMax || 30, name: 'worker', namespace: rateLimitNamespace, store: rateLimitStore });
  const allowedOrigins = new Set((config.corsOrigins || []).map((origin) => String(origin).replace(/\/$/, '')));
  const http = {
    asyncRoute,
    clientIp,
    cleanText,
    captureWorkflow,
    warnWorkflow,
    auth: {
      assertAdmin,
      assertWorker,
      getAgentUser,
      getExtensionUser,
      getUser,
      requireAccountNotDeleting,
      requireCompletedProfile,
    },
    rateLimiters: {
      adminRateLimit,
      checkoutRateLimit,
      feedbackRateLimit,
      importRateLimit,
      rateLimitStore,
      searchRateLimit,
      workerRateLimit,
    },
    uploaders: {
      chunkUpload,
      noteUpload,
      upload,
    },
  };
  const workflows = createWorkflows({
    store,
    config,
    http,
    observability,
  });
  const deps = { store, config, http, workflows };


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

  registerRawIntegrationRoutes(app, deps);

  app.use(express.json({ limit: config.jsonBodyLimit || '1mb' }));

  registerPublicRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerWorkerRoutes(app, deps);
  registerPublicSearchRoutes(app, deps);
  registerPublicIntegrationRoutes(app, deps);

  app.use(asyncRoute(async (req, _res, next) => {
    const authStartedAt = process.hrtime.bigint();
    let user;
    try {
      user = await getCachedUser(req, store, config, authUserCache);
    } finally {
      recordRequestTiming(req, 'authMs', authStartedAt);
    }
    if (typeof store.assertUserNotDeleted === 'function') {
      const safetyStartedAt = process.hrtime.bigint();
      await store.assertUserNotDeleted(user.id, user.email);
      recordRequestTiming(req, 'accountSafetyMs', safetyStartedAt);
    }
    const setupStartedAt = process.hrtime.bigint();
    await ensureUserRecordCached(user, store, config, ensuredUserCache);
    recordRequestTiming(req, 'userSetupMs', setupStartedAt);
    req.user = user;
    next();
  }));

  registerAccountRoutes(app, deps);
  registerDataExportRoutes(app, deps);
  registerLibraryRoutes(app, deps);
  registerPrivateIntegrationRoutes(app, deps);
  registerImportRoutes(app, deps);
  registerPrivateSearchRoutes(app, deps);

  app.use(createErrorHandler({ multer, warnWorkflow }));

  return app;
}

function bearerToken(req) {
  const auth = req.header('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
}

function cacheKeyForToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function jwtExpiresAtMs(token) {
  const [, payload] = String(token || '').split('.');
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp = Number(decoded.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function getCachedUser(req, store, config, cache) {
  const token = bearerToken(req);
  const ttlMs = Math.max(0, Number(config.authUserCacheTtlMs ?? 60_000));
  if (!token || typeof store.getUserFromToken !== 'function' || ttlMs === 0) {
    return getUser(req, store);
  }

  const now = Date.now();
  const key = cacheKeyForToken(token);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.user;

  const user = await store.getUserFromToken(token);
  const jwtExpiresAt = jwtExpiresAtMs(token);
  const ttlExpiresAt = now + ttlMs;
  cache.set(key, {
    user,
    expiresAt: jwtExpiresAt ? Math.min(jwtExpiresAt, ttlExpiresAt) : ttlExpiresAt,
  });
  pruneCache(cache, now);
  return user;
}

async function ensureUserRecordCached(user, store, config, cache) {
  const ensureUserRecord = typeof store.ensureUserRecord === 'function'
    ? store.ensureUserRecord.bind(store)
    : store.ensureUser?.bind(store);
  if (!ensureUserRecord) return;

  const ttlMs = Math.max(0, Number(config.userSetupCacheTtlMs ?? 10 * 60_000));
  const key = `${user.id}:${user.email || ''}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (ttlMs > 0 && cached && cached.expiresAt > now) return;

  await ensureUserRecord(user.id, user.email);
  if (ttlMs > 0) {
    cache.set(key, { expiresAt: now + ttlMs });
    pruneCache(cache, now);
  }
}

function pruneCache(cache, now = Date.now(), maxSize = 5000) {
  if (cache.size <= maxSize) return;
  for (const [key, value] of cache.entries()) {
    if (!value?.expiresAt || value.expiresAt <= now || cache.size > maxSize) cache.delete(key);
  }
}

module.exports = {
  createApp,
};
