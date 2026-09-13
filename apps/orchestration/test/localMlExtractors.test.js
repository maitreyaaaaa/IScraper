const assert = require('node:assert/strict');
const test = require('node:test');

const {
  analyzeImageBufferWithLocalMl,
  analyzeMediaWithLocalMl,
  normalizeLocalMlAnalysis,
} = require('../src/services/localMlExtractors');

test('local media extractor posts shared file references and normalizes searchable analysis', async () => {
  let request = null;
  const analysis = await analyzeMediaWithLocalMl({
    endpoint: 'http://127.0.0.1:7777/',
    mediaPaths: ['C:\\tmp\\screen.png', 'C:\\tmp\\clip.mp4'],
    item: {
      id: 'save-1',
      url: 'https://example.com/save',
      contentType: 'reel',
      caption: 'MCP demo',
      sourceTitle: 'Demo page',
    },
    apiKey: 'local-secret',
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      assert.equal(options.headers['x-local-ml-api-key'], 'local-secret');
      return {
        ok: true,
        json: async () => ({
          analysis: {
            ocrText: 'OpenAI Codex setup',
            transcript: 'Agent memory workflow',
            visualDescription: 'A browser screenshot with setup instructions.',
            topics: ['agent memory'],
          },
        }),
      };
    },
  });

  assert.equal(request.url, 'http://127.0.0.1:7777/v1/media/analyze');
  assert.equal(request.body.item.id, 'save-1');
  assert.equal(request.body.media[0].kind, 'image');
  assert.equal(request.body.media[0].mimeType, 'image/png');
  assert.equal(request.body.media[1].kind, 'video');
  assert.equal(request.body.media[1].mimeType, 'video/mp4');
  assert.equal(analysis.ocrText, 'OpenAI Codex setup');
  assert.equal(analysis.transcript, 'Agent memory workflow');
  assert.ok(analysis.toolsMentioned.includes('OpenAI'));
  assert.ok(analysis.topics.includes('agent memory'));
});

test('local image extractor sends base64 image payload', async () => {
  let request = null;
  const analysis = await analyzeImageBufferWithLocalMl({
    endpoint: 'http://127.0.0.1:7777',
    imageBuffer: Buffer.from('image-bytes'),
    mimeType: 'image/png',
    item: { id: 'capture-1' },
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({ ocr_text: 'Visible launch checklist' }),
      };
    },
  });

  assert.equal(request.url, 'http://127.0.0.1:7777/v1/image/analyze');
  assert.equal(request.body.image.base64, Buffer.from('image-bytes').toString('base64'));
  assert.equal(analysis.ocrText, 'Visible launch checklist');
});

test('local extractor ignores empty extraction output', () => {
  assert.equal(normalizeLocalMlAnalysis({ topics: ['empty'] }), null);
});

test('local extractor normalizes visual embeddings as internal metadata', () => {
  const analysis = normalizeLocalMlAnalysis({
    image_embedding: [0.1, '0.2', 0.3],
    image_embedding_model: 'clip-vit-base',
  });

  assert.deepEqual(analysis._visualEmbedding, [0.1, 0.2, 0.3]);
  assert.equal(analysis._visualEmbeddingModel, 'clip-vit-base');
  assert.equal(analysis.visualEmbedding, undefined);
  assert.equal(analysis.image_embedding, undefined);
});
