const ACTIVE_JOB_STATUSES = ['downloading', 'analyzing'];
const PAUSED_JOB_STATUSES = ['paused_needs_billing', 'paused_api_limit', 'paused_missing_provider'];

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
      leaseExpiresAt: null,
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

function isReclaimableJob(job, now = new Date()) {
  if (job.status === 'queued') return true;
  if (!isActiveJob(job)) return false;
  if (!job.leaseExpiresAt) return true;
  return new Date(job.leaseExpiresAt) <= now;
}

module.exports = {
  ACTIVE_JOB_STATUSES,
  PAUSED_JOB_STATUSES,
  createJobsForImport,
  hasActiveLease,
  isActiveJob,
  isReclaimableJob,
  isRestartableJob,
  pickNextProcessableJob,
};
