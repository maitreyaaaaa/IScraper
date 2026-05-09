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

