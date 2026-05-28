const assert = require('node:assert/strict');
const test = require('node:test');

const { chooseAnalysisPlan } = require('../src/services/worker');

test('media saves can fall back to text-only indexing when media credential is missing', async () => {
  const textCredential = {
    id: 'text-key',
    provider: 'openrouter',
    purpose: 'text',
    model: 'deepseek/deepseek-v4-pro',
    apiKey: 'sk-test',
  };
  const store = {
    async getPreferredProviderCredential(_userId, purpose) {
      return purpose === 'text' ? textCredential : null;
    },
  };

  const plan = await chooseAnalysisPlan({
    store,
    userId: 'user-1',
    item: { contentType: 'reel' },
    credentialEncryptionKey: 'dev-key',
  });

  assert.equal(plan.source, 'byok');
  assert.equal(plan.mediaCredential, null);
  assert.equal(plan.textCredential, textCredential);
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
