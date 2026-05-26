const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createWorkerRuntime, getWorkerStatus, runWorkerPass } = require('../src/runtime/workerRuntime');
const { createLocalStore } = require('../src/stores/localStore');

function seedJobs(store, userId = 'runtime-user') {
  store.ensureUser(userId, `${userId}@example.com`);
  const entry = store.createImport({ userId, source: 'manual-link', fileNames: [`${userId}.json`] });
  const items = store.upsertImportData({
    userId,
    importId: entry.id,
    initialStatus: 'queued',
    parsed: {
      collections: [],
      items: [1, 2].map((number) => ({
        id: `${userId}-runtime-${number}`,
        url: `https://example.com/${userId}/${number}`,
        contentType: 'unknown',
        caption: `Runtime test ${number}`,
        hashtags: [],
        collections: [],
      })),
    },
  });
  return {
    entry,
    jobs: store.createJobs({ userId, importId: entry.id, items }),
  };
}

test('runWorkerPass respects a total job cap across worker scopes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    seedJobs(store, 'runtime-a');
    seedJobs(store, 'runtime-b');
    const runtime = createWorkerRuntime({
      store,
      config: {
        videoDir: path.join(dir, 'videos'),
        workerBatchSize: 5,
        workerGlobalConcurrency: 3,
        workerPerUserConcurrency: 1,
        workerMaxAttempts: 3,
      },
    });

    const result = await runWorkerPass({
      runtime,
      maxJobs: 5,
      scopeLimit: 5,
      totalJobCap: 1,
      download: false,
    });
    const allJobs = [
      ...store.getJobs('runtime-a'),
      ...store.getJobs('runtime-b'),
    ];

    assert.equal(result.scopeCount, 2);
    assert.equal(allJobs.filter((job) => job.status === 'paused_missing_provider').length, 1);
    assert.equal(allJobs.filter((job) => job.status === 'queued').length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getWorkerStatus returns aggregate queue counts without item content', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const { jobs } = seedJobs(store);
    await store.updateJob('runtime-user', jobs[0].id, {
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    await store.updateJob('runtime-user', jobs[1].id, {
      status: 'failed',
      attempts: 3,
    });
    const runtime = createWorkerRuntime({
      store,
      config: {
        workerBatchSize: 7,
        workerScanLimit: 11,
        workerGlobalConcurrency: 2,
        workerPerUserConcurrency: 1,
        workerMaxAttempts: 3,
        workerLeaseMs: 12345,
        inlineIndexingEnabled: false,
      },
    });

    const status = await getWorkerStatus({ runtime });
    const serialized = JSON.stringify(status);

    assert.equal(status.queue.totalJobs, 2);
    assert.equal(status.queue.retrying, 1);
    assert.equal(status.queue.failed, 1);
    assert.equal(status.queue.exhausted, 1);
    assert.equal(status.worker.batchSize, 7);
    assert.equal(status.worker.leaseMs, 12345);
    assert.equal(serialized.includes('Runtime test'), false);
    assert.equal(serialized.includes('https://example.com'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
