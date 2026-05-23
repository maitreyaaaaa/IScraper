const path = require('path');
const { parseImportExport } = require('./exportParser');

const ALLOWED_EXTENSIONS = new Set(['.html', '.htm', '.zip', '.json', '.csv']);
const ALLOWED_MIME_TYPES = new Set([
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

function validateStorageFile(file, { userId, maxUploadFileSizeBytes = 25 * 1024 * 1024 }) {
  const name = String(file?.name || path.basename(String(file?.path || '')) || '').trim();
  const storagePath = String(file?.path || '').trim();
  const type = String(file?.type || '').trim();
  const size = Number(file?.size || 0);
  const extension = path.extname(name).toLowerCase();

  if (!storagePath || !storagePathBelongsToUser(storagePath, userId)) {
    throw new Error('Uploaded file path is not valid for this user.');
  }
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(type)) {
    throw new Error('Upload Instagram HTML files or Pinterest export ZIP/JSON/CSV files.');
  }
  if (size > maxUploadFileSizeBytes) {
    throw new Error('Uploaded file is too large.');
  }

  return {
    path: storagePath,
    name,
    type,
    size,
  };
}

function sourceTypeFromImportSource(source) {
  if (source === 'instagram-export') return 'instagram';
  if (source === 'pinterest-export') return 'pinterest';
  return 'auto';
}

function storagePathBelongsToUser(storagePath, userId) {
  const normalized = String(storagePath || '').replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  return normalized.startsWith(`${userId}/imports/`);
}

async function loadImportFilesFromStorage({ store, bucket, storageFiles }) {
  if (!store.client?.storage) {
    const error = new Error('Supabase storage is required for large upload imports.');
    error.statusCode = 428;
    throw error;
  }
  const storage = store.client.storage.from(bucket);
  const files = [];
  for (const file of storageFiles) {
    const { data, error } = await storage.download(file.path);
    if (error) throw error;
    const arrayBuffer = await data.arrayBuffer();
    files.push({
      originalname: file.name || path.basename(file.path),
      mimetype: file.type || '',
      size: file.size || arrayBuffer.byteLength,
      buffer: Buffer.from(arrayBuffer),
    });
  }
  return files;
}

async function removeImportFilesFromStorage({ store, bucket, storageFiles }) {
  if (!store.client?.storage || !storageFiles.length) return;
  await store.client.storage.from(bucket).remove(storageFiles.map((file) => file.path));
}

async function processStorageImport({ store, config, importEntry }) {
  const claimed = await store.claimStorageImport(importEntry.id);
  if (!claimed) return { importId: importEntry.id, claimed: false, items: 0, jobs: 0 };

  try {
    const files = await loadImportFilesFromStorage({
      store,
      bucket: config.importUploadBucket,
      storageFiles: claimed.storageFiles || [],
    });
    const parsed = await parseImportExport(files, { sourceType: sourceTypeFromImportSource(claimed.source) });
    if (!parsed.items.length) {
      throw new Error('No saves were found in those files. Upload an Instagram export ZIP/saved_posts file or the Pinterest export ZIP/JSON/CSV.');
    }
    const items = await store.upsertImportData({ userId: claimed.userId, importId: claimed.id, parsed });
    await store.updateImportStatus(claimed.id, 'imported');
    await removeImportFilesFromStorage({ store, bucket: config.importUploadBucket, storageFiles: claimed.storageFiles || [] });
    return {
      importId: claimed.id,
      claimed: true,
      items: items.length,
      totalItems: parsed.items.length,
      jobs: 0,
    };
  } catch (error) {
    await store.updateImportStatus(claimed.id, 'failed', error.message);
    throw error;
  }
}

module.exports = {
  processStorageImport,
  validateStorageFile,
};
