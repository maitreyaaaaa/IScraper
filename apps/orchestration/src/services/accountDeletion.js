const crypto = require('crypto');

const ACTIVE_DELETION_STATUSES = new Set(['requested', 'pending_approval', 'approved', 'executing', 'partially_failed']);
const CANCELABLE_DELETION_STATUSES = new Set(['requested', 'pending_approval']);
const TERMINAL_DELETION_STATUSES = new Set(['completed', 'canceled']);

const DELETION_STEPS = Object.freeze([
  'freeze_access',
  'remove_storage',
  'delete_content',
  'delete_access',
  'delete_profile',
  'delete_auth',
  'finalize',
]);

function hashDeletionValue(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || '').trim().toLowerCase())
    .digest('hex');
}

function isDeletionBlockingStatus(status) {
  return ACTIVE_DELETION_STATUSES.has(status);
}

function publicDeletionRequest(request) {
  if (!request) {
    return {
      request: null,
      canRequest: true,
      canCancel: false,
      allowedActions: ['request'],
    };
  }

  const canCancel = CANCELABLE_DELETION_STATUSES.has(request.status);
  const allowedActions = [];
  if (canCancel) allowedActions.push('cancel');
  if (TERMINAL_DELETION_STATUSES.has(request.status)) allowedActions.push('request');

  return {
    request: {
      id: request.id,
      status: request.status,
      reason: request.reason || '',
      exportConfirmed: Boolean(request.exportConfirmed),
      requestedAt: request.requestedAt || null,
      approvedAt: request.approvedAt || null,
      executingAt: request.executingAt || null,
      completedAt: request.completedAt || null,
      canceledAt: request.canceledAt || null,
      statusMessage: request.statusMessage || '',
      retentionSummary: request.retentionSummary || {},
      steps: request.steps || [],
    },
    canRequest: TERMINAL_DELETION_STATUSES.has(request.status),
    canCancel,
    allowedActions,
  };
}

function redactDeletionError(error) {
  return String(error?.message || error || 'Deletion step failed.')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .slice(0, 500);
}

async function processAccountDeletionRequest({ store, requestId, actor = 'admin', maxSteps = DELETION_STEPS.length }) {
  if (!requestId) {
    const error = new Error('Deletion request id is required.');
    error.statusCode = 400;
    throw error;
  }
  if (typeof store.getDeletionRequestById !== 'function') {
    const error = new Error('Account deletion is not available.');
    error.statusCode = 501;
    throw error;
  }

  let request = await store.getDeletionRequestById(requestId);
  if (!request) {
    const error = new Error('Deletion request not found.');
    error.statusCode = 404;
    throw error;
  }
  if (request.status === 'completed') {
    return {
      request: publicDeletionRequest(request).request,
      executed: [],
      complete: true,
    };
  }
  if (!['approved', 'executing', 'partially_failed'].includes(request.status)) {
    const error = new Error('Deletion request must be approved before processing.');
    error.statusCode = 409;
    throw error;
  }

  request = await store.markDeletionRequestExecuting(requestId);
  const completedStepKeys = new Set((request.steps || []).filter((step) => step.status === 'completed').map((step) => step.stepKey));
  const userId = request.userId;
  const executed = [];
  const limit = Math.max(1, Math.min(Number(maxSteps) || DELETION_STEPS.length, DELETION_STEPS.length));

  for (const stepKey of DELETION_STEPS) {
    if (executed.length >= limit) break;
    if (completedStepKeys.has(stepKey)) continue;

    try {
      await store.recordDeletionStep({ requestId, stepKey, status: 'running', metadata: { actor } });
      const metadata = await runDeletionStep({ store, request, userId, actor, stepKey });
      await store.recordDeletionStep({ requestId, stepKey, status: 'completed', metadata });
      completedStepKeys.add(stepKey);
      executed.push(stepKey);
    } catch (error) {
      await store.recordDeletionStep({
        requestId,
        stepKey,
        status: 'failed',
        error: redactDeletionError(error),
      });
      request = await store.markDeletionRequestPartiallyFailed(requestId, redactDeletionError(error));
      return {
        request: publicDeletionRequest(request).request,
        executed,
        failedStep: stepKey,
        complete: false,
      };
    }
  }

  request = await store.getDeletionRequestById(requestId);
  const finished = DELETION_STEPS.every((stepKey) => (request.steps || []).some((step) => step.stepKey === stepKey && step.status === 'completed'));
  if (finished && request.status !== 'completed') {
    request = await store.completeDeletionRequest(requestId, {
      actor,
      retentionSummary: {
        retained: ['account_deletion_audit', 'security_logs', 'backups_until_expiry', 'third_party_provider_records_if_any'],
        note: 'Deleted app data, storage, access tokens, and the Supabase Auth user. Audit retains only hashes and deletion status.',
      },
    });
  }

  return {
    request: publicDeletionRequest(request).request,
    executed,
    complete: request.status === 'completed',
  };
}

async function runDeletionStep({ store, request, userId, actor, stepKey }) {
  if (stepKey !== 'finalize' && !userId) {
    return { skipped: true, reason: 'user already detached' };
  }

  if (stepKey === 'freeze_access') {
    return store.freezeUserForDeletion(userId, { requestId: request.id, actor });
  }
  if (stepKey === 'remove_storage') {
    return store.deleteUserStorageObjects(userId);
  }
  if (stepKey === 'delete_content') {
    return store.deleteUserContentData(userId);
  }
  if (stepKey === 'delete_access') {
    return store.deleteUserAccessData(userId);
  }
  if (stepKey === 'delete_profile') {
    return store.deleteUserProfileData(userId);
  }
  if (stepKey === 'delete_auth') {
    return store.deleteAuthUser(userId);
  }
  if (stepKey === 'finalize') {
    return { actor, retainedCategories: ['deletion_audit', 'security_logs', 'backups_until_expiry'] };
  }

  const error = new Error('Unknown deletion step.');
  error.statusCode = 500;
  throw error;
}

module.exports = {
  ACTIVE_DELETION_STATUSES,
  CANCELABLE_DELETION_STATUSES,
  DELETION_STEPS,
  TERMINAL_DELETION_STATUSES,
  hashDeletionValue,
  isDeletionBlockingStatus,
  processAccountDeletionRequest,
  publicDeletionRequest,
  redactDeletionError,
};
