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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
}

function pickNextProcessableJob(jobs) {
  return jobs.find((job) => job.status === 'failed') || jobs.find((job) => job.status === 'queued') || null;
}

function isClaimableJob(job, now = new Date()) {
  if (job.status === 'queued' || job.status === 'failed') return true;
  if (!['downloading', 'analyzing'].includes(job.status)) return false;
  if (!job.leaseExpiresAt) return true;
  return new Date(job.leaseExpiresAt).getTime() <= now.getTime();
}

function isRestartableJob(job) {
  return ['failed', 'downloading', 'analyzing'].includes(job.status) || String(job.status || '').startsWith('paused');
}

module.exports = {
  createJobsForImport,
  isClaimableJob,
  isRestartableJob,
  pickNextProcessableJob,
};
