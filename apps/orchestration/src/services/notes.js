const crypto = require('crypto');
const path = require('path');

const NOTE_CONTENT_TYPE = 'note';
const NOTE_PLATFORM = 'IScraper Notes';
const NOTE_PLATFORM_KEY = 'iscraper-note';
const NOTE_COLLECTION = 'My Notes';
const NOTE_ASSET_BUCKET = 'note-assets';
const MAX_NOTE_IMAGES = 5;
const MAX_NOTE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_NOTE_BODY_LENGTH = 20000;
const NOTE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const NOTE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function createNoteId() {
  return `note-${crypto.randomUUID()}`;
}

function noteUrlFor(id) {
  return `iscraper://note/${id}`;
}

function cleanSingleLine(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanNoteBody(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NOTE_BODY_LENGTH);
}

function firstLine(value) {
  return String(value || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
}

function isBlockedHostname(hostname) {
  const lower = String(hostname || '').toLowerCase();
  if (!lower || lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower)) {
    const parts = lower.split('.').map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    );
  }
  if (lower.startsWith('[')) {
    return lower === '[::1]' || lower.startsWith('[fc') || lower.startsWith('[fd') || lower.startsWith('[fe80');
  }
  return false;
}

function normalizeNoteLink(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Note links must use http or https.'), { statusCode: 400 });
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw Object.assign(new Error('Note links cannot point to local or private network addresses.'), { statusCode: 400 });
  }
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return parsed.toString();
}

function linksFromText(value) {
  return [...String(value || '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((match) => match[0]);
}

function normalizeNoteLinks({ links = [], body = '' } = {}) {
  const candidates = [
    ...(Array.isArray(links) ? links : []),
    ...linksFromText(body),
  ];
  const normalized = [];
  for (const candidate of candidates) {
    if (!String(candidate || '').trim()) continue;
    const link = normalizeNoteLink(candidate);
    if (!normalized.includes(link)) normalized.push(link);
    if (normalized.length >= 20) break;
  }
  return normalized;
}

function noteInputFromBody(body = {}) {
  let links = body.links;
  if (typeof links === 'string') {
    try {
      links = JSON.parse(links);
    } catch {
      links = links.split(/\s+/);
    }
  }
  const noteBody = cleanNoteBody(body.body ?? body.note ?? body.content);
  const title = cleanSingleLine(body.title, 160) || cleanSingleLine(firstLine(noteBody), 160) || 'Untitled note';
  return {
    title,
    body: noteBody,
    links: normalizeNoteLinks({ links, body: noteBody }),
  };
}

function noteCaption({ title, body, links }) {
  return [
    title,
    body,
    links?.length ? `Links:\n${links.map((link) => `- ${link}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

function previewText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function buildNoteItem({ userId, input, id = createNoteId(), createdAt = new Date().toISOString() }) {
  const caption = noteCaption(input);
  return {
    id,
    userId,
    importId: null,
    url: noteUrlFor(id),
    contentType: NOTE_CONTENT_TYPE,
    caption,
    hashtags: [],
    ownerName: NOTE_PLATFORM,
    ownerUsername: '',
    savedAt: createdAt,
    collections: [NOTE_COLLECTION],
    platform: NOTE_PLATFORM,
    platformKey: NOTE_PLATFORM_KEY,
    sourceId: id,
    sourceTitle: input.title,
    sourceAuthor: 'You',
    sourceDescription: previewText(input.body || input.links?.[0] || input.title),
    thumbnailUrl: '',
    status: 'done',
    error: null,
    note: {
      body: input.body,
      links: input.links,
    },
  };
}

function assertNoteImageFile(file) {
  const extension = path.extname(file?.originalname || '').toLowerCase();
  if (!file?.buffer?.length) {
    throw Object.assign(new Error('Note image upload is empty.'), { statusCode: 400 });
  }
  if (file.size > MAX_NOTE_IMAGE_BYTES) {
    throw Object.assign(new Error('Note images must be 5 MB or smaller.'), { statusCode: 400 });
  }
  if (!NOTE_IMAGE_MIME_TYPES.has(file.mimetype) || !NOTE_IMAGE_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error('Notes support PNG, JPEG, WebP, or GIF images only. Video notes are not supported yet.'), { statusCode: 400 });
  }
}

function noteAssetStoragePath({ userId, itemId, file }) {
  const extension = path.extname(file?.originalname || '').toLowerCase() || '.upload';
  return `${userId}/notes/${itemId}/${crypto.randomUUID()}${extension}`;
}

function publicNoteAsset(asset = {}) {
  return {
    id: asset.id,
    userId: asset.userId,
    itemId: asset.itemId,
    assetType: asset.assetType,
    storagePath: asset.storagePath,
    mimeType: asset.mimeType,
    url: asset.url || asset.signedUrl || '',
    createdAt: asset.createdAt,
  };
}

module.exports = {
  MAX_NOTE_IMAGES,
  MAX_NOTE_IMAGE_BYTES,
  NOTE_ASSET_BUCKET,
  NOTE_COLLECTION,
  NOTE_CONTENT_TYPE,
  NOTE_IMAGE_MIME_TYPES,
  NOTE_PLATFORM,
  NOTE_PLATFORM_KEY,
  assertNoteImageFile,
  buildNoteItem,
  noteAssetStoragePath,
  noteInputFromBody,
  publicNoteAsset,
};
