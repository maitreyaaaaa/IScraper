const crypto = require('crypto');
const path = require('path');
const JSZip = require('jszip');

function normalizeText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePinterestUrl(value) {
  try {
    const url = new URL(String(value).replace(/\\\//g, '/'));
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'pin.it') return `https://pin.it${url.pathname}`;
    if (!hostname.endsWith('pinterest.com')) return '';

    const parts = url.pathname.split('/').filter(Boolean);
    const pinIndex = parts.findIndex((part) => part.toLowerCase() === 'pin');
    const pinId = pinIndex >= 0 ? parts[pinIndex + 1] : '';
    if (!pinId) return '';
    return `https://pinterest.com/pin/${pinId}`;
  } catch (_error) {
    return '';
  }
}

function getSourceId(url) {
  const normalized = normalizePinterestUrl(url);
  const pinMatch = normalized.match(/\/pin\/([^/?#]+)/);
  if (pinMatch) return pinMatch[1];
  return crypto.createHash('sha1').update(normalized || String(url)).digest('hex').slice(0, 16);
}

function extractHashtags(text) {
  const tags = new Set();
  for (const match of String(text || '').matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    tags.add(match[1].toLowerCase());
  }
  return [...tags];
}

function collectStrings(value, strings = []) {
  if (typeof value === 'string') {
    strings.push(value);
    return strings;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, strings));
    return strings;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectStrings(entry, strings));
  }
  return strings;
}

function textFromBuffer(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  if (text.includes('\u0000')) return '';
  return text;
}

function extractPinterestItemsFromText(text, sourceName) {
  const byUrl = new Map();
  const urls = String(text || '').match(/https?:\/\/(?:[^"'\s<>\\]|\\\/)+/gi) || [];

  for (const rawUrl of urls) {
    const url = normalizePinterestUrl(rawUrl);
    if (!url || byUrl.has(url)) continue;

    const sourceId = getSourceId(url);
    const item = {
      id: `pinterest-${sourceId}`,
      url,
      contentType: 'pin',
      caption: `Pinterest pin\nURL: ${url}`,
      hashtags: extractHashtags(text),
      ownerName: 'Pinterest',
      ownerUsername: '',
      savedAt: '',
      collections: ['Pinterest export'],
      sourceName,
      platform: 'Pinterest',
      platformKey: 'pinterest',
      sourceId,
      sourceTitle: `Pinterest pin ${sourceId}`,
      sourceAuthor: 'Pinterest',
      sourceDescription: '',
      thumbnailUrl: '',
    };
    byUrl.set(url, item);
  }

  return [...byUrl.values()];
}

function mergeItems(items) {
  const byUrl = new Map();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    if (!existing) {
      byUrl.set(item.url, item);
      continue;
    }
    existing.hashtags = [...new Set([...(existing.hashtags || []), ...(item.hashtags || [])])];
    existing.collections = [...new Set([...(existing.collections || []), ...(item.collections || [])])];
  }
  return [...byUrl.values()];
}

async function textEntriesFromZip(file) {
  const zip = await JSZip.loadAsync(file.buffer);
  const entries = [];
  const allowedExtensions = new Set(['.json', '.csv', '.html', '.htm', '.txt']);

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const extension = path.extname(entry.name || '').toLowerCase();
    if (!allowedExtensions.has(extension)) continue;
    const text = await entry.async('string');
    entries.push({ sourceName: entry.name, text });
  }

  return entries;
}

async function parsePinterestExport(files = []) {
  const allItems = [];

  for (const file of files) {
    const sourceName = file.originalname || file.filename || 'pinterest-export';
    const extension = path.extname(sourceName).toLowerCase();
    if (extension === '.zip') {
      let entries = [];
      try {
        entries = await textEntriesFromZip(file);
      } catch (_error) {
        const error = new Error('This Pinterest ZIP could not be opened. Please upload the original export ZIP from Pinterest.');
        error.statusCode = 400;
        throw error;
      }
      for (const entry of entries) {
        allItems.push(...extractPinterestItemsFromText(entry.text, entry.sourceName));
      }
      continue;
    }

    if (['.json', '.csv', '.html', '.htm'].includes(extension)) {
      const rawText = textFromBuffer(file.buffer || file.content);
      if (!rawText) continue;
      if (extension === '.json') {
        try {
          const jsonText = collectStrings(JSON.parse(rawText)).join('\n');
          allItems.push(...extractPinterestItemsFromText(jsonText || rawText, sourceName));
          continue;
        } catch (_error) {
          // Fall back to plain text scanning below.
        }
      }
      allItems.push(...extractPinterestItemsFromText(rawText, sourceName));
    }
  }

  const items = mergeItems(allItems);
  return {
    items,
    collections: items.length ? [{ name: 'Pinterest export', sourceName: 'pinterest-export', itemUrls: items.map((item) => item.url) }] : [],
  };
}

module.exports = {
  parsePinterestExport,
  normalizePinterestUrl,
};
