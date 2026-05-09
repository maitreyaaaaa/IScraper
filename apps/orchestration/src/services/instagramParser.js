const cheerio = require('cheerio');
const path = require('path');

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

function findInstagramUrls(value) {
  const urls = new Set();
  const scan = (entry) => {
    if (typeof entry === 'string') {
      const matches = entry.match(/https?:\/\/(?:www\.|m\.|mobile\.|basic\.)?instagram\.com\/(?:reel|reels|p)\/[^"'\s<>\\/?#]+[^"'\s<>\\]*/gi) || [];
      for (const match of matches) {
        const normalized = normalizeInstagramUrl(match.replace(/\\\//g, '/'));
        if (/instagram\.com\/(reel|p)\//.test(normalized)) urls.add(normalized);
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(scan);
      return;
    }
    if (entry && typeof entry === 'object') {
      Object.values(entry).forEach(scan);
    }
  };
  scan(value);
  return [...urls];
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

function valueFromStringMap(map = {}, labels = []) {
  for (const label of labels) {
    const entry = map[label];
    if (!entry || typeof entry !== 'object') continue;
    const value = normalizeText(entry.value || entry.title || entry.href || '');
    if (value) return value;
  }
  return '';
}

function savedAtFromStringMap(map = {}) {
  for (const entry of Object.values(map || {})) {
    if (!entry || typeof entry !== 'object' || !entry.timestamp) continue;
    const timestamp = Number(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    return new Date(timestamp * 1000).toISOString();
  }
  return '';
}

function itemFromJsonUrl(url, sourceName, record = {}, collectionName = null) {
  const stringMap = record.string_map_data || {};
  const caption = valueFromStringMap(stringMap, ['Caption', 'Title', 'Text']) || normalizeText(record.title || '');
  const ownerName = valueFromStringMap(stringMap, ['Name', 'Full name']);
  const ownerUsername = valueFromStringMap(stringMap, ['Username', 'Author', 'Account username']);
  const savedAt = savedAtFromStringMap(stringMap);
  const id = getShortcode(url);

  return {
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
  };
}

function collectInstagramJsonItems(value, sourceName, collectionName = null, items = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectInstagramJsonItems(entry, sourceName, collectionName, items));
    return items;
  }

  if (!value || typeof value !== 'object') return items;

  const nextCollectionName =
    collectionName ||
    valueFromStringMap(value.string_map_data || {}, ['Name', 'Collection name']) ||
    (/collection/i.test(sourceName) ? normalizeText(value.title || '') : '');

  const urls = findInstagramUrls(value);
  const childContainers = ['media', 'items', 'children', 'saved_saved_media', 'saved_saved_collections'];
  const hasChildContainer = childContainers.some((key) => Array.isArray(value[key]) || (value[key] && typeof value[key] === 'object'));

  if (urls.length && (!hasChildContainer || value.string_map_data)) {
    urls.forEach((url) => items.push(itemFromJsonUrl(url, sourceName, value, nextCollectionName || null)));
    return items;
  }

  Object.values(value).forEach((entry) => collectInstagramJsonItems(entry, sourceName, nextCollectionName || collectionName, items));
  return items;
}

function parsePostsJson(text, sourceName) {
  const parsed = JSON.parse(text);
  return collectInstagramJsonItems(parsed, sourceName);
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

function parseInstagramExport(files) {
  const allItems = [];
  const allCollections = [];

  for (const file of files || []) {
    const sourceName = file.originalname || file.filename || 'instagram-export.html';
    const extension = path.extname(sourceName).toLowerCase();
    const text = Buffer.isBuffer(file.buffer) ? file.buffer.toString('utf8') : String(file.buffer || file.content || '');
    if (extension === '.json') {
      try {
        allItems.push(...parsePostsJson(text, sourceName));
      } catch (_error) {
        // Non-Instagram JSON, or a malformed file. Let other parsers try it.
      }
    } else if (/saved_collections/i.test(sourceName)) {
      const parsed = parseCollectionsHtml(text, sourceName);
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
};
