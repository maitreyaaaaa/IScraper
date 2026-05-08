const path = require('path');
const { parseInstagramExport } = require('./instagramParser');
const { parsePinterestExport } = require('./pinterestParser');

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

async function parseImportExport(files = []) {
  const htmlFiles = files.filter((file) => ['.html', '.htm'].includes(path.extname(file.originalname || '').toLowerCase()));
  const instagramParsed = htmlFiles.length ? parseInstagramExport(htmlFiles) : { items: [], collections: [] };
  const pinterestParsed = await parsePinterestExport(files);
  const parsed = mergeParsedResults([instagramParsed, pinterestParsed]);

  return {
    ...parsed,
    source: pinterestParsed.items.length && !instagramParsed.items.length ? 'pinterest-export' : 'user-export',
  };
}

module.exports = {
  parseImportExport,
};
