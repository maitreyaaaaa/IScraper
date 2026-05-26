const JSZip = require('jszip');
const { buildKnowledgeGraph, buildObsidianFiles } = require('../services/graph');
const { normalizeReminderInput } = require('../services/libraryCare');
const {
  MAX_NOTE_IMAGES,
  NOTE_CONTENT_TYPE,
  buildNoteItem,
  noteInputFromBody,
} = require('../services/notes');
const { findSimilarVisualItems: findItemSimilarVisuals } = require('../services/similarVisuals');

function registerLibraryRoutes(app, deps) {
  const { http, store, workflows } = deps;
  const { asyncRoute, captureWorkflow } = http;
  const { requireAccountNotDeleting, requireCompletedProfile } = http.auth;
  const { importRateLimit, searchRateLimit } = http.rateLimiters;
  const { noteUpload } = http.uploaders;
  const {
    approveReviewItemsForIndexing,
    checkLibraryLinks,
    libraryCareSummary,
    queueSingleItemEnrichment,
    refreshSmartCollectionsForUser,
    reviewUpdatesFromBody,
  } = workflows.library;
  const { queueIndexingWork } = workflows.worker;
  const {
    archiveHost,
    captureReadableCopyForItem,
    shouldAttemptPageArchive,
  } = workflows.archive;
  const { persistNoteImages, removeNoteAssetObjects } = workflows.notes;

  app.get('/api/privacy-export', asyncRoute(async (req, res) => {
    if (typeof store.getPrivacyExport !== 'function') return res.status(501).json({ error: 'Privacy export is not available.' });
    const exportData = await store.getPrivacyExport(req.user.id);
    captureWorkflow(req, 'privacy export generated', {
      itemCount: exportData.items?.length || 0,
      importCount: exportData.imports?.length || 0,
    });
    res.json({ export: exportData });
  }));

  app.use(asyncRoute(async (req, _res, next) => {
    await requireAccountNotDeleting(req, store);
    next();
  }));

  app.get('/api/data', asyncRoute(async (req, res) => {
    const data = await store.getItems(req.user.id);
    res.json({ data });
  }));

  app.get('/api/items', asyncRoute(async (req, res) => {
    const paged = ['limit', 'cursor', 'sort', 'type', 'state', 'collection', 'platform'].some((key) => Object.prototype.hasOwnProperty.call(req.query, key));
    if (paged && typeof store.listItemsPage === 'function') {
      const page = await store.listItemsPage(req.user.id, {
        limit: req.query.limit,
        cursor: req.query.cursor,
        sort: req.query.sort,
        type: req.query.type,
        state: req.query.state,
        collection: req.query.collection,
        platform: req.query.platform,
      });
      return res.json(page);
    }
    const items = await store.getItems(req.user.id);
    return res.json({ items });
  }));

  app.get('/api/smart-collections', asyncRoute(async (req, res) => {
    if (typeof store.listSmartCollections !== 'function') return res.json({ collections: [] });
    const collections = await store.listSmartCollections(req.user.id, {
      limit: req.query.limit,
      includeHidden: req.query.includeHidden === 'true',
    });
    return res.json({ collections });
  }));

  app.post('/api/smart-collections/refresh', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const collections = await refreshSmartCollectionsForUser(req.user.id);
    captureWorkflow(req, 'smart collections refreshed', { collectionCount: collections.length });
    return res.json({ collections });
  }));

  app.get('/api/smart-collections/:id/items', asyncRoute(async (req, res) => {
    if (typeof store.listSmartCollectionItems !== 'function') return res.status(501).json({ error: 'Smart Collections are not available.' });
    const page = await store.listSmartCollectionItems(req.user.id, req.params.id, {
      limit: req.query.limit,
      cursor: req.query.cursor,
      sort: req.query.sort,
      type: req.query.type,
      state: req.query.state,
      collection: req.query.collection,
      platform: req.query.platform,
    });
    if (!page) return res.status(404).json({ error: 'Smart Collection not found.' });
    return res.json(page);
  }));

  app.patch('/api/smart-collections/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSmartCollection !== 'function') return res.status(501).json({ error: 'Smart Collections are not available.' });
    const collection = await store.updateSmartCollection(req.user.id, req.params.id, req.body || {});
    if (!collection) return res.status(404).json({ error: 'Smart Collection not found.' });
    captureWorkflow(req, 'smart collection updated', { collectionId: req.params.id });
    return res.json({ collection });
  }));

  app.post('/api/smart-collections/:id/items/:itemId', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.setSmartCollectionItemOverride !== 'function') return res.status(501).json({ error: 'Smart Collections are not available.' });
    const collection = await store.setSmartCollectionItemOverride(
      req.user.id,
      req.params.id,
      req.params.itemId,
      req.body?.action,
    );
    if (!collection) return res.status(404).json({ error: 'Smart Collection or item not found.' });
    captureWorkflow(req, 'smart collection item override updated', { collectionId: req.params.id, itemId: req.params.itemId, action: req.body?.action || 'exclude' });
    return res.json({ collection });
  }));

  app.get('/api/library-care', asyncRoute(async (req, res) => {
    if (typeof store.getItems !== 'function') return res.status(501).json({ error: 'Library checkup is not available.' });
    return res.json(await libraryCareSummary(req.user.id));
  }));

  app.post('/api/library-care/check-links', importRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 20, 50));
    const result = await checkLibraryLinks({ userId: req.user.id, limit });
    const summary = await libraryCareSummary(req.user.id);
    captureWorkflow(req, 'library links checked', {
      checkedCount: result.checked?.length || 0,
      brokenCount: summary.cleanup.brokenLinkCount,
      unknownCount: (result.checked || []).filter((entry) => entry.status === 'unknown').length,
    });
    return res.json({ ...summary, checked: result.checked || [] });
  }));

  app.post('/api/items/:id/reminders', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.createItemReminder !== 'function') return res.status(501).json({ error: 'Reminders are not available.' });
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    const input = normalizeReminderInput(req.body || {});
    const reminder = await store.createItemReminder(req.user.id, item.id, input);
    if (!reminder) return res.status(404).json({ error: 'Item not found.' });
    captureWorkflow(req, 'item reminder created', { itemId: item.id, reminderId: reminder.id, reason: reminder.reason });
    return res.status(201).json({ reminder, item });
  }));

  app.patch('/api/reminders/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateItemReminder !== 'function') return res.status(501).json({ error: 'Reminders are not available.' });
    const status = ['done', 'dismissed', 'pending'].includes(req.body?.status) ? req.body.status : 'done';
    const reminder = await store.updateItemReminder(req.user.id, req.params.id, {
      status,
      completedAt: status === 'done' || status === 'dismissed' ? new Date().toISOString() : null,
    });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found.' });
    captureWorkflow(req, 'item reminder updated', { reminderId: reminder.id, status });
    return res.json({ reminder });
  }));

  app.post('/api/notes', noteUpload.array('images', MAX_NOTE_IMAGES), asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.createNoteItem !== 'function' || typeof store.addItemAsset !== 'function') {
      return res.status(501).json({ error: 'Notes are not available.' });
    }
    const input = noteInputFromBody(req.body || {});
    if (!input.body && !input.links.length && !req.files?.length) {
      return res.status(400).json({ error: 'Write a note, add a link, or attach an image before saving.' });
    }
    let item = await store.createNoteItem(req.user.id, buildNoteItem({ userId: req.user.id, input }));
    try {
      if (req.files?.length) {
        await persistNoteImages({ userId: req.user.id, itemId: item.id, files: req.files });
        item = await store.getItem(req.user.id, item.id);
      }
    } catch (error) {
      if (item?.id && typeof store.deleteSavedItem === 'function') {
        await store.deleteSavedItem(req.user.id, item.id).catch(() => {});
      }
      throw error;
    }
    captureWorkflow(req, 'note created', {
      itemId: item.id,
      linkCount: input.links.length,
      imageCount: item.assets?.length || 0,
    });
    await refreshSmartCollectionsForUser(req.user.id);
    return res.status(201).json({ item });
  }));

  app.patch('/api/notes/:id', noteUpload.array('images', MAX_NOTE_IMAGES), asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSavedItem !== 'function') return res.status(501).json({ error: 'Notes are not available.' });
    const existing = await store.getItem(req.user.id, req.params.id);
    if (!existing || existing.contentType !== NOTE_CONTENT_TYPE) return res.status(404).json({ error: 'Note not found.' });
    const input = noteInputFromBody(req.body || {});
    const assetIds = typeof req.body?.removeAssetIds === 'string'
      ? req.body.removeAssetIds.split(',').map((entry) => entry.trim()).filter(Boolean)
      : Array.isArray(req.body?.removeAssetIds)
        ? req.body.removeAssetIds
        : [];
    const existingAssets = typeof store.listItemAssets === 'function' ? await store.listItemAssets(req.user.id, existing.id) : existing.assets || [];
    const remainingCount = existingAssets.filter((asset) => !assetIds.includes(asset.id)).length;
    if (remainingCount + (req.files?.length || 0) > MAX_NOTE_IMAGES) {
      return res.status(400).json({ error: `Notes support up to ${MAX_NOTE_IMAGES} images.` });
    }
    const nextItem = buildNoteItem({
      userId: req.user.id,
      id: existing.id,
      input,
      createdAt: existing.savedAt || existing.createdAt || new Date().toISOString(),
    });
    let removedAssets = [];
    if (assetIds.length && typeof store.removeItemAssets === 'function') {
      removedAssets = await store.removeItemAssets(req.user.id, existing.id, assetIds);
      await removeNoteAssetObjects({ assets: removedAssets });
    }
    await store.updateSavedItem(req.user.id, existing.id, {
      caption: nextItem.caption,
      collections: nextItem.collections,
      sourceTitle: nextItem.sourceTitle,
      sourceAuthor: nextItem.sourceAuthor,
      sourceDescription: nextItem.sourceDescription,
      platform: nextItem.platform,
      platformKey: nextItem.platformKey,
      sourceId: nextItem.sourceId,
      status: 'done',
      error: null,
      note: nextItem.note,
    });
    if (req.files?.length) {
      await persistNoteImages({ userId: req.user.id, itemId: existing.id, files: req.files });
    }
    const item = await store.getItem(req.user.id, existing.id);
    captureWorkflow(req, 'note updated', {
      itemId: item.id,
      linkCount: input.links.length,
      imageCount: item.assets?.length || 0,
      removedImageCount: removedAssets.length,
    });
    await refreshSmartCollectionsForUser(req.user.id);
    return res.json({ item });
  }));

  app.delete('/api/notes/:id', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.deleteSavedItem !== 'function') return res.status(501).json({ error: 'Notes are not available.' });
    const existing = await store.getItem(req.user.id, req.params.id);
    if (!existing || existing.contentType !== NOTE_CONTENT_TYPE) return res.status(404).json({ error: 'Note not found.' });
    const assets = typeof store.listItemAssets === 'function' ? await store.listItemAssets(req.user.id, existing.id) : existing.assets || [];
    const deleted = await store.deleteSavedItem(req.user.id, existing.id);
    await removeNoteAssetObjects({ assets });
    captureWorkflow(req, 'note deleted', { itemId: existing.id, imageCount: assets.length });
    await refreshSmartCollectionsForUser(req.user.id);
    return res.json({ deleted: Boolean(deleted), itemId: existing.id });
  }));

  app.get('/api/items/:id', asyncRoute(async (req, res) => {
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    return res.json({ item });
  }));

  app.post('/api/items/:id/archive', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.upsertItemArchive !== 'function') return res.status(501).json({ error: 'Page backup is not available.' });
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    if (!shouldAttemptPageArchive(item)) return res.status(400).json({ error: 'This save cannot be backed up as a readable page.' });
    const archive = await captureReadableCopyForItem({ userId: req.user.id, item, force: true });
    const updated = await store.getItem(req.user.id, req.params.id);
    captureWorkflow(req, archive?.status === 'ready' ? 'page backup saved' : 'page backup failed', {
      itemId: item.id,
      host: archiveHost(item.url),
      status: archive?.status || 'failed',
      errorCode: archive?.errorCode || '',
      byteSize: archive?.byteSize || 0,
    });
    return res.json({ item: updated ? { ...updated, archive: archive || updated.archive } : item, archive });
  }));

  app.get('/api/items/:id/similar-visuals', searchRateLimit, asyncRoute(async (req, res) => {
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    const items = await store.getItems(req.user.id);
    const result = findItemSimilarVisuals(items, item.id, { limit: req.query.limit });
    return res.json({
      item,
      results: result.items,
    });
  }));

  app.patch('/api/items/:id/review', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSavedItem !== 'function') return res.status(501).json({ error: 'Review updates are not available.' });
    const item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    const updated = await store.updateSavedItem(req.user.id, item.id, reviewUpdatesFromBody(req.body || {}, item));
    return res.json({ item: updated });
  }));

  app.post('/api/items/:id/approve', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSavedItem !== 'function') return res.status(501).json({ error: 'Review approval is not available.' });
    let item = await store.getItem(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });

    item = await store.updateSavedItem(req.user.id, item.id, {
      ...reviewUpdatesFromBody(req.body || {}, item),
      status: item.status === 'done' ? 'done' : 'queued',
      error: null,
    });

    let importId = item.importId;
    if (!importId) {
      const importEntry = await store.createImport({
        userId: req.user.id,
        source: 'review-approval',
        mode: 'export',
        fileNames: [item.url],
      });
      importId = importEntry.id;
      item = await store.updateSavedItem(req.user.id, item.id, { importId });
    }
    captureWorkflow(req, 'review item approved', { itemId: item.id, importId });

    const jobs = item.status === 'done' ? [] : await store.createJobs({ userId: req.user.id, importId, items: [item] });
    let indexing = null;
    if (req.body?.startProcessing !== false && jobs.length) {
      indexing = await queueIndexingWork({
        reason: 'review-approve',
        userId: req.user.id,
        importId,
        shouldDownload: req.body?.download !== false,
      });
    }

    await refreshSmartCollectionsForUser(req.user.id);
    return res.json({ item, queuedJobCount: jobs.length, jobs, indexing });
  }));

  app.post('/api/items/:id/enrich', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const result = await queueSingleItemEnrichment(req, req.params.id, {
      force: req.body?.force === true,
      reason: 'detail-opened',
    });
    return res.json(result);
  }));

  app.post('/api/indexing/start', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.updateSavedItem !== 'function' || typeof store.createJobs !== 'function') {
      return res.status(501).json({ error: 'Indexing jobs are not available.' });
    }

    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 1000, 1000));
    const allItems = await store.getItems(req.user.id);
    const pendingReviewItems = allItems.filter((item) => item.status === 'needs_review');
    const selectedItems = pendingReviewItems.slice(0, limit);
    const { items, jobs } = await approveReviewItemsForIndexing({
      userId: req.user.id,
      items: selectedItems,
    });

    let indexing = null;
    if (jobs.length && req.body?.startProcessing !== false) {
      indexing = await queueIndexingWork({
        reason: 'indexing-start',
        userId: req.user.id,
        importId: null,
        shouldDownload: req.body?.download !== false,
      });
    }

    await refreshSmartCollectionsForUser(req.user.id);
    return res.json({
      message: jobs.length ? 'Saves queued for batch indexing.' : 'No saves are waiting for indexing.',
      approvedCount: items.length,
      queuedJobCount: jobs.length,
      remainingPendingCount: Math.max(pendingReviewItems.length - selectedItems.length, 0),
      items,
      jobs,
      indexing,
    });
  }));

  app.get('/api/indexing/summary', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.getIndexingSummary !== 'function') {
      return res.status(501).json({ error: 'Indexing summary is not available.' });
    }
    const summary = await store.getIndexingSummary(req.user.id);
    return res.json({ summary });
  }));


  app.get('/api/graph', asyncRoute(async (req, res) => {
    const items = await store.getItems(req.user.id);
    const graph = buildKnowledgeGraph(items);
    captureWorkflow(req, 'knowledge graph built', { itemCount: items.length, nodeCount: graph.nodes.length, linkCount: graph.links.length });
    res.json({ graph });
  }));

  app.get('/api/graph/obsidian-export', asyncRoute(async (req, res) => {
    const items = await store.getItems(req.user.id);
    const graph = buildKnowledgeGraph(items);
    const files = buildObsidianFiles(graph);
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.path, file.content);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="iscraper-obsidian-graph.zip"');
    captureWorkflow(req, 'obsidian graph exported', { itemCount: items.length, fileCount: files.length });
    res.send(buffer);
  }));
}

module.exports = {
  registerLibraryRoutes,
};
