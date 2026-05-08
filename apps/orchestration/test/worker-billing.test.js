const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { processImportJobs } = require('../src/services/worker');
const { createLocalStore } = require('../src/stores/localStore');

test('media job pauses when no supported media provider is available', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';

  try {
    store.ensureUser(userId, 'u1@example.com');
    const entry = store.createImport({ userId, source: 'instagram-export', fileNames: ['saved_posts.html'] });
    const items = store.upsertImportData({
      userId,
      importId: entry.id,
      parsed: {
        collections: [],
        items: [
          {
            id: 'reel-1',
            url: 'https://www.instagram.com/reel/reel-1/',
            contentType: 'reel',
            caption: 'Claude media workflow',
            hashtags: [],
            collections: [],
          },
        ],
      },
    });
    const jobs = store.createJobs({ userId, importId: entry.id, items });

    await processImportJobs({
      store,
      userId,
      importId: entry.id,
      videoDir: path.join(dir, 'videos'),
      shouldDownload: false,
      credentialEncryptionKey: 'dev-encryption-key',
    });

    const job = store.getJob(userId, jobs[0].id);
    const item = store.getItem(userId, 'reel-1');

    assert.equal(job.status, 'paused_missing_provider');
    assert.equal(item.status, 'paused_missing_provider');
    assert.equal(item.analysis, null);
    assert.match(item.error, /no supported image\/video provider/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processing one saved item uses the user key without consuming app credits', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: 'Saved idea',
              summary: 'A useful saved post.',
              transcript: '',
              ocrText: '',
              visualDescription: '',
              brandsMentioned: [],
              toolsMentioned: [],
              reposMentioned: [],
              peopleMentioned: [],
              topics: ['saved'],
              tags: ['saved'],
              whyUseful: 'It is worth finding again.',
            }),
          },
        },
      ],
    }),
  });

  try {
    store.ensureUser(userId, 'u1@example.com');
    store.saveProviderCredential(userId, {
      provider: 'openrouter',
      purpose: 'text',
      model: 'deepseek/deepseek-v4-pro',
      apiKey: 'test-key',
      encryptionKey: 'dev-encryption-key',
    });
    const entry = store.createImport({ userId, source: 'instagram-export', fileNames: ['saved_posts.html'] });
    const items = store.upsertImportData({
      userId,
      importId: entry.id,
      parsed: {
        collections: [],
        items: [
          {
            id: 'item-1',
            url: 'https://www.instagram.com/p/item-1/',
            contentType: 'unknown',
            caption: 'Saved kitchen idea',
            hashtags: [],
            collections: [],
          },
        ],
      },
    });
    store.createJobs({ userId, importId: entry.id, items });

    await processImportJobs({
      store,
      userId,
      importId: entry.id,
      videoDir: path.join(dir, 'videos'),
      shouldDownload: false,
      credentialEncryptionKey: 'dev-encryption-key',
    });

    const credits = store.getCredits(userId);
    const item = store.getItem(userId, 'item-1');

    assert.equal(item.status, 'done');
    assert.equal(credits.freeItemsUsed, 0);
    assert.equal(credits.freeItemsRemaining, 200);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
