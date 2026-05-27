const { getUserDataMap } = require('../services/userDataRegistry');
const { recordSecurityAuditForRequest } = require('../services/auditLog');

function registerDataExportRoutes(app, deps) {
  const { http, store, workflows } = deps;
  const { asyncRoute, captureWorkflow } = http;

  app.get('/api/user-data-map', asyncRoute(async (_req, res) => {
    res.json({ dataMap: getUserDataMap() });
  }));

  app.get('/api/account/summary', asyncRoute(async (req, res) => {
    if (typeof store.getAccountSummary !== 'function') return res.status(501).json({ error: 'Account summary is not available.' });
    res.json({ account: await store.getAccountSummary(req.user.id) });
  }));

  app.get('/api/data-exports', asyncRoute(async (req, res) => {
    if (typeof store.listDataExportRequests !== 'function') return res.status(501).json({ error: 'Data exports are not available.' });
    res.json({ exports: await store.listDataExportRequests(req.user.id) });
  }));

  app.post('/api/data-exports', asyncRoute(async (req, res) => {
    if (typeof store.createDataExportRequest !== 'function') return res.status(501).json({ error: 'Data exports are not available.' });
    const includeFiles = req.body?.includeFiles === true;
    const request = await store.createDataExportRequest(req.user.id, { includeFiles });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'data_export_requested',
      severity: 'warning',
      targetUserId: req.user.id,
      metadata: { exportRequestId: request.id, includeFiles },
    });
    captureWorkflow(req, 'data export requested', { exportRequestId: request.id, includeFiles });
    workflows?.worker?.startDataExportProcessing?.({ maxJobs: 1 });
    res.status(202).json({ export: request });
  }));

  app.get('/api/data-exports/:id', asyncRoute(async (req, res) => {
    if (typeof store.getDataExportRequest !== 'function') return res.status(501).json({ error: 'Data exports are not available.' });
    const request = await store.getDataExportRequest(req.user.id, req.params.id);
    if (!request) return res.status(404).json({ error: 'Data export not found.' });
    res.json({ export: request });
  }));

  app.get('/api/data-exports/:id/download', asyncRoute(async (req, res) => {
    if (typeof store.getDataExportArtifact !== 'function') return res.status(501).json({ error: 'Data export download is not available.' });
    const request = await store.getDataExportRequest(req.user.id, req.params.id);
    if (!request) return res.status(404).json({ error: 'Data export not found.' });
    if (request.status !== 'ready') return res.status(409).json({ error: 'Data export is not ready yet.' });
    const artifact = await store.getDataExportArtifact(req.user.id, req.params.id);
    if (!artifact) return res.status(404).json({ error: 'Data export file not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'data_export_downloaded',
      severity: 'warning',
      targetUserId: req.user.id,
      metadata: { exportRequestId: request.id },
    });
    captureWorkflow(req, 'data export downloaded', { exportRequestId: request.id });
    res.setHeader('Content-Type', artifact.contentType || 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="iscraper-data-export.zip"');
    res.send(artifact.buffer);
  }));
}

module.exports = {
  registerDataExportRoutes,
};
