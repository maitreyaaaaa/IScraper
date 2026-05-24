const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createLocalStore } = require('../src/stores/localStore');

function seedJobs(store, userId = 'u1') {
  store.ensureUser(userId, `${userId}@example.com`);
  const entry = store.createImport({ userId, source: 'instagram-export', fileNames: ['saved_posts.html'] });
  const items = store.upsertImportData({
    userId,
    importId: entry.id,
    parsed: {
      collections: [],
      items: [1, 2, 3].map((number) => ({
        id: `${userId}-lease-${number}`,
        url: `https://www.instagram.com/p/${userId}-lease-${number}/`,
        contentType: 'unknown',
        caption: `Lease test ${number}`,
        hashtags: [],
        collections: [],
      })),
    },
  });
  const jobs = store.createJobs({ userId, importId: entry.id, items });
  return { entry, jobs };
}

test('claimNextJobs leases a bounded batch and prevents overlapping user work', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const { entry } = seedJobs(store);
    const first = await store.claimNextJobs({
      userId: 'u1',
      importId: entry.id,
      limit: 2,
      leaseOwner: 'worker-a',
      leaseMs: 15 * 60 * 1000,
      perUserConcurrency: 1,
    });
    const second = await store.claimNextJobs({
      userId: 'u1',
      importId: entry.id,
      limit: 2,
      leaseOwner: 'worker-b',
      leaseMs: 15 * 60 * 1000,
      perUserConcurrency: 1,
    });

    assert.equal(first.length, 2);
    assert.equal(first.every((job) => job.status === 'downloading'), true);
    assert.equal(first.every((job) => job.leaseOwner === 'worker-a'), true);
    assert.equal(second.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expired active leases are reclaimable but fresh active leases are not', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const { entry } = seedJobs(store);
    const [leased] = await store.claimNextJobs({
      userId: 'u1',
      importId: entry.id,
      limit: 1,
      leaseOwner: 'worker-a',
      leaseMs: 15 * 60 * 1000,
      perUserConcurrency: 1,
    });

    const blocked = await store.claimNextJobs({
      userId: 'u1',
      importId: entry.id,
      limit: 1,
      leaseOwner: 'worker-b',
      perUserConcurrency: 1,
    });
    await store.updateJob('u1', leased.id, {
      status: 'analyzing',
      leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const reclaimed = await store.claimNextJobs({
      userId: 'u1',
      importId: entry.id,
      limit: 1,
      leaseOwner: 'worker-b',
      leaseMs: 15 * 60 * 1000,
      perUserConcurrency: 1,
    });

    assert.equal(blocked.length, 0);
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0].id, leased.id);
    assert.equal(reclaimed[0].attempts, 2);
    assert.equal(reclaimed[0].leaseOwner, 'worker-b');
    assert.ok(reclaimed[0].leaseToken);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claimNextJobs skips jobs with future retry backoff and exhausted attempts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const { entry, jobs } = seedJobs(store);
    await store.updateJob('u1', jobs[0].id, {
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    await store.updateJob('u1', jobs[1].id, { attempts: 3 });

    const claimed = await store.claimNextJobs({
      userId: 'u1',
      importId: entry.id,
      limit: 3,
      leaseOwner: 'worker-a',
      maxAttempts: 3,
      perUserConcurrency: 3,
    });

    assert.deepEqual(claimed.map((job) => job.itemId), ['u1-lease-3']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
