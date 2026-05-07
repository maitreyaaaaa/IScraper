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

module.exports = {
  createJobsForImport,
  pickNextProcessableJob,
};
