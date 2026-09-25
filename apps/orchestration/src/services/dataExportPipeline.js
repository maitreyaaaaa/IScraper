const JSZip = require('jszip');
const { getUserDataMap, getUserDataCategories } = require('./userDataRegistry');
const { NOTE_ASSET_BUCKET } = require('./notes');
const { storagePathBelongsToUser } = require('./storageImports');
const { sanitizeAuditString } = require('./auditLog');

const DATA_EXPORT_BUCKET = 'user-data-exports';
const DATA_EXPORT_FORMAT = 'zip';
const DATA_EXPORT_RETENTION_DAYS = 7;
const DEFAULT_MEDIA_EXPORT_MAX_BYTES = 250 * 1024 * 1024;
const DEFAULT_MEDIA_EXPORT_MAX_FILES = 500;
const IMPORT_UPLOAD_BUCKET = 'import-uploads';

function exportExpiresAt(now = new Date()) {
  return new Date(now.getTime() + DATA_EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function buildUserDataExport({ store, userId, requestId, correlationId = '', includeFiles = false, mediaLimits = {} }) {
  const exportedAt = new Date().toISOString();
  const [account, privacy, payload] = await Promise.all([
    store.getAccountSummary(userId),
    store.getPrivacyExport(userId),
    typeof store.getDataExportPayload === 'function' ? store.getDataExportPayload(userId) : Promise.resolve(null),
  ]);
  const exportData = payload || buildPayloadFromPrivacyExport(privacy);
  const dataMap = getUserDataMap();
  const categories = getUserDataCategories();
  const mediaManifest = createMediaManifest({
    includeFiles,
    maxBytes: mediaLimits.maxBytes || DEFAULT_MEDIA_EXPORT_MAX_BYTES,
    maxFiles: mediaLimits.maxFiles || DEFAULT_MEDIA_EXPORT_MAX_FILES,
  });
  const manifest = {
    version: 1,
    requestId,
    correlationId: correlationId || requestId,
    exportedAt,
    format: DATA_EXPORT_FORMAT,
    options: {
      includeFiles,
      mediaLimits: {
        maxBytes: mediaManifest.limits.maxBytes,
        maxFiles: mediaManifest.limits.maxFiles,
      },
    },
    account: {
      publicRef: account?.publicRef || null,
      email: account?.email || null,
    },
    categories: categories.map(({ key, label, exportPath, classification, sensitivity, redaction }) => ({
      key,
      label,
      exportPath,
      classification,
      sensitivity,
      redaction,
    })),
    redactionNotes: [
      'Raw access tokens, token hashes, auth sessions, service role data, and internal deletion hashes are not included.',
      includeFiles
        ? 'Only user-owned uploaded files referenced by exported records are included; over-limit or unavailable files are listed in media-manifest.json.'
        : 'Raw uploaded media files are not included by default; asset metadata is included when available.',
    ],
  };

  const files = {
    'manifest.json': manifest,
    'account/profile.json': {
      account,
      profile: privacy.profile || null,
      onboarding: privacy.onboarding || null,
    },
    'library/saved-items.json': exportData.savedItems || [],
    'library/imports.json': exportData.imports || [],
    'library/collections.json': {
      collections: exportData.collections || [],
      smartCollections: exportData.smartCollections || [],
      smartCollectionItems: exportData.smartCollectionItems || [],
    },
    'library/assets.json': {
      itemAssets: exportData.itemAssets || [],
      itemArchives: exportData.itemArchives || [],
      linkHealthChecks: exportData.linkHealthChecks || [],
      itemReminders: exportData.itemReminders || [],
    },
    'activity/search-events.json': exportData.searchEvents || [],
    'activity/search-feedback.json': exportData.searchFeedback || [],
    'activity/user-activity.json': exportData.userActivity || [],
    'ai/analysis-usage.json': exportData.analysisUsage || [],
    'automations/automations.json': exportData.automations || [],
    'automations/run-history.json': exportData.automationRuns || [],
    'automations/chats.json': exportData.automationChats || [],
    'automations/chat-messages.json': exportData.automationChatMessages || [],
    'access/extension-tokens.json': exportData.extensionTokens || [],
    'access/capture-connections.json': exportData.captureConnections || [],
    'billing/credits.json': exportData.billing || { credits: privacy.credits || null },
    'privacy/deletion-request.json': {
      deletion: privacy.deletion || null,
      exportRequests: exportData.exportRequests || [],
    },
    'data-map.json': dataMap,
  };

  const zip = new JSZip();
  const steps = [];
  for (const [filePath, value] of Object.entries(files)) {
    const json = JSON.stringify(value, null, 2);
    zip.file(filePath, json);
    steps.push({
      category: categoryForPath(filePath),
      status: 'ready',
      rowCount: rowCount(value),
      byteCount: Buffer.byteLength(json),
      errorMessage: '',
    });
  }
  if (includeFiles) {
    await addMediaFilesToZip({
      zip,
      store,
      userId,
      exportData,
      mediaManifest,
    });
    const json = JSON.stringify(mediaManifest, null, 2);
    zip.file('media-manifest.json', json);
    steps.push({
      category: 'media',
      status: 'ready',
      rowCount: mediaManifest.files.length,
      byteCount: mediaManifest.totalBytes + Buffer.byteLength(json),
      errorMessage: mediaManifest.skipped.length ? `${mediaManifest.skipped.length} files skipped.` : '',
    });
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, manifest, steps };
}

async function runDataExport({ store, userId = null, request }) {
  const ownerId = userId || request?.userId;
  if (!ownerId || !request?.id) throw new Error('Data export request is missing owner or request id.');
  try {
    const result = await buildUserDataExport({
      store,
      userId: ownerId,
      requestId: request.id,
      correlationId: request.correlationId || request.requestId || '',
      includeFiles: request.metadata?.includeFiles === true,
    });
    for (const step of result.steps) {
      await store.upsertDataExportStep(request.id, step);
    }
    const storagePath = `${ownerId}/${request.id}/iscraper-data-export.zip`;
    await store.saveDataExportArtifact({
      userId: ownerId,
      requestId: request.id,
      bucket: DATA_EXPORT_BUCKET,
      path: storagePath,
      buffer: result.buffer,
      contentType: 'application/zip',
    });
    return store.markDataExportReady(request.id, {
      bucket: DATA_EXPORT_BUCKET,
      path: storagePath,
      expiresAt: exportExpiresAt(),
      metadata: {
        byteCount: result.buffer.length,
        fileCount: result.steps.length,
        manifest: result.manifest,
      },
    });
  } catch (error) {
    await store.markDataExportFailed(request.id, safeExportError(error));
    throw error;
  }
}

async function processDataExportRequests({ store, maxJobs = 1 } = {}) {
  if (typeof store.claimDataExportRequests !== 'function') return [];
  if (typeof store.expireDataExportRequests === 'function') await store.expireDataExportRequests();
  const requests = await store.claimDataExportRequests({ limit: Math.max(1, Number(maxJobs) || 1) });
  const results = [];
  for (const request of requests) {
    try {
      const completed = await runDataExport({ store, request });
      results.push({ requestId: request.requestId || request.id, correlationId: request.correlationId || request.requestId || '', exportRequestId: request.id, status: completed?.status || 'ready' });
    } catch (error) {
      results.push({ requestId: request.requestId || request.id, correlationId: request.correlationId || request.requestId || '', exportRequestId: request.id, status: 'failed', error: safeExportError(error) });
    }
  }
  return results;
}

function buildPayloadFromPrivacyExport(privacy = {}) {
  return {
    savedItems: privacy.items || [],
    imports: privacy.imports || [],
    collections: privacy.collections || [],
    smartCollections: privacy.smartCollections || [],
    smartCollectionItems: privacy.smartCollectionItems || [],
    itemArchives: privacy.itemArchives || [],
    linkHealthChecks: privacy.linkHealthChecks || [],
    itemReminders: privacy.itemReminders || [],
    extensionTokens: privacy.extensionTokens || [],
    captureConnections: privacy.captureConnections || [],
    searchEvents: privacy.searchEvents || [],
    searchFeedback: privacy.searchFeedback || [],
    onboarding: privacy.onboarding || null,
    billing: { credits: privacy.credits || null },
  };
}

function categoryForPath(filePath) {
  return filePath.split('/')[0].replace('.json', '');
}

function rowCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 1;
  return Object.values(value).reduce((count, entry) => count + (Array.isArray(entry) ? entry.length : entry ? 1 : 0), 0);
}

function safeExportError(error) {
  const message = String(error?.message || 'Data export failed.');
  return sanitizeAuditString(message) || 'Data export failed.';
}

function createMediaManifest({ includeFiles, maxBytes, maxFiles }) {
  return {
    includeFiles: Boolean(includeFiles),
    generatedAt: new Date().toISOString(),
    limits: { maxBytes, maxFiles },
    totalBytes: 0,
    files: [],
    skipped: [],
  };
}

async function addMediaFilesToZip({ zip, store, userId, exportData, mediaManifest }) {
  const candidates = collectMediaCandidates({ userId, exportData });
  for (const candidate of candidates) {
    if (mediaManifest.files.length >= mediaManifest.limits.maxFiles) {
      skipMedia(mediaManifest, candidate, 'file_limit_exceeded');
      continue;
    }
    try {
      const file = await loadMediaCandidate({ store, userId, candidate });
      if (!file?.buffer?.length) {
        skipMedia(mediaManifest, candidate, 'not_found');
        continue;
      }
      if (mediaManifest.totalBytes + file.buffer.length > mediaManifest.limits.maxBytes) {
        skipMedia(mediaManifest, candidate, 'byte_limit_exceeded');
        continue;
      }
      zip.file(candidate.zipPath, file.buffer);
      mediaManifest.totalBytes += file.buffer.length;
      mediaManifest.files.push({
        bucket: candidate.bucket,
        storagePath: candidate.storagePath,
        zipPath: candidate.zipPath,
        mimeType: file.contentType || candidate.mimeType || 'application/octet-stream',
        byteCount: file.buffer.length,
        source: candidate.source,
      });
    } catch (error) {
      skipMedia(mediaManifest, candidate, safeExportError(error));
    }
  }
}

function collectMediaCandidates({ userId, exportData }) {
  const candidates = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate?.storagePath) return;
    const key = `${candidate.bucket}:${candidate.storagePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };
  for (const asset of exportData.itemAssets || []) {
    const storagePath = String(asset.storagePath || '');
    if (storagePath.startsWith('data:')) {
      add({
        bucket: NOTE_ASSET_BUCKET,
        storagePath,
        zipPath: `files/${NOTE_ASSET_BUCKET}/${safeFileName(asset.id || asset.itemId || 'asset')}`,
        mimeType: asset.mimeType,
        source: 'item_asset',
        dataUrl: storagePath,
      });
      continue;
    }
    if (storagePathBelongsToUser(userId, storagePath)) {
      add({
        bucket: NOTE_ASSET_BUCKET,
        storagePath,
        zipPath: `files/${NOTE_ASSET_BUCKET}/${storagePath}`,
        mimeType: asset.mimeType,
        source: 'item_asset',
      });
    }
  }
  for (const importEntry of exportData.imports || []) {
    for (const file of importEntry.storageFiles || []) {
      const storagePath = String(file.path || '').replace(/^\/+/, '');
      if (!storagePathBelongsToUser(userId, storagePath)) continue;
      add({
        bucket: IMPORT_UPLOAD_BUCKET,
        storagePath,
        zipPath: `files/${IMPORT_UPLOAD_BUCKET}/${storagePath}`,
        mimeType: file.type || file.mimeType,
        source: 'import_upload',
      });
    }
  }
  return candidates;
}

async function loadMediaCandidate({ store, userId, candidate }) {
  if (candidate.dataUrl) return decodeDataUrl(candidate.dataUrl, candidate.mimeType);
  if (typeof store.downloadUserStorageObject !== 'function') return null;
  return store.downloadUserStorageObject({
    userId,
    bucket: candidate.bucket,
    path: candidate.storagePath,
  });
}

function decodeDataUrl(dataUrl, fallbackContentType = '') {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const contentType = match[1] || fallbackContentType || 'application/octet-stream';
  const data = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  return { buffer: data, contentType };
}

function skipMedia(mediaManifest, candidate, reason) {
  mediaManifest.skipped.push({
    bucket: candidate.bucket,
    storagePath: candidate.storagePath?.startsWith('data:') ? '[inline-data-url]' : candidate.storagePath,
    source: candidate.source,
    reason: String(reason || 'skipped').slice(0, 120),
  });
}

function safeFileName(value) {
  return String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

module.exports = {
  DATA_EXPORT_BUCKET,
  DATA_EXPORT_FORMAT,
  DATA_EXPORT_RETENTION_DAYS,
  DEFAULT_MEDIA_EXPORT_MAX_BYTES,
  DEFAULT_MEDIA_EXPORT_MAX_FILES,
  buildUserDataExport,
  exportExpiresAt,
  processDataExportRequests,
  runDataExport,
};
