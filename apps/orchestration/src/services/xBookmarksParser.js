const crypto = require('crypto');
const path = require('path');
const JSZip = require('jszip');
const { normalizeSourceSavedAt } = require('./sourceDates');

const X_TEXT_EXTENSIONS = new Set(['.js', '.json', '.csv', '.txt']);
const X_HOST_RE = /^(?:mobile\.)?(?:twitter\.com|x\.com)$/i;

function cleanText(value = '', maxLength = 1200) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeXUrl(value) {
  try {
    const parsed = new URL(String(value || '').replace(/\\\//g, '/').trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!X_HOST_RE.test(hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const statusIndex = parts.findIndex((part) => part === 'status' || part === 'statuses');
    const tweetId = statusIndex >= 0 ? parts[statusIndex + 1] : '';
    if (!/^\d+$/.test(tweetId || '')) return '';
    const username = statusIndex > 0 ? parts[statusIndex - 1] : '';
    return username
      ? `https://x.com/${username}/status/${tweetId}`
      : `https://x.com/i/status/${tweetId}`;
  } catch (_error) {
    return '';
  }
}

function tweetIdFromUrl(url) {
  const match = normalizeXUrl(url).match(/\/status\/(\d+)/);
  return match ? match[1] : '';
}

function extractHashtags(value) {
  const tags = new Set();
  for (const match of String(value || '').matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    tags.add(match[1].toLowerCase());
  }
  return [...tags];
}

function stripTwitterJsAssignment(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  const assignment = raw.match(/^\s*window\.YTD\.[\w.]+\.part\d+\s*=\s*/);
  if (!assignment) return raw;
  return raw.slice(assignment[0].length).replace(/;\s*$/, '').trim();
}

function parseJsonLike(text) {
  const stripped = stripTwitterJsAssignment(text);
  try {
    return JSON.parse(stripped);
  } catch (_error) {
    return null;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text || '');

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  const [header = [], ...body] = rows.filter((entry) => entry.some((cell) => cleanText(cell)));
  const keys = header.map((cell) => cleanText(cell).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  if (!keys.some((key) => ['url', 'tweet_url', 'link', 'id', 'tweet_id'].includes(key))) return [];
  return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index] || ''])));
}

function collectEntries(value, entries = []) {
  if (!value) return entries;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectEntries(entry, entries));
    return entries;
  }
  if (typeof value !== 'object') return entries;
  const candidate = value.bookmark?.tweet || value.bookmark || value.tweet || value;
  const strings = Object.values(candidate).filter((entry) => typeof entry === 'string').join(' ');
  if (
    candidate.url
    || candidate.tweet_url
    || candidate.tweetUrl
    || candidate.full_text
    || candidate.fullText
    || candidate.text
    || /https?:\/\/(?:twitter\.com|x\.com)\//i.test(strings)
  ) {
    entries.push(candidate);
    return entries;
  }
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === 'object') collectEntries(entry, entries);
  });
  return entries;
}

function urlFromEntry(entry = {}) {
  const directUrl = entry.url || entry.tweet_url || entry.tweetUrl || entry.link || entry.permalink;
  const normalizedDirect = normalizeXUrl(directUrl);
  if (normalizedDirect) return normalizedDirect;

  const joined = Object.values(entry).filter((value) => typeof value === 'string').join(' ');
  const found = joined.match(/https?:\/\/(?:mobile\.)?(?:twitter\.com|x\.com)\/[^\s"'<>\\]+/i)?.[0];
  const normalizedFound = normalizeXUrl(found);
  if (normalizedFound) return normalizedFound;

  const id = cleanText(entry.tweet_id || entry.tweetId || entry.id || entry.id_str || entry.rest_id, 64);
  const username = cleanText(entry.screen_name || entry.screenName || entry.username || entry.user?.screen_name || entry.user?.screenName, 80).replace(/^@/, '');
  if (/^\d+$/.test(id)) return username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/status/${id}`;
  return '';
}

function mediaUrlFromEntry(entry = {}) {
  const direct = entry.thumbnail_url || entry.thumbnailUrl || entry.media_url || entry.media_url_https || entry.image || '';
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) return direct.replace(/\\\//g, '/');
  const media = entry.extended_entities?.media || entry.entities?.media || entry.media || [];
  const first = Array.isArray(media) ? media.find(Boolean) : null;
  const url = first?.media_url_https || first?.media_url || first?.url || '';
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url.replace(/\\\//g, '/') : '';
}

function entryToItem(entry, sourceName) {
  const url = urlFromEntry(entry);
  if (!url) return null;
  const sourceId = tweetIdFromUrl(url) || crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const text = cleanText(entry.full_text || entry.fullText || entry.text || entry.caption || entry.description || entry.note, 1200);
  const author = cleanText(entry.name || entry.author || entry.user_name || entry.userName || entry.user?.name, 120);
  const username = cleanText(entry.screen_name || entry.screenName || entry.username || entry.user_screen_name || entry.user?.screen_name || entry.user?.screenName, 80).replace(/^@/, '');
  const rawCreatedAt = cleanText(entry.created_at || entry.createdAt || entry.date || entry.bookmarked_at || entry.saved_at, 80);
  const createdAt = normalizeSourceSavedAt(rawCreatedAt) || rawCreatedAt;
  const title = text ? cleanText(text, 120) : `X bookmark ${sourceId}`;
  const sourceAuthor = username ? `@${username}` : author || 'X';
  const caption = [
    text || title,
    sourceAuthor ? `Author: ${sourceAuthor}` : '',
    createdAt ? `Tweet date: ${createdAt}` : '',
    `Source: X`,
    `URL: ${url}`,
  ].filter(Boolean).join('\n');

  return {
    id: `x-${sourceId}`,
    url,
    contentType: 'post',
    caption,
    hashtags: extractHashtags(caption),
    ownerName: author || 'X',
    ownerUsername: username,
    savedAt: createdAt || '',
    collections: ['X bookmarks'],
    sourceName,
    platform: 'X / Twitter',
    platformKey: 'x-twitter',
    sourceId,
    sourceTitle: title,
    sourceAuthor,
    sourceDescription: text,
    thumbnailUrl: mediaUrlFromEntry(entry),
  };
}

function extractUrlItemsFromText(text, sourceName) {
  const urls = String(text || '').match(/https?:\/\/(?:mobile\.)?(?:twitter\.com|x\.com)\/[^\s"'<>\\]+/gi) || [];
  return urls
    .map((url) => entryToItem({ url }, sourceName))
    .filter(Boolean);
}

function extractXItemsFromText(text, sourceName) {
  const parsed = parseJsonLike(text);
  const entries = parsed ? collectEntries(parsed) : [];
  if (entries.length) return entries.map((entry) => entryToItem(entry, sourceName)).filter(Boolean);

  const csvRows = parseCsv(text);
  if (csvRows.length) return csvRows.map((entry) => entryToItem(entry, sourceName)).filter(Boolean);

  return extractUrlItemsFromText(text, sourceName);
}

function textFromBuffer(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  if (text.includes('\u0000')) return '';
  return text;
}

function isXBookmarkEntry(sourceName = '') {
  const normalized = String(sourceName || '').replace(/\\/g, '/').toLowerCase();
  const base = path.basename(normalized);
  return /bookmark|x[-_ ]?bookmark|twitter[-_ ]?bookmark|pauch/.test(normalized)
    || /^(bookmarks?|tweets?|x[-_ ]?bookmarks?|twitter[-_ ]?bookmarks?|pauch[-_ ]?.*)\.(json|js|csv|txt)$/.test(base);
}

async function textEntriesFromZip(file) {
  const zip = await JSZip.loadAsync(file.buffer);
  const entries = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const extension = path.extname(entry.name || '').toLowerCase();
    if (!X_TEXT_EXTENSIONS.has(extension)) continue;
    if (!isXBookmarkEntry(entry.name)) continue;
    entries.push({ sourceName: entry.name, text: await entry.async('string') });
  }
  return entries;
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
    existing.sourceTitle ||= item.sourceTitle;
    existing.sourceDescription ||= item.sourceDescription;
    existing.thumbnailUrl ||= item.thumbnailUrl;
    existing.hashtags = [...new Set([...(existing.hashtags || []), ...(item.hashtags || [])])];
    existing.collections = [...new Set([...(existing.collections || []), ...(item.collections || [])])];
  }
  return [...byUrl.values()];
}

async function parseXBookmarksExport(files = []) {
  const allItems = [];
  for (const file of files) {
    const sourceName = file.originalname || file.filename || 'x-bookmarks';
    const extension = path.extname(sourceName).toLowerCase();
    if (extension === '.zip') {
      let entries = [];
      try {
        entries = await textEntriesFromZip(file);
      } catch (_error) {
        const error = new Error('This X bookmarks ZIP could not be opened. Upload the original export ZIP or a bookmarks CSV/JSON file.');
        error.statusCode = 400;
        throw error;
      }
      for (const entry of entries) {
        allItems.push(...extractXItemsFromText(entry.text, entry.sourceName));
      }
      continue;
    }
    if (!X_TEXT_EXTENSIONS.has(extension)) continue;
    const rawText = textFromBuffer(file.buffer || file.content);
    if (!rawText) continue;
    allItems.push(...extractXItemsFromText(rawText, sourceName));
  }

  const items = mergeItems(allItems);
  return {
    items,
    collections: items.length ? [{ name: 'X bookmarks', sourceName: 'x-bookmarks', itemUrls: items.map((item) => item.url) }] : [],
  };
}

module.exports = {
  extractXItemsFromText,
  isXBookmarkEntry,
  normalizeXUrl,
  parseCsv,
  parseXBookmarksExport,
};
