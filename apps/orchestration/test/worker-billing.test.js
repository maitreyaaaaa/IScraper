const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { processImportJobs } = require('../src/services/worker');
const { createLocalStore } = require('../src/stores/localStore');

test('media job pauses only when no text provider is available', async () => {
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
    assert.match(item.error, /IScraper AI processing is not configured/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processing one saved item pauses without app-owned AI', async () => {
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

    const job = store.getJobs(userId, entry.id)[0];
    const item = store.getItem(userId, 'item-1');

    assert.equal(job.status, 'paused_missing_provider');
    assert.equal(item.status, 'paused_missing_provider');
    assert.match(item.error, /IScraper AI processing is not configured/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processing one saved item uses app OpenAI key and consumes paid credit', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (String(url).includes('/embeddings')) {
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'App indexed idea',
                summary: 'A useful save indexed by the app key.',
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
    };
  };

  try {
    store.ensureUser(userId, 'u1@example.com');
    store.addCreditTransaction({ userId, amount: 1, reason: 'test' });
    const entry = store.createImport({ userId, source: 'instagram-export', fileNames: ['saved_posts.html'] });
    const items = store.upsertImportData({
      userId,
      importId: entry.id,
      parsed: {
        collections: [],
        items: [
          {
            id: 'item-2',
            url: 'https://www.instagram.com/p/item-2/',
            contentType: 'unknown',
            caption: 'Saved garden idea',
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
      openAiApiKey: 'app-openai-key',
      openAiModel: 'gpt-4o',
      openAiEmbeddingModel: 'text-embedding-3-small',
      credentialEncryptionKey: 'dev-encryption-key',
    });

    const credits = store.getCredits(userId);
    const item = store.getItem(userId, 'item-2');

    assert.equal(item.status, 'done');
    assert.equal(credits.freeItemsUsed, 0);
    assert.equal(credits.freeItemsRemaining, 0);
    assert.equal(credits.paidCredits, 0);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processing jobs can run with bounded parallel indexing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';
  const originalFetch = global.fetch;
  let inFlight = 0;
  let maxInFlight = 0;

  global.fetch = async (url) => {
    if (String(url).includes('/embeddings')) {
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      };
    }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 50));
    inFlight -= 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Parallel idea',
                summary: 'A save processed in a parallel batch.',
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
    };
  };

  try {
    store.ensureUser(userId, 'u1@example.com');
    store.addCreditTransaction({ userId, amount: 3, reason: 'test' });
    const entry = store.createImport({ userId, source: 'instagram-export', fileNames: ['saved_posts.html'] });
    const items = store.upsertImportData({
      userId,
      importId: entry.id,
      parsed: {
        collections: [],
        items: [1, 2, 3].map((number) => ({
          id: `parallel-${number}`,
          url: `https://www.instagram.com/p/parallel-${number}/`,
          contentType: 'unknown',
          caption: `Saved idea ${number}`,
          hashtags: [],
          collections: [],
        })),
      },
    });
    store.createJobs({ userId, importId: entry.id, items });

    await processImportJobs({
      store,
      userId,
      importId: entry.id,
      videoDir: path.join(dir, 'videos'),
      shouldDownload: false,
      openAiApiKey: 'app-openai-key',
      openAiModel: 'gpt-4o',
      openAiEmbeddingModel: 'text-embedding-3-small',
      credentialEncryptionKey: 'dev-encryption-key',
      indexingConcurrency: 3,
    });

    const jobs = await store.getJobs(userId, entry.id);
    assert.equal(jobs.every((job) => job.status === 'done'), true);
    assert.equal(store.getCredits(userId).freeItemsUsed, 0);
    assert.equal(store.getCredits(userId).paidCredits, 0);
    assert.ok(maxInFlight > 1);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('transient provider failures back off instead of retrying immediately forever', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: 'Provider temporarily unavailable' } }),
  });

  try {
    store.ensureUser(userId, 'u1@example.com');
    store.addCreditTransaction({ userId, amount: 1, reason: 'test' });
    const entry = store.createImport({ userId, source: 'manual-link', fileNames: ['https://example.com/retry'] });
    const items = store.upsertImportData({
      userId,
      importId: entry.id,
      parsed: {
        collections: [],
        items: [{ id: 'retry-1', url: 'https://example.com/retry', contentType: 'unknown', caption: 'Retry me', hashtags: [], collections: [] }],
      },
    });
    const [createdJob] = store.createJobs({ userId, importId: entry.id, items });

    await processImportJobs({
      store,
      userId,
      importId: entry.id,
      videoDir: path.join(dir, 'videos'),
      shouldDownload: false,
      openAiApiKey: 'app-openai-key',
      openAiModel: 'gpt-4o',
      openAiEmbeddingModel: 'text-embedding-3-small',
      maxAttempts: 2,
      retryBackoffMs: 60 * 1000,
    });

    const job = store.getJob(userId, createdJob.id);
    const item = store.getItem(userId, 'retry-1');

    assert.equal(job.status, 'queued');
    assert.equal(job.attempts, 1);
    assert.ok(Date.parse(job.nextAttemptAt) > Date.now());
    assert.equal(job.leaseToken, null);
    assert.equal(item.status, 'queued');
    assert.match(item.error, /retry automatically/i);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider failures become terminal after max attempts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: 'Provider temporarily unavailable' } }),
  });

  try {
    store.ensureUser(userId, 'u1@example.com');
    store.addCreditTransaction({ userId, amount: 1, reason: 'test' });
    const entry = store.createImport({ userId, source: 'manual-link', fileNames: ['https://example.com/fail'] });
    const items = store.upsertImportData({
      userId,
      importId: entry.id,
      parsed: {
        collections: [],
        items: [{ id: 'fail-1', url: 'https://example.com/fail', contentType: 'unknown', caption: 'Fail me', hashtags: [], collections: [] }],
      },
    });
    const [createdJob] = store.createJobs({ userId, importId: entry.id, items });

    await processImportJobs({
      store,
      userId,
      importId: entry.id,
      videoDir: path.join(dir, 'videos'),
      shouldDownload: false,
      openAiApiKey: 'app-openai-key',
      openAiModel: 'gpt-4o',
      openAiEmbeddingModel: 'text-embedding-3-small',
      maxAttempts: 1,
    });

    const job = store.getJob(userId, createdJob.id);
    const item = store.getItem(userId, 'fail-1');

    assert.equal(job.status, 'failed');
    assert.equal(job.attempts, 1);
    assert.equal(job.nextAttemptAt, null);
    assert.equal(item.status, 'failed');
    assert.match(item.error, /retry if attempts remain/i);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
