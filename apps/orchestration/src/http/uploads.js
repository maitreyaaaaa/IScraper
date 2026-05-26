const crypto = require('crypto');
const path = require('path');
const {
  MAX_NOTE_IMAGE_BYTES,
  NOTE_ASSET_BUCKET,
  assertNoteImageFile,
} = require('../services/notes');

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

module.exports = {
  EXPORT_UPLOAD_EXTENSIONS,
  EXPORT_UPLOAD_MIME_TYPES,
  IMPORT_CHUNK_SIZE_BYTES,
  IMPORT_UPLOAD_BUCKET,
  assertImportFileAllowed,
  chunkPartPath,
  ensureImportUploadBucket,
  ensureNoteAssetBucket,
  fileNameForStorage,
  loadImportFilesFromStorage,
  noteImageFileFilter,
  parseChunkCount,
  signedUploadFileFromBody,
  storagePathBelongsToUser,
  storagePathForUpload,
  uploadFileFilter,
};
