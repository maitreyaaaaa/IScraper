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
  ['pinterest.', 'Pinterest'],
  ['pin.it', 'Pinterest'],
  ['twitter.com', 'X / Twitter'],
  ['x.com', 'X / Twitter'],
  ['tiktok.com', 'TikTok'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['instagram.com', 'Instagram'],
  ['linkedin.com', 'LinkedIn'],
  ['reddit.com', 'Reddit'],
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
  const platform = cleanText(input.platform, 60) || detectPlatform(parsed.hostname);
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
    collections: ['Web saves'],
    sourceName: 'manual-link',
  };
}

function parseManualLinkPayload(body = {}) {
  const item = buildManualSavedItem({
    url: body.url,
    title: body.title,
    description: body.description,
    note: body.note,
    platform: body.platform,
  });
  return {
    collections: [{ name: 'Web saves', sourceName: 'manual-link', itemUrls: [item.url] }],
    items: [item],
  };
}

function detectPlatform(hostname) {
  const lower = String(hostname || '').toLowerCase();
  const match = PLATFORM_HOSTS.find(([needle]) => lower.includes(needle));
  return match ? match[1] : lower;
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
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
};
