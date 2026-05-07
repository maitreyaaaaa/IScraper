const assert = require('node:assert/strict');
const test = require('node:test');

const { createJobsForImport, pickNextProcessableJob } = require('../src/services/queue');

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

test('pickNextProcessableJob resumes queued and failed jobs but skips done jobs', () => {
  const jobs = [
    { itemId: 'a', status: 'done' },
    { itemId: 'b', status: 'failed' },
    { itemId: 'c', status: 'queued' },
  ];

  assert.equal(pickNextProcessableJob(jobs).itemId, 'b');
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
