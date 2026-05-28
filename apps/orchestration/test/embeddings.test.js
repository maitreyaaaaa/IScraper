const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildEmbeddingContent,
  createOpenAIEmbedding,
  createOpenRouterEmbedding,
  parseOpenRouterEmbeddingResponse,
} = require('../src/services/embeddings');

test('buildEmbeddingContent combines searchable item and analysis fields', () => {
  const content = buildEmbeddingContent(
    { caption: 'Claude Code GitHub repo demo' },
    {
      summary: 'Shows an AI agent workflow.',
      transcript: 'The reel mentions MCP and memory.',
      toolsMentioned: ['Claude Code'],
      reposMentioned: ['owner/example'],
      topics: ['AI agents'],
    },
  );

  assert.match(content, /Claude Code GitHub repo demo/);
  assert.match(content, /MCP and memory/);
  assert.match(content, /owner\/example/);
});

test('parseOpenRouterEmbeddingResponse extracts embedding vector', () => {
  const embedding = parseOpenRouterEmbeddingResponse({
    data: [{ embedding: [0.1, 0.2, 0.3] }],
  });

  assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
});

test('createOpenRouterEmbedding sends OpenRouter embedding request without exposing secrets', async () => {
  let request = null;
  const embedding = await createOpenRouterEmbedding({
    apiKey: 'test-key',
    model: 'openai/text-embedding-3-small',
    input: 'agent memory tools',
    dimensions: 1536,
    inputType: 'search_query',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.4, 0.5] }] }),
      };
    },
  });

  const body = JSON.parse(request.init.body);
  assert.equal(request.url, 'https://openrouter.ai/api/v1/embeddings');
  assert.equal(body.model, 'openai/text-embedding-3-small');
  assert.equal(body.input_type, 'search_query');
  assert.deepEqual(embedding, [0.4, 0.5]);
  assert.doesNotMatch(request.init.body, /test-key/);
});

test('createOpenAIEmbedding sends native OpenAI embedding request', async () => {
  let request = null;
  const embedding = await createOpenAIEmbedding({
    apiKey: 'test-key',
    model: 'text-embedding-3-small',
    input: 'agent memory tools',
    dimensions: 1536,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.6, 0.7] }] }),
      };
    },
  });

  const body = JSON.parse(request.init.body);
  assert.equal(request.url, 'https://api.openai.com/v1/embeddings');
  assert.equal(body.model, 'text-embedding-3-small');
  assert.equal(body.input_type, undefined);
  assert.deepEqual(embedding, [0.6, 0.7]);
  assert.doesNotMatch(request.init.body, /test-key/);
});
