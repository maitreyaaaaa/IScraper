const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createLocalStore } = require('../src/stores/localStore');
const { processPendingStorageImports } = require('../src/services/storageImports');
const { processIndexingScope } = require('../src/services/workerRuntime');

function makeStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'iscraper-lease-'));
  return { dir, store: createLocalStore({ dataPath: dir }) };
}

async function seedJobs(store, userId = 'local-dev-user') {
  await store.ensureUser(userId, `${userId}@example.com`);
  const importEntry = store.createImport({ userId, source: 'test', fileNames: ['saved.html'] });
  const parsed = {
    collections: [],
    items: [
      { id: 'a', url: `https://www.instagram.com/p/${userId}-a/`, contentType: 'unknown', caption: 'A', hashtags: [], collections: [] },
      { id: 'b', url: `https://www.instagram.com/p/${userId}-b/`, contentType: 'unknown', caption: 'B', hashtags: [], collections: [] },
    ],
  };
  const items = store.upsertImportData({ userId, importId: importEntry.id, parsed });
  const jobs = store.createJobs({ userId, importId: importEntry.id, items });
  return { importEntry, jobs };
}

test('queued jobs are claimed once under concurrent workers', async () => {
  const { dir, store } = makeStore();
  try {
    const { importEntry } = await seedJobs(store);
    const [first, second] = await Promise.all([
      store.claimNextJobs({ userId: 'local-dev-user', importId: importEntry.id, limit: 2, leaseOwner: 'one' }),
      store.claimNextJobs({ userId: 'local-dev-user', importId: importEntry.id, limit: 2, leaseOwner: 'two' }),
    ]);

    assert.equal(first.length + second.length, 2);
    const owners = new Set((await store.getJobs('local-dev-user', importEntry.id)).map((job) => job.leaseOwner).filter(Boolean));
    assert.equal(owners.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expired active leases are reclaimable but fresh leases are not', async () => {
  const { dir, store } = makeStore();
  try {
    const { importEntry, jobs } = await seedJobs(store);
    const freshExpiry = new Date(Date.now() + 60_000).toISOString();
    const expired = new Date(Date.now() - 60_000).toISOString();
    await store.updateJob('local-dev-user', jobs[0].id, { status: 'analyzing', leaseOwner: 'old', leaseExpiresAt: expired });
    await store.updateJob('local-dev-user', jobs[1].id, { status: 'downloading', leaseOwner: 'fresh', leaseExpiresAt: freshExpiry });

    const claimed = await store.claimNextJobs({ userId: 'local-dev-user', importId: importEntry.id, limit: 2, leaseOwner: 'new', perUserConcurrency: 2 });

    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, jobs[0].id);
    assert.equal((await store.getJob('local-dev-user', jobs[1].id)).leaseOwner, 'fresh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('per-user concurrency cap prevents multiple active batches for one user', async () => {
  const { dir, store } = makeStore();
  try {
    const { importEntry } = await seedJobs(store);
    const first = await store.claimNextJobs({ userId: 'local-dev-user', importId: importEntry.id, limit: 1, leaseOwner: 'first', perUserConcurrency: 1 });
    const second = await store.claimNextJobs({ userId: 'local-dev-user', importId: importEntry.id, limit: 1, leaseOwner: 'second', perUserConcurrency: 1 });

    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('VM indexing scope can process media posts as text-only when media download is disabled', async () => {
  const { dir, store } = makeStore();
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: 'Text-first reel',
              summary: 'A reel indexed from its caption.',
              transcript: '',
              ocrText: '',
              visualDescription: '',
              brandsMentioned: [],
              toolsMentioned: [],
              reposMentioned: [],
              peopleMentioned: [],
              topics: ['caption'],
              tags: ['caption'],
              whyUseful: 'The caption is searchable.',
            }),
          },
        },
      ],
    }),
  });

  try {
    const userId = 'local-dev-user';
    await store.ensureUser(userId, 'local@example.com');
    store.saveProviderCredential(userId, {
      provider: 'openrouter',
      purpose: 'text',
      model: 'deepseek/deepseek-v4-pro',
      apiKey: 'test-key',
      encryptionKey: 'dev-encryption-key',
    });
    const importEntry = store.createImport({ userId, source: 'test', fileNames: ['saved.html'] });
    const parsed = {
      collections: [],
      items: [
        { id: 'reel-text', url: 'https://www.instagram.com/reel/reel-text/', contentType: 'reel', caption: 'Caption-only indexing', hashtags: [], collections: [] },
      ],
    };
    const items = store.upsertImportData({ userId, importId: importEntry.id, parsed });
    store.createJobs({ userId, importId: importEntry.id, items });

    const processed = await processIndexingScope({
      store,
      config: {
        videoDir: path.join(dir, 'videos'),
        openRouterModel: 'deepseek/deepseek-v4-pro',
        openRouterMediaModel: 'google/gemini-3.1-flash-lite-preview',
        openRouterEmbeddingModel: 'openai/text-embedding-3-small',
        embeddingDimensions: 1536,
        credentialEncryptionKey: 'dev-encryption-key',
        workerBatchSize: 5,
        workerLeaseOwner: 'test-worker',
        workerLeaseMs: 900000,
        workerPerUserConcurrency: 1,
      },
      userId,
      importId: importEntry.id,
      maxJobs: 1,
    });

    const item = store.getItem(userId, 'reel-text');
    assert.equal(processed.length, 1);
    assert.equal(item.status, 'done');
    assert.equal(item.analysis.summary, 'A reel indexed from its caption.');
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('VM worker parses queued storage imports and creates indexing jobs', async () => {
  const { dir, store } = makeStore();
  const html = `
    <main>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/STORAGE1/">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Storage import post</td></tr>
      </table></div>
    </main>`;
  const removed = [];

  try {
    store.client = {
      storage: {
        from() {
          return {
            download: async () => ({ data: new Blob([html], { type: 'text/html' }), error: null }),
            remove: async (paths) => {
              removed.push(...paths);
              return { data: [], error: null };
            },
          };
        },
      },
    };
    const importEntry = store.createImport({
      userId: 'local-dev-user',
      source: 'storage-upload',
      fileNames: ['saved_posts.html'],
      status: 'queued_storage',
      storageFiles: [{ path: 'local-dev-user/imports/batch/saved_posts.html', name: 'saved_posts.html', type: 'text/html', size: html.length }],
    });

    const results = await processPendingStorageImports({
      store,
      config: { importUploadBucket: 'instagram-assets' },
      limit: 1,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].importId, importEntry.id);
    assert.equal(results[0].items, 1);
    assert.equal(results[0].jobs, 1);
    assert.equal(store.dump().imports[0].status, 'imported');
    assert.equal((await store.getJobs('local-dev-user', importEntry.id)).length, 1);
    assert.deepEqual(removed, ['local-dev-user/imports/batch/saved_posts.html']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
