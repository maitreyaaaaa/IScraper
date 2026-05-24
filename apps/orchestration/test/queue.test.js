const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createJobsForImport,
  isReclaimableJob,
  isRestartableJob,
  isRetryDue,
  nextRetryAt,
  pickNextProcessableJob,
} = require('../src/services/queue');

test('createJobsForImport creates a job for every item without a hard limit', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ id: `item-${index + 1}` }));

  const jobs = createJobsForImport({ importId: 'import-1', items, existingJobs: [] });

  assert.equal(jobs.length, 8);
  assert.equal(jobs.every((job) => job.status === 'queued'), true);
});

test('createJobsForImport does not duplicate existing done or queued jobs', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const existingJobs = [
    { itemId: 'a', status: 'done' },
    { itemId: 'b', status: 'failed' },
  ];

  const jobs = createJobsForImport({ importId: 'import-1', items, existingJobs });

  assert.deepEqual(jobs.map((job) => job.itemId), ['c']);
});

test('pickNextProcessableJob runs queued jobs but leaves failed jobs for restart', () => {
  const jobs = [
    { itemId: 'a', status: 'done' },
    { itemId: 'b', status: 'failed' },
    { itemId: 'c', status: 'queued' },
  ];

  assert.equal(pickNextProcessableJob(jobs).itemId, 'c');
});

test('pickNextProcessableJob skips paused billing and provider jobs', () => {
  const jobs = [
    { itemId: 'a', status: 'paused_needs_billing' },
    { itemId: 'b', status: 'paused_api_limit' },
    { itemId: 'c', status: 'paused_missing_provider' },
    { itemId: 'd', status: 'queued' },
  ];

  assert.equal(pickNextProcessableJob(jobs).itemId, 'd');
});

test('isRestartableJob allows stuck and paused jobs but not done jobs', () => {
  assert.equal(isRestartableJob({ status: 'failed' }), true);
  assert.equal(isRestartableJob({ status: 'downloading' }), true);
  assert.equal(isRestartableJob({ status: 'analyzing' }), true);
  assert.equal(isRestartableJob({ status: 'paused_needs_billing' }), true);
  assert.equal(isRestartableJob({ status: 'paused_api_limit' }), true);
  assert.equal(isRestartableJob({ status: 'paused_missing_provider' }), true);
  assert.equal(isRestartableJob({ status: 'queued' }), false);
  assert.equal(isRestartableJob({ status: 'done' }), false);
});

test('queued jobs with future retry backoff are not claimable until due', () => {
  const now = new Date('2026-05-24T00:00:00.000Z');
  const nextAttemptAt = nextRetryAt({ attempts: 2, now, baseMs: 1000, maxMs: 5000 });
  const job = { status: 'queued', attempts: 2, nextAttemptAt };

  assert.equal(isRetryDue(job, now), false);
  assert.equal(isReclaimableJob(job, now, { maxAttempts: 3 }), false);
  assert.equal(isReclaimableJob(job, new Date('2026-05-24T00:00:03.000Z'), { maxAttempts: 3 }), true);
});

test('jobs at max attempts are not automatically reclaimable', () => {
  assert.equal(isReclaimableJob({ status: 'queued', attempts: 3 }, new Date(), { maxAttempts: 3 }), false);
  assert.equal(isReclaimableJob({ status: 'analyzing', attempts: 3, leaseExpiresAt: '2020-01-01T00:00:00.000Z' }, new Date(), { maxAttempts: 3 }), false);
});
