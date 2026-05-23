const { parseInstagramExport } = require('./instagramParser');
const { parsePinterestExport } = require('./pinterestParser');

const IMPORT_SOURCE_TYPES = new Set(['auto', 'instagram', 'pinterest']);

function normalizeImportSourceType(value) {
  const sourceType = String(value || 'auto').trim().toLowerCase();
  return IMPORT_SOURCE_TYPES.has(sourceType) ? sourceType : 'auto';
}

function mergeParsedResults(results) {
  const collections = [];
  const byUrl = new Map();

  for (const result of results) {
    collections.push(...(result.collections || []));
    for (const item of result.items || []) {
      const existing = byUrl.get(item.url);
      if (!existing) {
        byUrl.set(item.url, item);
        continue;
      }
      existing.caption ||= item.caption;
      existing.sourceTitle ||= item.sourceTitle;
      existing.sourceDescription ||= item.sourceDescription;
      existing.hashtags = [...new Set([...(existing.hashtags || []), ...(item.hashtags || [])])];
      existing.collections = [...new Set([...(existing.collections || []), ...(item.collections || [])])];
    }
  }

  return {
    items: [...byUrl.values()],
    collections,
  };
}

async function parseImportExport(files = [], options = {}) {
  const sourceType = normalizeImportSourceType(options.sourceType);

  if (sourceType === 'instagram') {
    const parsed = await parseInstagramExport(files);
    return { ...parsed, source: 'instagram-export' };
  }

  if (sourceType === 'pinterest') {
    const parsed = await parsePinterestExport(files);
    return { ...parsed, source: 'pinterest-export' };
  }

  const instagramParsed = await parseInstagramExport(files);
  if (instagramParsed.items.length) {
    return { ...instagramParsed, source: 'instagram-export' };
  }

  const pinterestParsed = await parsePinterestExport(files);
  const parsed = mergeParsedResults([instagramParsed, pinterestParsed]);

  return {
    ...parsed,
    source: pinterestParsed.items.length && !instagramParsed.items.length ? 'pinterest-export' : 'user-export',
  };
}

module.exports = {
  parseImportExport,
  normalizeImportSourceType,
};
