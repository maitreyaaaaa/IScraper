const crypto = require('crypto');

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'spm',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
]);

const PLATFORM_HOSTS = [
  ['pinterest.', { key: 'pinterest', label: 'Pinterest' }],
  ['pin.it', { key: 'pinterest', label: 'Pinterest' }],
  ['twitter.com', { key: 'x-twitter', label: 'X / Twitter' }],
  ['x.com', { key: 'x-twitter', label: 'X / Twitter' }],
  ['tiktok.com', { key: 'tiktok', label: 'TikTok' }],
  ['youtube.com', { key: 'youtube', label: 'YouTube' }],
  ['youtu.be', { key: 'youtube', label: 'YouTube' }],
  ['instagram.com', { key: 'instagram', label: 'Instagram' }],
  ['linkedin.com', { key: 'linkedin', label: 'LinkedIn' }],
  ['reddit.com', { key: 'reddit', label: 'Reddit' }],
];

function normalizeSavedUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw validationError('Only http and https links can be saved.');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw validationError('Local or private network links cannot be saved.');
  }

  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function buildManualSavedItem(input = {}) {
  const url = normalizeSavedUrl(input.url);
  const parsed = new URL(url);
  const title = cleanText(input.title, 160) || parsed.hostname;
  const description = cleanText(input.description, 500);
  const note = cleanText(input.note, 500);
  const detected = detectPlatform(url);
  const platform = cleanText(input.platform, 60) || detected.label;
  const sourceAuthor = cleanText(input.author, 120);
  const thumbnailUrl = safeExternalUrl(input.thumbnailUrl || input.thumbnail, 1000);
  const collection = cleanCollection(input.collection) || 'Random saves';
  const savedAt = new Date().toISOString();
  const caption = [
    title,
    description ? `Description: ${description}` : '',
    note ? `Note: ${note}` : '',
    `Source: ${platform}`,
    `URL: ${url}`,
  ].filter(Boolean).join('\n');

  return {
    id: `web-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}`,
    url,
    contentType: 'unknown',
    caption,
    hashtags: extractHashtags(caption),
    ownerName: platform,
    ownerUsername: '',
    savedAt,
    collections: [collection],
    sourceName: 'manual-link',
    platform,
    platformKey: detected.key,
    sourceId: detected.sourceId,
    sourceTitle: title,
    sourceAuthor,
    sourceDescription: description,
    thumbnailUrl,
  };
}

function parseManualLinkPayload(body = {}) {
  const collection = cleanCollection(body.collection) || 'Random saves';
  const item = buildManualSavedItem({
    url: body.url,
    title: body.title,
    description: body.description,
    note: body.note,
    platform: body.platform,
    author: body.author,
    thumbnailUrl: body.thumbnailUrl,
    collection,
  });
  return {
    collections: [{ name: collection, sourceName: 'manual-link', itemUrls: [item.url] }],
    items: [item],
  };
}

function detectPlatform(value) {
  const parsed = new URL(String(value || 'https://unknown.invalid'));
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const match = PLATFORM_HOSTS.find(([needle]) => hostname.includes(needle));
  const platform = match ? match[1] : { key: 'web', label: hostname };
  return {
    ...platform,
    sourceId: sourceIdFor(platform.key, parsed),
  };
}

function sourceIdFor(platformKey, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (platformKey === 'pinterest') {
    const pinIndex = parts.findIndex((part) => part === 'pin');
    return pinIndex >= 0 ? parts[pinIndex + 1] || '' : parts.at(-1) || '';
  }
  if (platformKey === 'x-twitter') {
    const statusIndex = parts.findIndex((part) => part === 'status' || part === 'statuses');
    return statusIndex >= 0 ? parts[statusIndex + 1] || '' : parts.at(-1) || '';
  }
  if (platformKey === 'youtube') {
    return url.searchParams.get('v') || parts[0] || '';
  }
  if (platformKey === 'tiktok') {
    const videoIndex = parts.findIndex((part) => part === 'video');
    return videoIndex >= 0 ? parts[videoIndex + 1] || '' : parts.at(-1) || '';
  }
  if (platformKey === 'instagram') {
    return parts[1] || parts.at(-1) || '';
  }
  return parts.at(-1) || url.hostname;
}

function safeExternalUrl(value, maxLength) {
  const raw = cleanText(value, maxLength);
  if (!raw) return '';
  try {
    return normalizeSavedUrl(raw);
  } catch (_error) {
    return '';
  }
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanCollection(value) {
  return cleanText(value, 80);
}

function extractHashtags(value) {
  return [...String(value || '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => match[1].toLowerCase());
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

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

module.exports = {
  buildManualSavedItem,
  normalizeSavedUrl,
  parseManualLinkPayload,
  detectPlatform,
};
