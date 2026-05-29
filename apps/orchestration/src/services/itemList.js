const DEFAULT_PAGE_LIMIT = 60;
const MAX_PAGE_LIMIT = 100;
const { sourceSavedAtOrCreatedAt } = require('./sourceDates');

function normalizeCursor(cursor) {
  if (!cursor) return 0;
  const direct = Number(cursor);
  if (Number.isInteger(direct) && direct >= 0) return direct;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    const offset = Number(parsed.offset);
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function cursorForOffset(offset, totalCount) {
  if (!Number.isInteger(offset) || offset <= 0 || offset >= totalCount) return null;
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

function normalizeListOptions(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT));
  return {
    limit,
    offset: normalizeCursor(options.cursor),
    sort: ['newest', 'oldest', 'updated', 'title'].includes(options.sort) ? options.sort : 'newest',
    type: ['all', 'uploaded', 'links', 'screenshots', 'voice_notes', 'notes'].includes(options.type) ? options.type : 'all',
    state: ['all', 'needs_review', 'searchable', 'enriched', 'failed'].includes(options.state) ? options.state : 'all',
    collection: cleanFilter(options.collection),
    platform: cleanFilter(options.platform),
  };
}

function cleanFilter(value) {
  const text = String(value || 'all').trim();
  return text || 'all';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isExtensionCaptureItem(item) {
  return item?.platformKey === 'iscraper-extension-capture';
}

function indexingStageFromStatus(status = 'queued', analysis = null) {
  if (status === 'failed') return 'index_failed';
  if (status === 'done') {
    if (analysis?.transcript) return 'deep_indexed';
    if (analysis?.visualDescription || analysis?.ocrText) return 'visual_indexed';
    return 'text_indexed';
  }
  if (status === 'downloading' || status === 'analyzing') return 'visual_indexing';
  return 'metadata_ready';
}

function isNoteItem(item) {
  return !isExtensionCaptureItem(item) && (item?.contentType === 'note' || item?.platformKey === 'iscraper-note');
}

function isLinkItem(item) {
  return item?.platformKey === 'web' || String(item?.id || '').startsWith('web-');
}

function isVoiceNoteItem(item) {
  return ['voice', 'voice_note', 'audio'].includes(item?.contentType) || item?.platformKey === 'iscraper-voice-note';
}

function itemTypeMatches(item, type) {
  if (type === 'all') return true;
  if (type === 'notes') return isNoteItem(item);
  if (type === 'links') return isLinkItem(item);
  if (type === 'screenshots') return isExtensionCaptureItem(item);
  if (type === 'voice_notes') return isVoiceNoteItem(item);
  if (type === 'uploaded') return !isNoteItem(item) && !isLinkItem(item) && !isExtensionCaptureItem(item) && !isVoiceNoteItem(item);
  return true;
}

function itemStateMatches(item, state) {
  const indexingStage = item.indexingStage || indexingStageFromStatus(item.status, item.analysis);
  if (state === 'all') return true;
  if (state === 'needs_review') return item.status === 'needs_review';
  if (state === 'searchable') return item.status !== 'needs_review';
  if (state === 'enriched') return ['text_indexed', 'visual_indexing', 'visual_indexed', 'deep_indexed'].includes(indexingStage);
  if (state === 'failed') return indexingStage === 'index_failed' || item.status === 'failed' || item.status === 'paused';
  return true;
}

function sortedItems(items, sort) {
  const copy = [...items];
  if (sort === 'oldest') {
    return copy.sort((a, b) => String(sourceSavedAtOrCreatedAt(a)).localeCompare(String(sourceSavedAtOrCreatedAt(b))) || String(a.id).localeCompare(String(b.id)));
  }
  if (sort === 'updated') {
    return copy.sort((a, b) => String(b.updatedAt || sourceSavedAtOrCreatedAt(b)).localeCompare(String(a.updatedAt || sourceSavedAtOrCreatedAt(a))) || String(a.id).localeCompare(String(b.id)));
  }
  if (sort === 'title') {
    return copy.sort((a, b) => String(a.sourceTitle || a.analysis?.title || a.caption || '').localeCompare(String(b.sourceTitle || b.analysis?.title || b.caption || '')) || String(a.id).localeCompare(String(b.id)));
  }
  return copy.sort((a, b) => String(sourceSavedAtOrCreatedAt(b)).localeCompare(String(sourceSavedAtOrCreatedAt(a))) || String(a.id).localeCompare(String(b.id)));
}

function facetsForItems(items = []) {
  return {
    collections: ['all', ...unique(items.flatMap((item) => item.collections || []).filter((value) => value && value !== 'Unsorted')).sort((a, b) => String(a).localeCompare(String(b)))],
    platforms: ['all', ...unique(items
      .filter((item) => !isNoteItem(item))
      .map((item) => item.platform || 'Instagram')
      .filter((value) => value && !['Example', 'IScraper Notes'].includes(value)))
      .sort((a, b) => String(a).localeCompare(String(b)))],
  };
}

function filterItems(items = [], options = {}) {
  const normalized = normalizeListOptions(options);
  return sortedItems(items.filter((item) => {
    if (!itemTypeMatches(item, normalized.type)) return false;
    if (!itemStateMatches(item, normalized.state)) return false;
    if (normalized.collection !== 'all' && !(item.collections || []).includes(normalized.collection)) return false;
    if (normalized.platform !== 'all' && item.platform !== normalized.platform) return false;
    return true;
  }), normalized.sort);
}

function listItemsPageFromItems(items = [], options = {}) {
  const normalized = normalizeListOptions(options);
  const filtered = filterItems(items, normalized);
  const pageItems = filtered.slice(normalized.offset, normalized.offset + normalized.limit);
  return {
    items: pageItems,
    nextCursor: cursorForOffset(normalized.offset + pageItems.length, filtered.length),
    totalCount: filtered.length,
    facets: facetsForItems(items),
    serverTime: new Date().toISOString(),
  };
}

module.exports = {
  facetsForItems,
  filterItems,
  listItemsPageFromItems,
  normalizeListOptions,
};
