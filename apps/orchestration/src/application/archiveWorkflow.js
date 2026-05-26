const {
  PageArchiveError,
  captureReadableCopy,
  shouldAttemptPageArchive,
} = require('../services/pageArchive');
const { captureWorkflow } = require('./common');

function archiveHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function failedArchivePayload(error) {
  const archiveError = error instanceof PageArchiveError ? error : null;
  const errorCode = archiveError?.code || 'capture_failed';
  return {
    status: ['unsupported_protocol', 'blocked_host', 'blocked_port', 'unsupported_content_type', 'no_readable_content'].includes(errorCode) ? 'skipped' : 'failed',
    errorCode,
    errorMessage: archiveError?.message || 'This page could not be backed up.',
    httpStatus: archiveError?.statusCode || null,
    capturedAt: new Date().toISOString(),
  };
}

function createArchiveWorkflow({ store }) {
  async function captureReadableCopyForItem({ userId, item, force = false }) {
    if (!item || !shouldAttemptPageArchive(item) || typeof store.upsertItemArchive !== 'function') return null;
    const existing = typeof store.getItemArchive === 'function' ? await store.getItemArchive(userId, item.id) : null;
    if (existing?.status === 'ready' && !force) return existing;
    await store.upsertItemArchive(userId, item.id, {
      status: 'pending',
      sourceUrl: item.url,
      errorCode: '',
      errorMessage: '',
    });
    try {
      const archive = await captureReadableCopy(item.url);
      return await store.upsertItemArchive(userId, item.id, archive);
    } catch (error) {
      return store.upsertItemArchive(userId, item.id, {
        sourceUrl: item.url,
        ...failedArchivePayload(error),
      });
    }
  }

  async function startReadableCopyForItem({ req, userId, item, force = false }) {
    if (!item || !shouldAttemptPageArchive(item) || typeof store.upsertItemArchive !== 'function') return null;
    const existing = typeof store.getItemArchive === 'function' ? await store.getItemArchive(userId, item.id) : null;
    if (existing?.status === 'ready' && !force) return existing;
    const pending = await store.upsertItemArchive(userId, item.id, {
      status: 'pending',
      sourceUrl: item.url,
      errorCode: '',
      errorMessage: '',
    });
    captureWorkflow(req, 'page backup queued', { itemId: item.id, host: archiveHost(item.url) });
    setTimeout(() => {
      captureReadableCopyForItem({ userId, item, force })
        .then((archive) => {
          const event = archive?.status === 'ready' ? 'page backup saved' : 'page backup skipped';
          req.app?.locals?.observability?.capture(event, {
            itemId: item.id,
            userId,
            host: archiveHost(item.url),
            status: archive?.status || 'failed',
            errorCode: archive?.errorCode || '',
            byteSize: archive?.byteSize || 0,
          }, userId);
        })
        .catch((error) => {
          req.app?.locals?.observability?.warn('page backup failed', {
            itemId: item.id,
            userId,
            host: archiveHost(item.url),
            errorCode: error?.code || 'capture_failed',
          });
        });
    }, 0);
    return pending;
  }

  return {
    archiveHost,
    captureReadableCopyForItem,
    failedArchivePayload,
    shouldAttemptPageArchive,
    startReadableCopyForItem,
  };
}

module.exports = {
  archiveHost,
  createArchiveWorkflow,
  failedArchivePayload,
};
