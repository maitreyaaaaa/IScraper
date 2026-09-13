const {
  WORKFLOW_SKILLS,
  executeApprovedPublish,
  generateWorkflowPlan,
  selectedReferencesFromItems,
  workflowReadiness,
} = require('../services/contentWorkflows');

function registerWorkflowRoutes(app, deps) {
  const { config, http, store } = deps;
  const { asyncRoute, captureWorkflow, cleanText } = http;
  const { searchRateLimit } = http.rateLimiters;
  const { requireAccountNotDeleting, requireCompletedProfile } = http.auth;

  app.use('/api/workflows', asyncRoute(async (req, _res, next) => {
    await requireAccountNotDeleting(req, store);
    next();
  }));

  app.get('/api/workflows/readiness', asyncRoute(async (_req, res) => {
    return res.json({ readiness: workflowReadiness(config), skills: WORKFLOW_SKILLS });
  }));

  app.post('/api/workflows/generate', searchRateLimit, asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const items = typeof store.getItems === 'function' ? await store.getItems(req.user.id) : [];
    const references = selectedReferencesFromItems(items, req.body?.referenceIds);
    const manualReferences = Array.isArray(req.body?.references) ? req.body.references : [];
    const plan = await generateWorkflowPlan({
      config,
      input: {
        brief: cleanText(req.body?.brief, 1000),
        format: req.body?.format,
        platforms: req.body?.platforms,
        cadence: req.body?.cadence,
        timezone: req.body?.timezone,
        references: [...references, ...manualReferences].slice(0, 4),
      },
    });
    captureWorkflow(req, 'content workflow generated', {
      workflowId: plan.id,
      format: plan.format,
      platformCount: plan.platforms?.length || 0,
      referenceCount: plan.references?.length || 0,
      aiMode: plan.aiMode,
    });
    return res.json({ plan, readiness: workflowReadiness(config) });
  }));

  app.post('/api/workflows/publish', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    const payload = {
      approved: req.body?.approved === true,
      platform: cleanText(req.body?.platform || 'instagram', 32),
      format: cleanText(req.body?.format || 'reel', 32),
      caption: cleanText(req.body?.caption, 2200),
      mediaUrl: cleanText(req.body?.mediaUrl, 1000),
      creationId: cleanText(req.body?.creationId, 200),
    };
    const result = await executeApprovedPublish({ config, payload });
    captureWorkflow(req, 'content workflow publish requested', {
      status: result.status,
      platform: payload.platform,
      approved: payload.approved,
      missingCount: result.missing?.length || 0,
      logId: result.logId || '',
    });
    const statusCode = result.status === 'blocked' ? 409 : result.status === 'failed' ? 502 : 200;
    return res.status(statusCode).json({ result });
  }));
}

module.exports = {
  registerWorkflowRoutes,
};
