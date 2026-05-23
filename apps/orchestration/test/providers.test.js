const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_APP_MEDIA_MODEL,
  DEFAULT_APP_TEXT_MODEL,
  MEDIA_MODEL_ALLOWLIST,
  TEXT_PROVIDERS,
  assertMediaModelAllowed,
} = require('../src/services/providers');
const { testProviderCredential } = require('../src/services/providerClients');

test('provider registry includes DeepSeek default and GLM text support', () => {
  assert.equal(DEFAULT_APP_TEXT_MODEL, 'deepseek/deepseek-v4-pro');
  assert.equal(TEXT_PROVIDERS.glm.defaultModel, 'z-ai/glm-5.1');
});

test('media allowlist only includes direct image and video models', () => {
  assert.equal(DEFAULT_APP_MEDIA_MODEL, 'google/gemini-3.1-flash-lite-preview');
  assert.equal(MEDIA_MODEL_ALLOWLIST.includes('z-ai/glm-5v-turbo'), true);
  assert.equal(MEDIA_MODEL_ALLOWLIST.includes('qwen/qwen3.6-flash'), true);
  assert.equal(MEDIA_MODEL_ALLOWLIST.includes('openai/gpt-5.5'), false);
  assert.equal(MEDIA_MODEL_ALLOWLIST.includes('anthropic/claude-opus-4.7'), false);
});

test('assertMediaModelAllowed rejects unsupported media models', () => {
  assert.doesNotThrow(() => assertMediaModelAllowed('z-ai/glm-5v-turbo'));
  assert.throws(() => assertMediaModelAllowed('openai/gpt-5.5'), /does not support direct image and video/);
});

test('testProviderCredential performs a lightweight provider request', async () => {
  const calls = [];
  await testProviderCredential({
    credential: {
      provider: 'openrouter',
      purpose: 'text',
      model: 'deepseek/deepseek-v4-pro',
      apiKey: 'sk-test',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(JSON.parse(calls[0].options.body).messages[0].content, 'Reply OK.');
});

test('testProviderCredential uses embeddings endpoint for embedding keys', async () => {
  const calls = [];
  await testProviderCredential({
    credential: {
      provider: 'openrouter',
      purpose: 'embedding',
      model: 'openai/text-embedding-3-small',
      apiKey: 'sk-test',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/embeddings');
  assert.equal(JSON.parse(calls[0].options.body).input, 'test search');
});
