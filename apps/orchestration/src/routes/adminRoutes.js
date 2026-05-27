const crypto = require('crypto');
const { processAccountDeletionRequest, publicDeletionRequest } = require('../services/accountDeletion');
const { hashAuditValue, recordSecurityAuditForRequest } = require('../services/auditLog');

function registerAdminRoutes(app, deps) {
  const {
    config, http, store, workflows,
  } = deps;
  const { assertAdmin } = http.auth;
  const { adminRateLimit } = http.rateLimiters;
  const { asyncRoute, captureWorkflow, cleanText, warnWorkflow } = http;

  app.post('/api/admin/login', adminRateLimit, asyncRoute(async (req, res) => {
    const email = cleanText(req.body?.email, 240).toLowerCase();
    const password = String(req.body?.password || '');
    const adminEmails = new Set((config.adminEmails || []).map((entry) => String(entry).toLowerCase()));
    if (!adminEmails.size || !config.adminPassword) return res.status(503).json({ error: 'Admin password login is not configured.' });

    const expected = String(config.adminPassword);
    const validLength = Buffer.byteLength(password) === Buffer.byteLength(expected);
    const validPassword = validLength && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
    if (!email || !adminEmails.has(email) || !validPassword) {
      await recordSecurityAuditForRequest(store, req, {
        eventType: 'admin_login_failed',
        actorType: 'admin',
        severity: 'warning',
        result: 'denied',
        metadata: { emailProvided: Boolean(email) },
      });
      warnWorkflow(req, 'admin login rejected', { statusCode: 403 });
      return res.status(403).json({ error: 'Invalid admin email or password.' });
    }

    await recordSecurityAuditForRequest(store, req, {
      eventType: 'admin_login_succeeded',
      actorType: 'admin',
      severity: 'warning',
      metadata: { actor: email },
    });
    captureWorkflow(req, 'admin login completed', { actorType: 'password_admin' });
    return res.json({ admin: { email } });
  }));

  app.get('/api/admin/summary', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.getAdminSummary !== 'function') return res.status(501).json({ error: 'Admin summary is not available.' });
    res.json({ summary: await store.getAdminSummary() });
  }));

  app.get('/api/admin/users', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listAdminUsers !== 'function') return res.status(501).json({ error: 'Admin users are not available.' });
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const query = String(req.query.q || '').trim();
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'admin_user_list_viewed',
      actorType: 'admin',
      severity: 'warning',
      metadata: { hasQuery: Boolean(query), limit, offset },
    });
    res.json(await store.listAdminUsers({ query, limit, offset }));
  }));

  app.get('/api/admin/users/:userId', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.getAdminUserDetail !== 'function') return res.status(501).json({ error: 'Admin user details are not available.' });
    const user = await store.getAdminUserDetail(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'admin_user_detail_viewed',
      actorType: 'admin',
      targetUserId: req.params.userId,
      severity: 'warning',
      metadata: { adminActorHash: hashAuditValue(adminUser.id || adminUser.email || 'admin') },
    });
    res.json({ user });
  }));

  app.post('/api/admin/users/:userId/block', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.setUserBlocked !== 'function') return res.status(501).json({ error: 'User blocking is not available.' });
    const reason = cleanText(req.body?.reason || 'Blocked by admin', 240);
    const user = await store.setUserBlocked({
      userId: req.params.userId,
      blocked: true,
      reason,
      adminActor: adminUser.email || 'admin',
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'account_blocked',
      actorType: 'admin',
      targetUserId: req.params.userId,
      severity: 'critical',
      metadata: { reason },
    });
    captureWorkflow(req, 'admin user blocked', { targetUserId: req.params.userId, actorType: 'admin' });
    res.json({ user });
  }));

  app.post('/api/admin/users/:userId/unblock', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.setUserBlocked !== 'function') return res.status(501).json({ error: 'User blocking is not available.' });
    const user = await store.setUserBlocked({
      userId: req.params.userId,
      blocked: false,
      reason: cleanText(req.body?.reason || 'Unblocked by admin', 240),
      adminActor: adminUser.email || 'admin',
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'account_unblocked',
      actorType: 'admin',
      targetUserId: req.params.userId,
      severity: 'warning',
    });
    captureWorkflow(req, 'admin user unblocked', { targetUserId: req.params.userId, actorType: 'admin' });
    res.json({ user });
  }));

  app.get('/api/admin/imports', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listAdminImports !== 'function') return res.status(501).json({ error: 'Admin imports are not available.' });
    res.json({ imports: await store.listAdminImports({ limit: 50 }) });
  }));

  app.get('/api/admin/activity', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listAdminActivity !== 'function') return res.status(501).json({ error: 'Admin activity is not available.' });
    res.json({ activity: await store.listAdminActivity({ limit: 100 }) });
  }));

  app.get('/api/admin/worker/status', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof workflows.worker.workerStatus !== 'function') return res.status(501).json({ error: 'Worker status is not available.' });
    res.json({ status: await workflows.worker.workerStatus() });
  }));

  app.get('/api/admin/users/:userId/timeline', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.listUserTimeline !== 'function') return res.status(501).json({ error: 'User timeline is not available.' });
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 200));
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'admin_user_timeline_viewed',
      actorType: 'admin',
      targetUserId: req.params.userId,
      severity: 'warning',
      metadata: { adminActorHash: hashAuditValue(adminUser.id || adminUser.email || 'admin') },
    });
    res.json({ timeline: await store.listUserTimeline(req.params.userId, { limit }) });
  }));

  app.get('/api/admin/audit-events', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listSecurityAuditEvents !== 'function') return res.status(501).json({ error: 'Audit events are not available.' });
    const filters = {
      targetUserId: String(req.query.targetUserId || ''),
      eventType: String(req.query.eventType || ''),
      severity: String(req.query.severity || ''),
      limit: Math.max(1, Math.min(Number(req.query.limit || 100), 200)),
    };
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'admin_audit_events_viewed',
      actorType: 'admin',
      targetUserId: filters.targetUserId || null,
      severity: 'warning',
      metadata: { eventType: filters.eventType, severity: filters.severity, limit: filters.limit },
    });
    res.json({ auditEvents: await store.listSecurityAuditEvents(filters) });
  }));

  app.get('/api/admin/feedback', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listAdminFeedback !== 'function') return res.status(501).json({ error: 'Admin feedback is not available.' });
    res.json({ feedback: await store.listAdminFeedback({ limit: 100 }) });
  }));

  app.post('/api/admin/feedback/:id/hide', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.setFeedbackStatus !== 'function') return res.status(501).json({ error: 'Feedback moderation is not available.' });
    const feedback = await store.setFeedbackStatus(req.params.id, 'hidden');
    if (!feedback) return res.status(404).json({ error: 'Feedback not found.' });
    captureWorkflow(req, 'admin feedback moderated', { feedbackId: req.params.id, status: 'hidden' });
    res.json({ feedback });
  }));

  app.post('/api/admin/feedback/:id/show', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.setFeedbackStatus !== 'function') return res.status(501).json({ error: 'Feedback moderation is not available.' });
    const feedback = await store.setFeedbackStatus(req.params.id, 'visible');
    if (!feedback) return res.status(404).json({ error: 'Feedback not found.' });
    captureWorkflow(req, 'admin feedback moderated', { feedbackId: req.params.id, status: 'visible' });
    res.json({ feedback });
  }));

  app.get('/api/admin/credits/:userId', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    res.json({ credits: await store.getCredits(req.params.userId) });
  }));

  app.post('/api/admin/credits/adjust', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    const userId = String(req.body?.userId || '').trim();
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    const adminActor = String(req.header('x-admin-actor') || adminUser.email || 'admin-api').trim().slice(0, 120);

    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    if (!Number.isInteger(amount) || amount === 0) return res.status(400).json({ error: 'amount must be a non-zero whole number.' });
    if (!reason) return res.status(400).json({ error: 'reason is required.' });

    const result = await store.addAdminCreditAdjustment({ userId, amount, reason, adminActor });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'admin_credit_adjusted',
      actorType: 'admin',
      targetUserId: userId,
      severity: 'critical',
      metadata: { amount, reason },
    });
    captureWorkflow(req, 'admin credits adjusted', { targetUserId: userId, amount, actorType: 'admin' });
    return res.status(201).json(result);
  }));

  app.get('/api/admin/deletion-requests', adminRateLimit, asyncRoute(async (req, res) => {
    await assertAdmin(req, config, store);
    if (typeof store.listDeletionRequests !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 100));
    res.json({ requests: await store.listDeletionRequests({ limit }) });
  }));

  app.post('/api/admin/deletion-requests/:id/approve', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.approveDeletionRequest !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    const request = await store.approveDeletionRequest({
      id: req.params.id,
      adminActor: String(req.header('x-admin-actor') || adminUser.email || 'admin').slice(0, 160),
    });
    if (!request) return res.status(404).json({ error: 'Deletion request not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'account_deletion_approved',
      actorType: 'admin',
      targetUserId: request.userId,
      severity: 'critical',
      metadata: { deletionRequestId: req.params.id },
    });
    captureWorkflow(req, 'admin deletion request approved', { deletionRequestId: req.params.id, actorType: 'admin' });
    res.json({ deletion: publicDeletionRequest(request) });
  }));

  app.post('/api/admin/deletion-requests/:id/cancel', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    if (typeof store.cancelDeletionRequestAsAdmin !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    const request = await store.cancelDeletionRequestAsAdmin({
      id: req.params.id,
      adminActor: String(req.header('x-admin-actor') || adminUser.email || 'admin').slice(0, 160),
      reason: cleanText(req.body?.reason || 'Canceled by admin', 500),
    });
    if (!request) return res.status(404).json({ error: 'Deletion request not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'account_deletion_canceled_by_admin',
      actorType: 'admin',
      targetUserId: request.userId,
      severity: 'critical',
      metadata: { deletionRequestId: req.params.id },
    });
    captureWorkflow(req, 'admin deletion request canceled', { deletionRequestId: req.params.id, actorType: 'admin' });
    res.json({ deletion: publicDeletionRequest(request) });
  }));

  app.post('/api/admin/deletion-requests/:id/process', adminRateLimit, asyncRoute(async (req, res) => {
    const adminUser = await assertAdmin(req, config, store);
    const result = await processAccountDeletionRequest({
      store,
      requestId: req.params.id,
      actor: String(req.header('x-admin-actor') || adminUser.email || 'admin').slice(0, 160),
      maxSteps: Number(req.body?.maxSteps || req.query?.maxSteps) || 7,
    });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'account_deletion_processed',
      actorType: 'admin',
      targetUserId: result.request?.userId || null,
      severity: 'critical',
      result: result.failedStep ? 'failure' : 'success',
      metadata: {
        deletionRequestId: req.params.id,
        executedCount: result.executed.length,
        complete: result.complete,
        failedStep: result.failedStep || null,
      },
    });
    captureWorkflow(req, 'admin deletion request processed', {
      deletionRequestId: req.params.id,
      executedCount: result.executed.length,
      complete: result.complete,
      failedStep: result.failedStep || null,
    });
    res.json(result);
  }));
}

module.exports = {
  registerAdminRoutes,
};
