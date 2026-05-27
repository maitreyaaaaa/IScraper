const { publicDeletionRequest } = require('../services/accountDeletion');
const { recordRequestTiming } = require('../services/observability');
const { validateProfileInput } = require('../services/profiles');
const { recordSecurityAuditForRequest, recordSupportEvent } = require('../services/auditLog');

function registerAccountRoutes(app, deps) {
  const { http, store } = deps;
  const { asyncRoute, captureWorkflow, cleanText } = http;

  app.get('/api/account/deletion', asyncRoute(async (req, res) => {
    const deletion = typeof store.getActiveDeletionRequest === 'function'
      ? await store.getActiveDeletionRequest(req.user.id)
      : null;
    res.json({ deletion: publicDeletionRequest(deletion) });
  }));

  app.get('/api/account/security-activity', asyncRoute(async (req, res) => {
    if (typeof store.listUserSecurityActivity !== 'function') return res.json({ activity: [] });
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 50));
    res.json({ activity: await store.listUserSecurityActivity(req.user.id, { limit }) });
  }));

  app.post('/api/account/deletion', asyncRoute(async (req, res) => {
    if (typeof store.createDeletionRequest !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    if (req.body?.exportConfirmed !== true) {
      return res.status(400).json({ error: 'Confirm that you exported or intentionally skipped exporting your data first.' });
    }
    const request = await store.createDeletionRequest({
      userId: req.user.id,
      email: req.user.email,
      reason: cleanText(req.body?.reason || '', 500),
      exportConfirmed: true,
    });
    if (typeof store.freezeUserForDeletion === 'function') {
      await store.freezeUserForDeletion(req.user.id, { requestId: request.id, actor: 'user-request' });
    }
    let current = request;
    if (typeof store.markDeletionRequestFrozen === 'function') {
      current = await store.markDeletionRequestFrozen(request.id);
    }
    if (typeof store.markDeletionRequestPendingReview === 'function') {
      current = await store.markDeletionRequestPendingReview(request.id);
    }
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'account_deletion_requested',
      severity: 'critical',
      targetUserId: req.user.id,
      metadata: { deletionRequestId: request.id },
    });
    captureWorkflow(req, 'account deletion requested', { deletionRequestId: request.id });
    res.status(201).json({ deletion: publicDeletionRequest(current) });
  }));

  app.post('/api/account/deletion/cancel', asyncRoute(async (req, res) => {
    if (typeof store.cancelDeletionRequestForUser !== 'function') return res.status(501).json({ error: 'Account deletion requests are not available.' });
    const request = await store.cancelDeletionRequestForUser(req.user.id);
    if (!request) return res.status(409).json({ error: 'This deletion request can no longer be canceled.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'account_deletion_canceled',
      severity: 'warning',
      targetUserId: req.user.id,
      metadata: { deletionRequestId: request.id },
    });
    captureWorkflow(req, 'account deletion canceled', { deletionRequestId: request.id });
    res.json({ deletion: publicDeletionRequest(request) });
  }));


  app.get('/api/credits', asyncRoute(async (req, res) => {
    res.json({ credits: await store.getCredits(req.user.id) });
  }));

  app.get('/api/profile', asyncRoute(async (req, res) => {
    const profileStartedAt = process.hrtime.bigint();
    const profile = typeof store.getProfile === 'function' ? await store.getProfile(req.user.id) : null;
    recordRequestTiming(req, 'profileFetchMs', profileStartedAt);
    res.json({ profile, required: Boolean(store.requiresAuth && !profile?.username) });
  }));

  app.post('/api/activity/sign-in', asyncRoute(async (req, res) => {
    if (typeof store.recordUserActivity === 'function') {
      await recordSupportEvent(store, {
        userId: req.user.id,
        eventType: 'sign_in',
        metadata: { method: 'session' },
      });
    }
    captureWorkflow(req, 'sign in activity recorded', {});
    res.json({ ok: true });
  }));

  app.post('/api/profile', asyncRoute(async (req, res) => {
    const input = validateProfileInput({
      username: req.body?.username,
      avatarUrl: req.body?.avatarUrl,
    });
    const profile = await store.saveProfile(req.user.id, input);
    captureWorkflow(req, 'profile saved', { hasAvatar: Boolean(profile.avatarUrl) });
    res.json({ profile });
  }));
}

module.exports = {
  registerAccountRoutes,
};
