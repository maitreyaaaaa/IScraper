const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const { createObservability } = require('./services/observability');
const {
  MAX_NOTE_IMAGES,
  MAX_NOTE_IMAGE_BYTES,
} = require('./services/notes');
const { registerAdminRoutes } = require('./routes/adminRoutes');
const { registerAccountRoutes } = require('./routes/accountRoutes');
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
    const user = await getUser(req, store);
    await store.ensureUser(user.id, user.email);
    req.user = user;
    next();
  }));

  registerAccountRoutes(app, deps);
  registerLibraryRoutes(app, deps);
  registerPrivateIntegrationRoutes(app, deps);
  registerImportRoutes(app, deps);
  registerPrivateSearchRoutes(app, deps);

  app.use(createErrorHandler({ multer, warnWorkflow }));

  return app;
}

module.exports = {
  createApp,
};
