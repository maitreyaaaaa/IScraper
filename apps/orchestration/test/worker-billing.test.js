const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { processImportJobs } = require('../src/services/worker');
const { buildEmbeddingContent } = require('../src/services/embeddings');
const { buildEmbeddingContentHash } = require('../src/services/contentHashes');
const { createLocalStore } = require('../src/stores/localStore');

test('media job completes basic indexing when no text provider is available', async () => {
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

    assert.equal(job.status, 'done');
    assert.equal(item.status, 'done');
    assert.equal(item.analysis.title, 'Claude media workflow');
    assert.equal(item.analysis.summary, 'Claude media workflow');
    assert.equal(item.analysis.transcript, '');
    assert.equal(item.analysis._processingLevel, undefined);
    assert.equal(item.analysis._sourceContentHash, undefined);
    assert.equal(item.analysis._embeddingContentHash, undefined);
    assert.equal(item.analysis.processingLevel, undefined);
    assert.equal(item.error, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processing one saved item completes basic indexing without app-owned AI', async () => {
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

    assert.equal(job.status, 'done');
    assert.equal(item.status, 'done');
    assert.equal(item.analysis.title, 'Saved kitchen idea');
    assert.equal(item.analysis.summary, 'Saved kitchen idea');
    assert.equal(item.analysis._processingLevel, undefined);
    assert.equal(item.analysis._sourceContentHash, undefined);
    assert.equal(item.analysis._embeddingContentHash, undefined);
    assert.equal(item.analysis.processingLevel, undefined);
    assert.equal(item.error, null);
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
    const rawState = JSON.parse(readFileSync(path.join(dir, 'brain.local.json'), 'utf8'));
    const rawItem = rawState.items.find((entry) => entry.id === 'item-2');

    assert.equal(item.status, 'done');
    assert.equal(item.analysis._processingLevel, undefined);
    assert.equal(item.analysis._sourceContentHash, undefined);
    assert.equal(item.analysis._embeddingContentHash, undefined);
    assert.equal(item.analysis.processingLevel, undefined);
    assert.equal(rawItem.analysisMetadata.processingLevel, 'ai_enriched');
    assert.match(rawItem.analysisMetadata.sourceContentHash, /^[a-f0-9]{64}$/);
    assert.equal(credits.freeItemsUsed, 0);
    assert.equal(credits.freeItemsRemaining, 0);
    assert.equal(credits.paidCredits, 0);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('media job uses local ML extraction without paid AI credits', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';
  let localMlRequests = 0;

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
            id: 'local-ml-post',
            url: 'https://www.instagram.com/p/local-ml-post/',
            contentType: 'post',
            caption: 'Local media extraction',
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
      shouldDownload: true,
      openAiApiKey: 'app-openai-key',
      localMlEndpoint: 'http://127.0.0.1:7777',
      localMlFetchImpl: async (url, options) => {
        localMlRequests += 1;
        const body = JSON.parse(options.body);
        assert.equal(url, 'http://127.0.0.1:7777/v1/media/analyze');
        assert.equal(body.media[0].fileName, 'local-ml-post.png');
        return {
          ok: true,
          json: async () => ({
            ocrText: 'Supabase launch checklist',
            visualDescription: 'Screenshot of a product launch checklist.',
            imageEmbedding: [0.1, 0.2, 0.3],
            imageEmbeddingModel: 'clip-vit-base',
          }),
        };
      },
      downloadMedia: async () => ({
        outputPaths: [path.join(dir, 'local-ml-post.png')],
      }),
      credentialEncryptionKey: 'dev-encryption-key',
    });

    const job = store.getJobs(userId, entry.id)[0];
    const item = store.getItem(userId, 'local-ml-post');
    const rawState = JSON.parse(readFileSync(path.join(dir, 'brain.local.json'), 'utf8'));
    const rawItem = rawState.items.find((entry) => entry.id === 'local-ml-post');

    assert.equal(localMlRequests, 1);
    assert.equal(job.status, 'done');
    assert.equal(item.status, 'done');
    assert.equal(item.analysis.ocrText, 'Supabase launch checklist');
    assert.equal(item.analysis._processingLevel, undefined);
    assert.equal(item.analysis._visualEmbedding, undefined);
    assert.equal(rawItem.analysisMetadata.processingLevel, 'ml');
    assert.deepEqual(store.getVisualEmbeddingMetadata(userId, 'local-ml-post'), {
      contentHash: rawItem.analysisMetadata.sourceContentHash,
      model: 'clip-vit-base',
      dimensions: 3,
    });
    assert.equal(store.getCredits(userId).paidCredits, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('media job skips unchanged local ML extraction input', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';
  let localMlRequests = 0;
  let downloads = 0;

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
            id: 'local-ml-cached',
            url: 'https://www.instagram.com/p/local-ml-cached/',
            contentType: 'post',
            caption: 'Cached local media extraction',
            hashtags: [],
            collections: [],
          },
        ],
      },
    });
    const [job] = store.createJobs({ userId, importId: entry.id, items });

    const downloadMedia = async () => {
      downloads += 1;
      return { outputPaths: [path.join(dir, 'local-ml-cached.png')] };
    };

    await processImportJobs({
      store,
      userId,
      importId: entry.id,
      videoDir: path.join(dir, 'videos'),
      shouldDownload: true,
      localMlEndpoint: 'http://127.0.0.1:7777',
      localMlFetchImpl: async () => {
        localMlRequests += 1;
        return {
          ok: true,
          json: async () => ({
            ocrText: 'Cached product launch checklist',
            visualDescription: 'Screenshot of a launch checklist.',
          }),
        };
      },
      downloadMedia,
      credentialEncryptionKey: 'dev-encryption-key',
    });

    store.updateJob(userId, job.id, {
      status: 'queued',
      attempts: 0,
      error: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      completedAt: null,
    });
    store.setItemStatus(userId, 'local-ml-cached', 'queued', null);

    await processImportJobs({
      store,
      userId,
      importId: entry.id,
      videoDir: path.join(dir, 'videos'),
      shouldDownload: true,
      localMlEndpoint: 'http://127.0.0.1:7777',
      localMlFetchImpl: async () => {
        localMlRequests += 1;
        throw new Error('unchanged media should not be extracted again');
      },
      downloadMedia,
      credentialEncryptionKey: 'dev-encryption-key',
    });

    const rawState = JSON.parse(readFileSync(path.join(dir, 'brain.local.json'), 'utf8'));
    const rawItem = rawState.items.find((entry) => entry.id === 'local-ml-cached');
    const item = store.getItem(userId, 'local-ml-cached');

    assert.equal(downloads, 2);
    assert.equal(localMlRequests, 1);
    assert.equal(item.status, 'done');
    assert.equal(item.analysis.ocrText, 'Cached product launch checklist');
    assert.equal(rawItem.analysisMetadata.processingLevel, 'ml');
    assert.match(rawItem.analysisMetadata.sourceContentHash, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processing skips unchanged embedding content', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const userId = 'u1';
  const originalFetch = global.fetch;
  let embeddingRequests = 0;
  let savedEmbeddings = 0;

  const llmAnalysis = {
    title: 'Cached embedding idea',
    summary: 'A useful save with an existing embedding.',
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
  };

  global.fetch = async (url) => {
    if (String(url).includes('/embeddings')) {
      embeddingRequests += 1;
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
              content: JSON.stringify(llmAnalysis),
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
            id: 'item-cached-embedding',
            url: 'https://www.instagram.com/p/item-cached-embedding/',
            contentType: 'unknown',
            caption: 'Saved cached embedding idea',
            hashtags: [],
            collections: [],
          },
        ],
      },
    });
    store.createJobs({ userId, importId: entry.id, items });

    const expectedContent = buildEmbeddingContent(items[0], llmAnalysis);
    const expectedHash = buildEmbeddingContentHash(expectedContent);
    store.getEmbeddingMetadata = async () => ({
      contentHash: expectedHash,
      model: 'text-embedding-3-small',
    });
    store.saveEmbedding = async () => {
      savedEmbeddings += 1;
    };

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

    const rawState = JSON.parse(readFileSync(path.join(dir, 'brain.local.json'), 'utf8'));
    const rawItem = rawState.items.find((entry) => entry.id === 'item-cached-embedding');

    assert.equal(embeddingRequests, 0);
    assert.equal(savedEmbeddings, 0);
    assert.equal(rawItem.analysisMetadata.embeddingContentHash, expectedHash);
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
