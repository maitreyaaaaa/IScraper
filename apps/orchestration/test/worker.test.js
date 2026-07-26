const assert = require('node:assert/strict');
const test = require('node:test');

const { chooseAnalysisPlan } = require('../src/services/worker');

test('user provider credentials are ignored when app-owned AI is not configured', async () => {
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

  await assert.rejects(() => chooseAnalysisPlan({
    store,
    userId: 'user-1',
    item: { contentType: 'reel' },
    credentialEncryptionKey: 'dev-key',
  }), /IScraper AI processing is not configured/);
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
