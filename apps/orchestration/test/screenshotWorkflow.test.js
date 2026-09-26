const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createScreenshotWorkflow } = require('../src/application/screenshotWorkflow');
const { createLocalStore } = require('../src/stores/localStore');

test('screenshot analysis budget blocks before provider work begins', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  let providerCalls = 0;
  store.consumeRateBudget = async ({ scope }) => {
    assert.equal(scope, 'media_analysis');
    return { allowed: false, exceeded: 'day', retryAt: new Date(Date.now() + 60_000).toISOString() };
  };
  const originalFetch = global.fetch;
  global.fetch = async () => {
    providerCalls += 1;
    throw new Error('No provider call should follow quota denial.');
  };

  try {
    store.ensureUser('screenshot-budget-user', 'screenshot@example.com');
    const workflow = createScreenshotWorkflow({
      store,
      config: { localMlEndpoint: 'http://127.0.0.1:7777', openAiApiKey: 'app-openai-key' },
    });

    await assert.rejects(
      () => workflow.prepareScreenshotAnalysis({ userId: 'screenshot-budget-user' }),
      (error) => error.statusCode === 429 && error.retryAfterSeconds > 0,
    );
    assert.equal(providerCalls, 0);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('screenshot workflow prefers local ML extraction before paid image analysis', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const originalFetch = global.fetch;
  let localMlRequests = 0;

  global.fetch = async (url, options) => {
    localMlRequests += 1;
    const body = JSON.parse(options.body);
    assert.equal(url, 'http://127.0.0.1:7777/v1/image/analyze');
    assert.equal(body.image.mimeType, 'image/png');
    return {
      ok: true,
      json: async () => ({
        analysis: {
          title: 'Captured checklist',
          ocrText: 'Launch plan and pricing notes',
          visualDescription: 'Browser capture of a launch planning page.',
        },
      }),
    };
  };

  try {
    store.ensureUser('local-dev-user', 'local@example.com');
    const importEntry = store.createImport({ userId: 'local-dev-user', source: 'extension', fileNames: ['capture.png'] });
    const [item] = store.upsertImportData({
      userId: 'local-dev-user',
      importId: importEntry.id,
      parsed: {
        collections: [],
        items: [{
          id: 'capture-local-ml',
          url: 'https://example.com/capture',
          contentType: 'screenshot',
          caption: '',
          hashtags: [],
          collections: [],
        }],
      },
    });
    const workflow = createScreenshotWorkflow({
      store,
      config: {
        localMlEndpoint: 'http://127.0.0.1:7777',
        openAiApiKey: 'app-openai-key',
      },
    });

    const updated = await workflow.analyzeExtensionScreenshot({
      userId: 'local-dev-user',
      item,
      file: {
        buffer: Buffer.from('image-bytes'),
        mimetype: 'image/png',
      },
    });
    const rawState = JSON.parse(readFileSync(path.join(dir, 'brain.local.json'), 'utf8'));
    const rawItem = rawState.items.find((entry) => entry.id === 'capture-local-ml');

    assert.equal(localMlRequests, 1);
    assert.equal(updated.analysis.ocrText, 'Launch plan and pricing notes');
    assert.equal(updated.analysis._processingLevel, undefined);
    assert.equal(rawItem.analysisMetadata.processingLevel, 'ml');
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('screenshot workflow falls back to paid image analysis when local extraction is empty', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const originalFetch = global.fetch;
  let localMlRequests = 0;
  let openAiRequests = 0;

  global.fetch = async (url) => {
    if (String(url).startsWith('http://127.0.0.1:7777')) {
      localMlRequests += 1;
      return {
        ok: true,
        json: async () => ({}),
      };
    }
    if (String(url).startsWith('https://api.openai.com/')) {
      openAiRequests += 1;
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                title: 'Fallback capture',
                summary: 'Paid fallback summary.',
                transcript: '',
                ocrText: 'Fallback OCR text',
                visualDescription: '',
                brandsMentioned: [],
                toolsMentioned: [],
                reposMentioned: [],
                peopleMentioned: [],
                topics: [],
                tags: [],
                whyUseful: 'Useful browser screenshot reference.',
              }),
            },
          }],
        }),
      };
    }
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    store.ensureUser('local-dev-user', 'local@example.com');
    store.addCreditTransaction({ userId: 'local-dev-user', amount: 1, reason: 'test' });
    const importEntry = store.createImport({ userId: 'local-dev-user', source: 'extension', fileNames: ['capture.png'] });
    const [item] = store.upsertImportData({
      userId: 'local-dev-user',
      importId: importEntry.id,
      parsed: {
        collections: [],
        items: [{
          id: 'capture-paid-fallback',
          url: 'https://example.com/capture',
          contentType: 'screenshot',
          caption: '',
          hashtags: [],
          collections: [],
        }],
      },
    });
    const workflow = createScreenshotWorkflow({
      store,
      config: {
        localMlEndpoint: 'http://127.0.0.1:7777',
        openAiApiKey: 'app-openai-key',
      },
    });

    const updated = await workflow.analyzeExtensionScreenshot({
      userId: 'local-dev-user',
      item,
      file: {
        buffer: Buffer.from('image-bytes'),
        mimetype: 'image/png',
      },
    });
    const rawState = JSON.parse(readFileSync(path.join(dir, 'brain.local.json'), 'utf8'));
    const rawItem = rawState.items.find((entry) => entry.id === 'capture-paid-fallback');

    assert.equal(localMlRequests, 1);
    assert.equal(openAiRequests, 1);
    assert.equal(updated.analysis.ocrText, 'Fallback OCR text');
    assert.equal(rawItem.analysisMetadata.processingLevel, 'ai_enriched');
    assert.equal(store.getCredits('local-dev-user').paidCredits, 0);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
