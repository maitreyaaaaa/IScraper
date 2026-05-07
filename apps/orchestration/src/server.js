const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parseInstagramExport, validateLoginScrapeConsent } = require('./services/instagramParser');
const { processImportJobs } = require('./services/worker');
const { createOpenRouterEmbedding } = require('./services/embeddings');

const upload = multer({ storage: multer.memoryStorage() });

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

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createApp({ store, config = {} }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

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

  app.post('/api/imports', upload.array('exportFiles', 20), asyncRoute(async (req, res) => {
    const files = req.files?.length ? req.files : req.file ? [req.file] : [];
    if (!files.length) return res.status(400).json({ error: 'Upload saved_posts.html and optionally saved_collections.html.' });

    const mode = req.body.mode || 'export';
    if (mode === 'login-scrape' && !validateLoginScrapeConsent(req.body.confirmEmail, req.user.email)) {
      return res.status(403).json({
        error: 'Login scrape is risky. Type your account email exactly to confirm.',
      });
    }

    const parsed = parseInstagramExport(files);
    const importEntry = await store.createImport({
      userId: req.user.id,
      source: mode === 'login-scrape' ? 'instagram-login' : 'instagram-export',
      mode,
      fileNames: files.map((file) => file.originalname),
    });
    const items = await store.upsertImportData({ userId: req.user.id, importId: importEntry.id, parsed });
    const jobs = await store.createJobs({ userId: req.user.id, importId: importEntry.id, items });

    res.json({
      import: importEntry,
      itemCount: items.length,
      collectionCount: parsed.collections.length,
      jobCount: jobs.length,
    });
  }));

  app.post('/api/imports/:id/process', asyncRoute(async (req, res) => {
    const jobs = await store.getJobs(req.user.id, req.params.id);
    processImportJobs({
      store,
      userId: req.user.id,
      importId: req.params.id,
      videoDir: config.videoDir,
      shouldDownload: req.body?.download !== false,
      geminiApiKey: config.geminiApiKey,
      openRouterApiKey: config.openRouterApiKey,
      openRouterModel: config.openRouterModel,
      openRouterEmbeddingModel: config.openRouterEmbeddingModel,
      embeddingDimensions: config.embeddingDimensions,
    }).catch((error) => {
      console.error('Background processing failed:', error);
    });

    res.json({ message: 'Processing started', jobCount: jobs.length });
  }));

  app.get('/api/jobs/:id', asyncRoute(async (req, res) => {
    const job = await store.getJob(req.user.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    return res.json({ job });
  }));

  app.post('/api/search', asyncRoute(async (req, res) => {
    const query = req.body.query || '';
    let queryEmbedding = null;
    if (query && config.openRouterApiKey && store.supportsSemanticSearch) {
      try {
        queryEmbedding = await createOpenRouterEmbedding({
          apiKey: config.openRouterApiKey,
          model: config.openRouterEmbeddingModel,
          input: query,
          dimensions: config.embeddingDimensions,
          inputType: 'search_query',
        });
      } catch (error) {
        console.warn(`Semantic query embedding failed: ${error.message}`);
      }
    }

    const results = await store.search(req.user.id, query, req.body.filters || {}, { queryEmbedding });
    res.json({ results });
  }));

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message });
  });

  return app;
}

module.exports = {
  createApp,
};
