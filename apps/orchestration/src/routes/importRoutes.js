const {
  assertImportFileAllowed,
  chunkPartPath,
  ensureImportUploadBucket,
  loadImportFilesFromStorage,
  parseChunkCount,
  signedUploadFileFromBody,
  storagePathBelongsToUser,
  storagePathForUpload,
} = require('../http/uploads');
const { traceForRequest } = require('../services/observability');

function registerImportRoutes(app, deps) {
  const { config, http, store, workflows } = deps;
  const { asyncRoute, captureWorkflow } = http;
  const { requireCompletedProfile } = http.auth;
  const { importRateLimit } = http.rateLimiters;
  const { chunkUpload, upload } = http.uploaders;
  const { createImportFromFiles, parseManualLinkPayload } = workflows.imports;
  const { refreshSmartCollectionsForUser } = workflows.library;
  const { queueIndexingWork } = workflows.worker;
  const { startReadableCopyForItem } = workflows.archive;

  app.post('/api/imports', importRateLimit, upload.array('exportFiles', 20), asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const trace = traceForRequest(req);
    const files = req.files?.length ? req.files : req.file ? [req.file] : [];
    if (!files.length) return res.status(400).json({ error: 'Upload Instagram, Pinterest, or X bookmark export files.' });

    files.forEach((file) => assertImportFileAllowed(file, config.maxUploadFileSizeBytes || 25 * 1024 * 1024));
    const result = await createImportFromFiles({ userId: req.user.id, files, trace });
    if (result.queuedJobCount) {
      result.indexing = await queueIndexingWork({
        reason: 'import-upload',
        userId: req.user.id,
        importId: result.import.id,
        shouldDownload: false,
        requestId: trace.requestId,
        correlationId: trace.correlationId,
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
    return res.json({ ...result, requestId: trace.requestId, correlationId: trace.correlationId });
  }));

  app.post('/api/imports/upload-urls', importRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const trace = traceForRequest(req);
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

    res.json({ bucket, uploads, requestId: trace.requestId, correlationId: trace.correlationId });
  }));

  app.post('/api/imports/upload-chunk', chunkUpload.single('chunk'), asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const trace = traceForRequest(req);
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
    res.json({ path: storagePath, partPath, index, totalChunks, requestId: trace.requestId, correlationId: trace.correlationId });
  }));

  app.post('/api/imports/storage', importRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const trace = traceForRequest(req);
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
      result = await createImportFromFiles({ userId: req.user.id, files, trace: { ...trace, sourceAction: 'storage-import' } });
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
        requestId: trace.requestId,
        correlationId: trace.correlationId,
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
    return res.json({ ...result, requestId: trace.requestId, correlationId: trace.correlationId });
  }));

  app.post('/api/saves/link', importRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const trace = traceForRequest(req);
    const parsed = parseManualLinkPayload(req.body || {});
    const importEntry = await store.createImport({
      userId: req.user.id,
      source: 'manual-link',
      mode: 'export',
      fileNames: [parsed.items[0].url],
      requestId: trace.requestId,
      correlationId: trace.correlationId,
    });
    const initialStatus = req.body?.review === true ? 'needs_review' : 'queued';
    const items = await store.upsertImportData({ userId: req.user.id, importId: importEntry.id, parsed, initialStatus });
    const jobs = initialStatus === 'queued'
      ? await store.createJobs({ userId: req.user.id, importId: importEntry.id, items, ...trace, sourceAction: 'manual-link' })
      : [];
    let responseItem = null;
    try {
      responseItem = await Promise.resolve(store.getItem(req.user.id, items[0]?.id || parsed.items[0].id));
    } catch {
      responseItem = null;
    }
    if (responseItem) {
      const archive = await startReadableCopyForItem({ req, userId: req.user.id, item: responseItem });
      if (archive) responseItem = { ...responseItem, archive };
    }

    let indexing = null;
    if (jobs.length) {
      indexing = await queueIndexingWork({
        reason: 'manual-link',
        userId: req.user.id,
        importId: importEntry.id,
        shouldDownload: false,
        requestId: trace.requestId,
        correlationId: trace.correlationId,
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
      requestId: trace.requestId,
      correlationId: trace.correlationId,
    });
  }));

  app.post('/api/imports/:id/process', asyncRoute(async (req, res) => {
    const jobs = await store.getJobs(req.user.id, req.params.id);
    const trace = traceForRequest(req);
    const indexing = await queueIndexingWork({
      reason: 'import-process',
      userId: req.user.id,
      importId: req.params.id,
      shouldDownload: req.body?.download !== false,
      requestId: trace.requestId,
      correlationId: trace.correlationId,
    });

    res.json({ message: 'Batch indexing queued', jobCount: jobs.length, indexing, requestId: trace.requestId, correlationId: trace.correlationId });
  }));

  app.post('/api/jobs/restart', asyncRoute(async (req, res) => {
    const importId = req.body?.importId || null;
    const trace = traceForRequest(req);
    const resetCount = typeof store.restartJobs === 'function' ? await store.restartJobs(req.user.id, importId) : 0;
    const jobs = await store.getJobs(req.user.id, importId);
    let indexing = null;
    if (req.body?.start !== false) {
      indexing = await queueIndexingWork({
        reason: 'jobs-restart',
        userId: req.user.id,
        importId,
        shouldDownload: req.body?.download !== false,
        requestId: trace.requestId,
        correlationId: trace.correlationId,
      });
    }

    res.json({
      message: 'Queue restart requested',
      resetCount,
      jobCount: jobs.length,
      indexing,
      requestId: trace.requestId,
      correlationId: trace.correlationId,
    });
  }));

  app.get('/api/jobs/:id', asyncRoute(async (req, res) => {
    const job = await store.getJob(req.user.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    return res.json({ job });
  }));
}

module.exports = {
  registerImportRoutes,
};
