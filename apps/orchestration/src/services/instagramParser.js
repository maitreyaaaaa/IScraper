const cheerio = require('cheerio');

function normalizeText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getShortcode(url) {
  return String(url).split('/').filter(Boolean).pop();
}

function getContentType(url) {
  if (url.includes('/reel/')) return 'reel';
  if (url.includes('/p/')) return 'post';
  return 'unknown';
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
    const url = $(anchor).attr('href');
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
    const html = Buffer.isBuffer(file.buffer) ? file.buffer.toString('utf8') : String(file.buffer || file.content || '');
    if (/saved_collections/i.test(sourceName)) {
      const parsed = parseCollectionsHtml(html, sourceName);
      allItems.push(...parsed.items);
      allCollections.push(...parsed.collections);
    } else {
      allItems.push(...parsePostsHtml(html, sourceName));
    }
  }

  return {
    items: mergeItems(allItems),
    collections: allCollections,
  };
}

function validateLoginScrapeConsent(typedEmail, userEmail) {
  return Boolean(typedEmail && userEmail && typedEmail.trim().toLowerCase() === userEmail.trim().toLowerCase());
}

module.exports = {
  parseInstagramExport,
  validateLoginScrapeConsent,
  normalizeText,
};
