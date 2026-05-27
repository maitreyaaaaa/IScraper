const { checkPageReachable } = require('../services/pageArchive');
const {
  buildLibraryCareSummary,
  linkCheckCandidates,
} = require('../services/libraryCare');
const { traceForRequest } = require('../services/observability');
const { captureWorkflow, cleanText } = require('./common');

function reviewUpdatesFromBody(body = {}, item = {}) {
  const sourceTitle = cleanText(body.sourceTitle ?? body.title ?? item.sourceTitle, 160);
  const sourceAuthor = cleanText(body.sourceAuthor ?? body.author ?? item.sourceAuthor, 120);
  const sourceDescription = cleanText(body.sourceDescription ?? body.description ?? item.sourceDescription, 500);
  const note = cleanText(body.note, 500);
  const collections = Array.isArray(body.collections)
    ? body.collections.map((entry) => cleanText(entry, 80)).filter(Boolean).slice(0, 12)
    : cleanText(body.collection, 80)
      ? [cleanText(body.collection, 80)]
      : item.collections || [];
  const caption = [
    sourceTitle || item.sourceTitle || item.url,
    sourceDescription ? `Description: ${sourceDescription}` : '',
    note ? `Note: ${note}` : '',
    `Source: ${item.platform || 'Web'}`,
    `URL: ${item.url}`,
  ].filter(Boolean).join('\n');

  return {
    sourceTitle,
    sourceAuthor,
    sourceDescription,
    collections,
    caption,
  };
}

async function approveReviewItemsForIndexing({ store, userId, items, trace = {} }) {
  const queuedItems = [];
  const jobs = [];
  let fallbackImportId = null;

  for (const item of items) {
    let importId = item.importId;
    if (!importId) {
      if (!fallbackImportId) {
        const importEntry = await store.createImport({
          userId,
          source: 'bulk-review-approval',
          mode: 'export',
          fileNames: items.map((entry) => entry.url).slice(0, 20),
          requestId: trace.requestId || '',
          correlationId: trace.correlationId || '',
        });
        fallbackImportId = importEntry.id;
      }
      importId = fallbackImportId;
    }

    const updated = await store.updateSavedItem(userId, item.id, {
      importId,
      status: item.status === 'done' ? 'done' : 'queued',
      error: null,
    });
    if (updated && updated.status !== 'done') queuedItems.push(updated);
  }

  const itemsByImportId = queuedItems.reduce((groups, item) => {
    const importId = item.importId;
    if (!groups.has(importId)) groups.set(importId, []);
    groups.get(importId).push(item);
    return groups;
  }, new Map());

  for (const [importId, importItems] of itemsByImportId.entries()) {
    jobs.push(...await store.createJobs({
      userId,
      importId,
      items: importItems,
      requestId: trace.requestId || '',
      correlationId: trace.correlationId || '',
      sourceAction: trace.sourceAction || 'bulk-review-approval',
    }));
  }

  return { items: queuedItems, jobs };
}

function createLibraryWorkflow({ store, worker }) {
  async function refreshSmartCollectionsForUser(userId) {
    if (typeof store.refreshSmartCollections !== 'function') return [];
    try {
      return await store.refreshSmartCollections(userId);
    } catch (error) {
      console.warn('Smart Collections refresh failed:', error.message);
      return [];
    }
  }

  async function libraryCareSummary(userId) {
    const [items, linkChecks, reminders] = await Promise.all([
      store.getItems(userId),
      typeof store.listLinkHealthChecks === 'function' ? store.listLinkHealthChecks(userId) : [],
      typeof store.listItemReminders === 'function' ? store.listItemReminders(userId) : [],
    ]);
    return buildLibraryCareSummary({ items, linkChecks, reminders });
  }

  async function checkLibraryLinks({ userId, limit = 20 }) {
    if (typeof store.upsertLinkHealthCheck !== 'function') return { checked: [], skipped: true };
    const [items, checks] = await Promise.all([
      store.getItems(userId),
      typeof store.listLinkHealthChecks === 'function' ? store.listLinkHealthChecks(userId) : [],
    ]);
    const candidates = linkCheckCandidates(items, checks, limit);
    const checked = [];
    for (const item of candidates) {
      let result;
      try {
        result = await checkPageReachable(item.url);
      } catch (error) {
        result = {
          status: 'unknown',
          sourceUrl: item.url,
          finalUrl: '',
          httpStatus: null,
          errorCode: error?.code || 'check_failed',
          errorMessage: 'This link could not be checked right now.',
          checkedAt: new Date().toISOString(),
        };
      }
      const saved = await store.upsertLinkHealthCheck(userId, item.id, result);
      if (saved) checked.push(saved);
    }
    return { checked, skipped: false };
  }

  async function queueSingleItemEnrichment(req, itemId, { force = false, reason = 'detail-opened' } = {}) {
    if (typeof store.updateSavedItem !== 'function' || typeof store.createJobs !== 'function') {
      const error = new Error('Indexing jobs are not available.');
      error.statusCode = 501;
      throw error;
    }

    let item = await store.getItem(req.user.id, itemId);
    if (!item) {
      const error = new Error('Item not found.');
      error.statusCode = 404;
      throw error;
    }
    if (item.status === 'needs_review') {
      return { item, skipped: true, reason: 'needs_review' };
    }
    if (!force && ['queued', 'downloading', 'analyzing'].includes(item.status)) {
      return { item: { ...item, indexingStage: 'visual_indexing', lastEnrichmentRequestedAt: new Date().toISOString() }, skipped: true, reason: 'already_queued' };
    }

    const trace = traceForRequest(req);
    const importEntry = await store.createImport({
      userId: req.user.id,
      source: reason,
      mode: 'export',
      fileNames: [item.url || item.id],
      requestId: trace.requestId,
      correlationId: trace.correlationId,
    });
    item = await store.updateSavedItem(req.user.id, item.id, {
      importId: importEntry.id,
      status: 'queued',
      error: null,
    });
    const jobs = await store.createJobs({ userId: req.user.id, importId: importEntry.id, items: [item], ...trace, sourceAction: reason });
    const indexing = jobs.length
      ? await worker.queueIndexingWork({
        reason,
        userId: req.user.id,
        importId: importEntry.id,
        shouldDownload: req.body?.allowMedia !== false,
        requestId: trace.requestId,
        correlationId: trace.correlationId,
      })
      : null;
    const responseItem = { ...item, indexingStage: 'visual_indexing', lastEnrichmentRequestedAt: new Date().toISOString() };
    captureWorkflow(req, 'enrichment queued', { itemId: item.id, importId: importEntry.id, queuedJobCount: jobs.length, reason });
    return { item: responseItem, enriched: false, queued: Boolean(jobs.length), queuedJobCount: jobs.length, jobs, indexing, reason, requestId: trace.requestId, correlationId: trace.correlationId };
  }

  return {
    approveReviewItemsForIndexing: (args) => approveReviewItemsForIndexing({ store, ...args }),
    checkLibraryLinks,
    libraryCareSummary,
    queueSingleItemEnrichment,
    refreshSmartCollectionsForUser,
    reviewUpdatesFromBody,
  };
}

module.exports = {
  createLibraryWorkflow,
  reviewUpdatesFromBody,
};
