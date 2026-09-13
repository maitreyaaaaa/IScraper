const assert = require('node:assert/strict');
const test = require('node:test');

const { chooseAnalysisPlan } = require('../src/services/worker');

test('missing app-owned AI falls back to basic indexing plan', async () => {
  const store = {
    async getPreferredProviderCredential(_userId, purpose) {
      return {
        id: `${purpose}-key`,
        provider: 'openrouter',
        purpose,
        model: 'deepseek/deepseek-v4-pro',
        apiKey: 'sk-test',
      };
    },
  };

  const plan = await chooseAnalysisPlan({
    store,
    userId: 'user-1',
    item: { contentType: 'reel' },
    credentialEncryptionKey: 'dev-key',
  });

  assert.equal(plan.source, null);
  assert.equal(plan.textCredential, null);
  assert.equal(plan.mediaCredential, null);
  assert.equal(plan.embeddingCredential, null);
});

test('app-owned analysis uses OpenAI gpt-4o when configured', async () => {
  const store = {
    async getCredits() {
      return { paidCredits: 1 };
    },
  };

  const plan = await chooseAnalysisPlan({
    store,
    userId: 'user-1',
    item: { contentType: 'post' },
    openAiApiKey: 'sk-test',
    openAiModel: 'gpt-4o',
    openAiMediaModel: 'gpt-4o',
    openAiEmbeddingModel: 'text-embedding-3-small',
  });

  assert.equal(plan.source, 'paid');
  assert.equal(plan.textCredential.provider, 'openai');
  assert.equal(plan.textCredential.model, 'gpt-4o');
  assert.equal(plan.mediaCredential.provider, 'openai');
  assert.equal(plan.mediaCredential.model, 'gpt-4o');
  assert.equal(plan.embeddingCredential.provider, 'openai');
  assert.equal(plan.embeddingCredential.model, 'text-embedding-3-small');
});

test('app-owned AI without paid credits falls back to basic indexing plan', async () => {
  const store = {
    async getCredits() {
      return { paidCredits: 0 };
    },
  };

  const plan = await chooseAnalysisPlan({
    store,
    userId: 'user-1',
    item: { contentType: 'post' },
    openAiApiKey: 'sk-test',
    openAiModel: 'gpt-4o',
    openAiMediaModel: 'gpt-4o',
    openAiEmbeddingModel: 'text-embedding-3-small',
  });

  assert.equal(plan.source, null);
  assert.equal(plan.textCredential, null);
  assert.equal(plan.mediaCredential, null);
  assert.equal(plan.embeddingCredential, null);
});
