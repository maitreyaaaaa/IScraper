const cheerio = require('cheerio');
const path = require('path');
const JSZip = require('jszip');

const INSTAGRAM_SAVED_EXPORT_RE = /(^|\/)your_instagram_activity\/saved\/saved_(posts|collections)\.(html|htm|json)$/i;
const INSTAGRAM_SAVED_FILE_RE = /^saved_(posts|collections)\.(html|htm|json)$/i;

function normalizeText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getShortcode(url) {
  return String(url).split('/').filter(Boolean).pop();
}

function normalizeInstagramUrl(value) {
  try {
    const url = new URL(String(value));
    const hostname = url.hostname.toLowerCase().replace(/^(www|m|mobile|basic)\./, '');
    if (hostname !== 'instagram.com') return String(value);

    const parts = url.pathname.split('/').filter(Boolean);
    const type = parts[0] === 'reels' ? 'reel' : parts[0];
    const shortcode = parts[1];
    if (!['reel', 'p'].includes(type) || !shortcode) return String(value);

    return `https://instagram.com/${type}/${shortcode}`;
  } catch (_error) {
    return String(value);
  }
}

function getContentType(url) {
  if (url.includes('/reel/')) return 'reel';
  if (url.includes('/p/')) return 'post';
  return 'unknown';
}

function normalizeSourceName(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isInstagramSavedExportName(sourceName) {
  const normalized = normalizeSourceName(sourceName);
  return INSTAGRAM_SAVED_EXPORT_RE.test(normalized) || INSTAGRAM_SAVED_FILE_RE.test(path.posix.basename(normalized));
}

function extractHashtags(caption) {
  const tags = new Set();
  for (const match of String(caption || '').matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    tags.add(match[1].toLowerCase());
  }
  return [...tags];
}

function extractFieldFromTable($, table, label) {
  let value = '';
  $(table)
    .find('tr')
    .each((_, row) => {
      const cells = $(row).children('td');
      if (normalizeText($(cells[0]).text()) === label) {
        value = normalizeText($(cells[1]).text());
        return false;
      }
      return undefined;
    });
  return value;
}

function closestRecord($, anchor) {
  const candidates = $(anchor).parents('div._a6-g').toArray();
  return candidates.find((candidate) => $(candidate).find('a[href*="instagram.com/"]').length === 1) || candidates[0];
}

function parsePostsHtml(html, sourceName, collectionName = null) {
  const $ = cheerio.load(html);
  const byUrl = new Map();

  $('a[href*="instagram.com/"]').each((_, anchor) => {
    const rawUrl = $(anchor).attr('href');
    const url = normalizeInstagramUrl(rawUrl);
    if (!url || !/instagram\.com\/(reel|p)\//.test(url) || byUrl.has(url)) return;

    const record = closestRecord($, anchor);
    const table = $(record).find('table').first();
    const caption = extractFieldFromTable($, table, 'Caption');
    const ownerName = extractFieldFromTable($, table, 'Name');
    const ownerUsername = extractFieldFromTable($, table, 'Username');
    const savedAt = normalizeText($(record).find('div._3-94._a6-o').first().text());
    const id = getShortcode(url);

    byUrl.set(url, {
      id,
      url,
      contentType: getContentType(url),
      caption,
      hashtags: extractHashtags(caption),
      ownerName,
      ownerUsername,
      savedAt,
      collections: collectionName ? [collectionName] : [],
      sourceName,
      platform: 'Instagram',
      platformKey: 'instagram',
      sourceId: id,
      sourceTitle: caption ? caption.slice(0, 160) : '',
      sourceAuthor: ownerUsername || ownerName,
      sourceDescription: caption,
      thumbnailUrl: '',
    });
  });

  return [...byUrl.values()];
}

function firstInstagramUrl(value) {
  const text = String(value || '').replace(/\\\//g, '/');
  const urls = text.match(/https?:\/\/(?:[^"'\s<>\\]|\\\/)+/gi) || [];
  return urls.map(normalizeInstagramUrl).find((url) => /instagram\.com\/(reel|p)\//.test(url)) || '';
}

function findUrlDataFromJsonRecord(record) {
  const stringMap = record && typeof record === 'object' ? record.string_map_data || record.stringMapData : null;
  if (stringMap && typeof stringMap === 'object') {
    for (const [label, entry] of Object.entries(stringMap)) {
      if (!entry || typeof entry !== 'object') continue;
      const href = firstInstagramUrl(entry.href);
      if (href) {
        return {
          url: href,
          label,
          timestamp: entry.timestamp,
          value: normalizeText(entry.value || ''),
        };
      }
    }
  }

  for (const value of Object.values(record || {})) {
    if (typeof value !== 'string') continue;
    const url = firstInstagramUrl(value);
    if (url) return { url, label: '', timestamp: null, value: '' };
  }

  return null;
}

function timestampToText(timestamp) {
  const numeric = Number(timestamp || 0);
  if (!numeric) return '';
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function extractJsonField(record, fieldName) {
  const stringMap = record && typeof record === 'object' ? record.string_map_data || record.stringMapData : null;
  if (!stringMap || typeof stringMap !== 'object') return '';
  const entry = stringMap[fieldName];
  if (!entry || typeof entry !== 'object') return '';
  return normalizeText(entry.value || '');
}

function itemFromJsonRecord(record, sourceName, collectionName = '') {
  const urlData = findUrlDataFromJsonRecord(record);
  if (!urlData?.url) return null;

  const url = urlData.url;
  const id = getShortcode(url);
  const title = normalizeText(record.title || record.name || '');
  const caption = extractJsonField(record, 'Caption') || extractJsonField(record, 'Title') || urlData.value || '';
  const ownerUsername = extractJsonField(record, 'Username') || title;
  const ownerName = extractJsonField(record, 'Name') || '';
  const fallbackDescription = title ? `Saved Instagram ${getContentType(url)} from ${title}` : `Saved Instagram ${getContentType(url)}`;

  return {
    id,
    url,
    contentType: getContentType(url),
    caption,
    hashtags: extractHashtags(caption),
    ownerName,
    ownerUsername,
    savedAt: timestampToText(urlData.timestamp),
    collections: collectionName ? [collectionName] : [],
    sourceName,
    platform: 'Instagram',
    platformKey: 'instagram',
    sourceId: id,
    sourceTitle: caption ? caption.slice(0, 160) : fallbackDescription,
    sourceAuthor: ownerUsername || ownerName,
    sourceDescription: caption || fallbackDescription,
    thumbnailUrl: '',
  };
}

function parsePostsJson(json, sourceName) {
  const items = [];
  const collections = [];

  function walk(value, collectionName = '') {
    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, collectionName));
      return;
    }
    if (!value || typeof value !== 'object') return;

    const item = itemFromJsonRecord(value, sourceName, collectionName);
    if (item) {
      items.push(item);
      if (collectionName) collections.push({ name: collectionName, sourceName, itemUrls: [item.url] });
      return;
    }

    const nextCollectionName = /saved_collections/i.test(sourceName) && typeof value.title === 'string'
      ? normalizeText(value.title)
      : collectionName;
    Object.values(value).forEach((entry) => walk(entry, nextCollectionName));
  }

  walk(json);
  return { items, collections };
}

function parseCollectionsHtml(html, sourceName) {
  const $ = cheerio.load(html);
  const collections = [];
  const itemsByUrl = new Map();

  $('td')
    .filter((_, cell) => normalizeText($(cell).text()) === 'Name')
    .each((_, labelCell) => {
      const name = normalizeText($(labelCell).next('td').text());
      if (!name) return;

      const collectionRoot = $(labelCell).closest('div._a6-g');
      const urls = new Set();
      collectionRoot.find('a[href*="instagram.com/"]').each((__, anchor) => {
        const url = $(anchor).attr('href');
        if (url && /instagram\.com\/(reel|p)\//.test(url)) urls.add(url);
      });

      if (!urls.size) return;
      collections.push({ name, sourceName, itemUrls: [...urls] });

      for (const item of parsePostsHtml($.html(collectionRoot), sourceName, name)) {
        const existing = itemsByUrl.get(item.url);
        if (existing) {
          existing.collections = [...new Set([...existing.collections, name])];
        } else {
          itemsByUrl.set(item.url, item);
        }
      }
    });

  return { collections, items: [...itemsByUrl.values()] };
}

function mergeItems(items) {
  const byUrl = new Map();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    if (!existing) {
      byUrl.set(item.url, item);
      continue;
    }
    existing.caption ||= item.caption;
    existing.ownerName ||= item.ownerName;
    existing.ownerUsername ||= item.ownerUsername;
    existing.savedAt ||= item.savedAt;
    existing.hashtags = [...new Set([...(existing.hashtags || []), ...(item.hashtags || [])])];
    existing.collections = [...new Set([...(existing.collections || []), ...(item.collections || [])])];
  }
  return [...byUrl.values()];
}

async function extractInstagramEntries(files) {
  const entries = [];
  for (const file of files || []) {
    const sourceName = file.originalname || file.filename || 'instagram-export';
    const extension = path.extname(sourceName).toLowerCase();

    if (extension === '.zip') {
      let zip;
      try {
        zip = await JSZip.loadAsync(file.buffer);
      } catch (_error) {
        const error = new Error('This Instagram ZIP could not be opened. Please upload the original export ZIP from Instagram.');
        error.statusCode = 400;
        throw error;
      }

      for (const entry of Object.values(zip.files)) {
        if (entry.dir || !isInstagramSavedExportName(entry.name)) continue;
        entries.push({
          sourceName: entry.name,
          buffer: Buffer.from(await entry.async('nodebuffer')),
        });
      }
      continue;
    }

    if (!isInstagramSavedExportName(sourceName)) continue;
    entries.push({
      sourceName,
      buffer: Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(String(file.buffer || file.content || ''), 'utf8'),
    });
  }
  return entries;
}

async function parseInstagramExport(files) {
  const allItems = [];
  const allCollections = [];
  const entries = await extractInstagramEntries(files);

  for (const entry of entries) {
    const sourceName = entry.sourceName || 'instagram-export';
    const extension = path.extname(sourceName).toLowerCase();
    const text = Buffer.isBuffer(entry.buffer) ? entry.buffer.toString('utf8') : String(entry.buffer || '');

    if (extension === '.json') {
      try {
        const parsed = parsePostsJson(JSON.parse(text), sourceName);
        allItems.push(...parsed.items);
        allCollections.push(...parsed.collections);
      } catch (_error) {
        // Ignore malformed JSON here; the import route will report no saves if nothing usable is found.
      }
      continue;
    }

    if (/saved_collections/i.test(sourceName)) {
      const html = text;
      const parsed = parseCollectionsHtml(html, sourceName);
      allItems.push(...parsed.items);
      allCollections.push(...parsed.collections);
    } else {
      allItems.push(...parsePostsHtml(text, sourceName));
    }
  }

  return {
    items: mergeItems(allItems),
    collections: allCollections,
  };
}

module.exports = {
  parseInstagramExport,
  normalizeInstagramUrl,
  normalizeText,
  isInstagramSavedExportName,
};
