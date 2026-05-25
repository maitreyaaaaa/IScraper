const path = require('path');
const JSZip = require('jszip');
const { parseInstagramExport } = require('./instagramParser');
const { parsePinterestExport } = require('./pinterestParser');
const { parseXBookmarksExport } = require('./xBookmarksParser');

const INSTAGRAM_EXPORT_EXTENSIONS = new Set(['.html', '.htm', '.json']);
const INSTAGRAM_SAVED_EXPORT_NAMES = new Set([
  'saved_posts.html',
  'saved_posts.htm',
  'saved_posts.json',
  'saved_post.html',
  'saved_post.htm',
  'saved_post.json',
  'saved_collections.html',
  'saved_collections.htm',
  'saved_collections.json',
]);

function isInstagramSavedExportFile(sourceName = '') {
  const normalized = String(sourceName || '').replace(/\\/g, '/').toLowerCase();
  const fileName = path.basename(normalized);
  if (!INSTAGRAM_SAVED_EXPORT_NAMES.has(fileName)) return false;
  return normalized.includes('/your_instagram_activity/saved/') || normalized.includes('your_instagram_activity/saved/') || !normalized.includes('/');
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

async function instagramFilesFromUploads(files = []) {
  const instagramFiles = [];

  for (const file of files) {
    const sourceName = file.originalname || file.filename || 'instagram-export';
    const extension = path.extname(sourceName).toLowerCase();

    if (INSTAGRAM_EXPORT_EXTENSIONS.has(extension) && isInstagramSavedExportFile(sourceName)) {
      instagramFiles.push(file);
      continue;
    }

    if (extension !== '.zip') continue;

    const zip = await JSZip.loadAsync(file.buffer);
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const entryExtension = path.extname(entry.name || '').toLowerCase();
      if (!INSTAGRAM_EXPORT_EXTENSIONS.has(entryExtension)) continue;
      if (!isInstagramSavedExportFile(entry.name)) continue;
      const buffer = await entry.async('nodebuffer');
      instagramFiles.push({
        ...file,
        originalname: entry.name,
        filename: entry.name,
        buffer,
        size: buffer.length,
        mimetype: entryExtension === '.json' ? 'application/json' : 'text/html',
      });
    }
  }

  return instagramFiles;
}

async function parseImportExport(files = []) {
  const instagramFiles = await instagramFilesFromUploads(files);
  const instagramParsed = instagramFiles.length ? parseInstagramExport(instagramFiles) : { items: [], collections: [] };
  const pinterestParsed = await parsePinterestExport(files);
  const xParsed = await parseXBookmarksExport(files);
  const parsed = mergeParsedResults([instagramParsed, pinterestParsed, xParsed]);
  const source = [
    [instagramParsed, 'instagram-export'],
    [pinterestParsed, 'pinterest-export'],
    [xParsed, 'x-bookmarks'],
  ].filter(([result]) => result.items.length);

  return {
    ...parsed,
    source: source.length === 1 ? source[0][1] : 'user-export',
  };
}

module.exports = {
  parseImportExport,
};
