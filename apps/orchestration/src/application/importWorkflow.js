const { parseImportExport } = require('../services/exportParser');
const { parseManualLinkPayload } = require('../services/linkSaver');

function createImportWorkflow({ store, archive, library, worker }) {
  async function createImportFromFiles({ userId, files }) {
    const parsed = await parseImportExport(files);
    if (!parsed.items.length) {
      const error = new Error('No saves were found in those files. Upload Instagram saved-post files, Pinterest export files, or X bookmark export files.');
      error.statusCode = 400;
      throw error;
    }
    const importEntry = await store.createImport({
      userId,
      source: parsed.source || 'user-export',
      mode: 'export',
      fileNames: files.map((file) => file.originalname),
    });
    const items = await store.upsertImportData({
      userId,
      importId: importEntry.id,
      parsed,
      initialStatus: 'queued',
      duplicateMode: 'skipExisting',
    });
    const jobs = typeof store.createJobs === 'function'
      ? await store.createJobs({ userId, importId: importEntry.id, items })
      : [];

    return {
      import: importEntry,
      itemCount: parsed.items.length,
      totalItemCount: parsed.items.length,
      newItemCount: items.length,
      skippedDuplicateCount: Math.max(parsed.items.length - items.length, 0),
      collectionCount: parsed.collections.length,
      queuedJobCount: jobs.length,
      jobCount: jobs.length,
    };
  }

  async function saveLinkCapture({
    req,
    userId,
    payload,
    source = 'manual-link',
    reason = 'manual-link',
    initialStatus = 'queued',
    shouldArchive = true,
  }) {
    const parsed = parseManualLinkPayload(payload || {});
    const importEntry = await store.createImport({
      userId,
      source,
      mode: 'export',
      fileNames: [parsed.items[0].url],
    });
    const items = await store.upsertImportData({ userId, importId: importEntry.id, parsed, initialStatus });
    const jobs = initialStatus === 'queued' ? await store.createJobs({ userId, importId: importEntry.id, items }) : [];
    let responseItem = null;
    try {
      responseItem = await Promise.resolve(store.getItem(userId, items[0]?.id || parsed.items[0].id));
    } catch {
      responseItem = null;
    }
    if (shouldArchive && responseItem) {
      const pageArchive = await archive.startReadableCopyForItem({ req, userId, item: responseItem });
      if (pageArchive) responseItem = { ...responseItem, archive: pageArchive };
    }
    let indexing = null;
    if (jobs.length) {
      indexing = await worker.queueIndexingWork({
        reason,
        userId,
        importId: importEntry.id,
        shouldDownload: false,
      });
    }
    await library.refreshSmartCollectionsForUser(userId);
    return {
      import: importEntry,
      item: responseItem || items[0] || parsed.items[0],
      newItemCount: items.length,
      skippedDuplicateCount: items.length ? 0 : 1,
      queuedJobCount: jobs.length,
      indexing,
    };
  }

  return {
    createImportFromFiles,
    parseManualLinkPayload,
    saveLinkCapture,
  };
}

module.exports = {
  createImportWorkflow,
};
