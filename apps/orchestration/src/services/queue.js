const ACTIVE_JOB_STATUSES = ['downloading', 'analyzing'];
const PAUSED_JOB_STATUSES = ['paused_needs_billing', 'paused_api_limit', 'paused_missing_provider'];
const DEFAULT_MAX_JOB_ATTEMPTS = 3;
const DEFAULT_RETRY_BACKOFF_MS = 60 * 1000;
const DEFAULT_MAX_RETRY_BACKOFF_MS = 30 * 60 * 1000;

function createJobsForImport({ importId, items, existingJobs = [] }) {
  const existingOpenOrDone = new Set(existingJobs.map((job) => job.itemId));

  return items
    .filter((item) => !existingOpenOrDone.has(item.id))
    .map((item) => ({
      id: `${importId}:${item.id}`,
      importId,
      itemId: item.id,
      status: 'queued',
      attempts: 0,
      error: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      claimedAt: null,
      completedAt: null,
      lastErrorAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
}

function pickNextProcessableJob(jobs) {
  return jobs.find((job) => job.status === 'queued') || null;
}

function isRestartableJob(job) {
  return ['failed', 'downloading', 'analyzing'].includes(job.status) || String(job.status || '').startsWith('paused');
}

function isActiveJob(job) {
  return ACTIVE_JOB_STATUSES.includes(job.status);
}

function hasActiveLease(job, now = new Date()) {
  if (!isActiveJob(job)) return false;
  if (!job.leaseExpiresAt) return true;
  return new Date(job.leaseExpiresAt) > now;
}

function isRetryDue(job, now = new Date()) {
  if (!job.nextAttemptAt) return true;
  const nextAttemptAt = Date.parse(job.nextAttemptAt);
  if (!Number.isFinite(nextAttemptAt)) return true;
  return nextAttemptAt <= now.getTime();
}

function isAttemptExhausted(job, maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  return (Number(job.attempts) || 0) >= Math.max(1, Number(maxAttempts) || DEFAULT_MAX_JOB_ATTEMPTS);
}

function isReclaimableJob(job, now = new Date(), options = {}) {
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_JOB_ATTEMPTS;
  if (isAttemptExhausted(job, maxAttempts)) return false;
  if (job.status === 'queued') return isRetryDue(job, now);
  if (!isActiveJob(job)) return false;
  if (!isRetryDue(job, now)) return false;
  if (!job.leaseExpiresAt) return true;
  return new Date(job.leaseExpiresAt) <= now;
}

function nextRetryAt({
  attempts = 1,
  now = new Date(),
  baseMs = DEFAULT_RETRY_BACKOFF_MS,
  maxMs = DEFAULT_MAX_RETRY_BACKOFF_MS,
} = {}) {
  const attemptNumber = Math.max(1, Number(attempts) || 1);
  const base = Math.max(1000, Number(baseMs) || DEFAULT_RETRY_BACKOFF_MS);
  const max = Math.max(base, Number(maxMs) || DEFAULT_MAX_RETRY_BACKOFF_MS);
  const delay = Math.min(max, base * 2 ** Math.max(0, attemptNumber - 1));
  return new Date(now.getTime() + delay).toISOString();
}

module.exports = {
  ACTIVE_JOB_STATUSES,
  DEFAULT_MAX_JOB_ATTEMPTS,
  DEFAULT_MAX_RETRY_BACKOFF_MS,
  DEFAULT_RETRY_BACKOFF_MS,
  PAUSED_JOB_STATUSES,
  createJobsForImport,
  hasActiveLease,
  isAttemptExhausted,
  isActiveJob,
  isReclaimableJob,
  isRetryDue,
  isRestartableJob,
  nextRetryAt,
  pickNextProcessableJob,
};
