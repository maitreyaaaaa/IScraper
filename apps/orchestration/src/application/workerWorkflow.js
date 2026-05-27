const {
  createWorkerRuntime,
  getWorkerStatus,
  processDataExportQueue,
  processWorkerScopes,
  runWorkerPass,
} = require('../runtime/workerRuntime');
const { recordSupportEvent } = require('../services/auditLog');

function createWorkerWorkflow({
  store,
  config,
  http,
  observability = null,
}) {
  const { asyncRoute } = http;
  const { assertWorker } = http.auth;
  const runtime = createWorkerRuntime({ store, config, observability });

  function runProcessImportJobs({
    userId,
    importId,
    shouldDownload = false,
    maxJobs = null,
  }) {
    return processWorkerScopes({
      runtime,
      scopes: [{ userId, importId }],
      maxJobs: maxJobs || runtime.worker.batchSize,
      download: shouldDownload,
      totalJobCap: maxJobs || runtime.worker.batchSize,
    }).then((result) => result.results.flatMap((entry) => entry.processed));
  }

  function startProcessing({ userId, importId, shouldDownload = false, maxJobs = null }) {
    runProcessImportJobs({
      userId,
      importId,
      shouldDownload,
      maxJobs: maxJobs || runtime.worker.batchSize,
    }).catch((error) => {
      void recordSupportEvent(store, {
        userId,
        eventType: 'background_job_failed',
        metadata: { importId: importId || '', component: 'import_worker', errorName: error?.name || 'Error' },
      });
      observability?.error?.('background processing failed', {
        userId,
        importId,
        errorName: error?.name || 'Error',
        errorMessage: error?.message || 'Background processing failed.',
      });
    });
  }

  function startDataExportProcessing({ maxJobs = 1 } = {}) {
    processDataExportQueue({
      runtime,
      maxJobs: Math.max(1, Math.min(Number(maxJobs) || 1, runtime.worker.batchSize)),
    }).catch((error) => {
      observability?.error?.('background data export processing failed', {
        errorName: error?.name || 'Error',
        errorMessage: error?.message || 'Background data export processing failed.',
      });
    });
  }

  async function queueIndexingWork({ reason, userId, importId = null, shouldDownload = false, forceInline = false }) {
    if (forceInline || runtime.worker.inlineIndexingEnabled === true) {
      startProcessing({ userId, importId, shouldDownload });
      return { mode: 'inline', triggered: false };
    }
    return { mode: 'vm-worker', queued: true, reason, userId, importId };
  }

  const workerProcessHandler = asyncRoute(async (req, res) => {
    assertWorker(req, config);
    if (typeof store.getProcessableJobScopes !== 'function') return res.status(501).json({ error: 'Worker job discovery is not available.' });

    const workerBatchCap = Math.max(1, Math.min(runtime.worker.batchSize, 5));
    const oneJobRoute = req.path === '/api/worker/process-one';
    const requestedMaxJobs = oneJobRoute ? 1 : Number(req.body?.maxJobs || req.query?.maxJobs) || workerBatchCap;
    const maxJobs = Math.max(1, Math.min(requestedMaxJobs, workerBatchCap));
    const downloadValue = req.body?.download ?? req.query?.download;
    const result = await runWorkerPass({
      runtime,
      maxJobs,
      download: downloadValue === true || downloadValue === 'true',
      scopeLimit: maxJobs,
      totalJobCap: maxJobs,
    });

    return res.json({
      processedCount: result.processedCount,
      scopeCount: result.scopeCount,
      dataExportProcessedCount: result.dataExportProcessedCount || 0,
    });
  });

  function workerStatus() {
    return getWorkerStatus({ runtime });
  }

  return {
    queueIndexingWork,
    runProcessImportJobs,
    startProcessing,
    startDataExportProcessing,
    workerProcessHandler,
    workerStatus,
  };
}

module.exports = {
  createWorkerWorkflow,
};
