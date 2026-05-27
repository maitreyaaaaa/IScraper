const path = require('path');
const { parseImportExport } = require('./exportParser');

const IMPORT_UPLOAD_BUCKET = 'import-uploads';
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

function storagePathBelongsToUser(userId, storagePath = '') {
  const normalized = String(storagePath).replace(/^\/+/, '');
  return normalized === String(userId) || normalized.startsWith(`${userId}/`);
}

function parseChunkCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 && count <= 100 ? count : 0;
}

function chunkPartPath(storagePath, index) {
  return `${storagePath}.parts/${String(index).padStart(5, '0')}`;
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

async function createImportRecordsFromFiles({ store, userId, importId, files, trace = {} }) {
  const parsed = await parseImportExport(files);
  if (!parsed.items.length) {
    const error = new Error('No saves were found in those files. Upload Instagram saved-post ZIP/HTML/JSON files or Pinterest export ZIP/JSON/CSV files.');
    error.statusCode = 400;
    throw error;
  }

  const items = await store.upsertImportData({
    userId,
    importId,
    parsed,
    initialStatus: 'queued',
    duplicateMode: 'skipExisting',
  });
  const jobs = typeof store.createJobs === 'function'
    ? await store.createJobs({
      userId,
      importId,
      items,
      requestId: trace.requestId || '',
      correlationId: trace.correlationId || '',
      sourceAction: trace.sourceAction || 'storage-import',
    })
    : [];

  return {
    itemCount: parsed.items.length,
    totalItemCount: parsed.items.length,
    newItemCount: items.length,
    skippedDuplicateCount: parsed.items.length - items.length,
    queuedJobCount: jobs.length,
    jobCount: jobs.length,
    jobs,
    source: parsed.source || 'user-export',
    requestId: trace.requestId || '',
    correlationId: trace.correlationId || '',
  };
}

async function processStorageImport({ store, config, importEntry }) {
  const claimed = await store.claimStorageImport(importEntry.id);
  if (!claimed) return null;

  try {
    const { files, bucket, pathsToRemove } = await loadImportFilesFromStorage({
      store,
      userId: claimed.userId,
      storageFiles: claimed.storageFiles || [],
      config,
    });

    let result;
    try {
      result = await createImportRecordsFromFiles({
        store,
        userId: claimed.userId,
        importId: claimed.id,
        files,
        trace: {
          requestId: claimed.requestId || '',
          correlationId: claimed.correlationId || claimed.requestId || '',
          sourceAction: 'storage-import',
        },
      });
    } finally {
      if (pathsToRemove.length) {
        await store.client.storage.from(bucket).remove(pathsToRemove).catch((error) => {
          console.warn(`Could not remove import upload files: ${error.message}`);
        });
      }
    }

    await store.updateImportStatus(claimed.id, 'imported', null);
    return { importId: claimed.id, status: 'imported', ...result };
  } catch (error) {
    await store.updateImportStatus(claimed.id, 'failed', error.message);
    return { importId: claimed.id, status: 'failed', error: error.message };
  }
}

async function processPendingStorageImports({ store, config, limit = 1 } = {}) {
  if (typeof store.getPendingStorageImports !== 'function') return [];
  const pending = await store.getPendingStorageImports({ limit });
  const results = [];
  for (const importEntry of pending) {
    const result = await processStorageImport({ store, config, importEntry });
    if (result) results.push(result);
  }
  return results;
}

module.exports = {
  assertImportFileAllowed,
  createImportRecordsFromFiles,
  loadImportFilesFromStorage,
  processPendingStorageImports,
  processStorageImport,
  storagePathBelongsToUser,
};
