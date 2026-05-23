const assert = require('node:assert/strict');
const test = require('node:test');

const { decryptSecret, encryptSecret, maskSecret } = require('../src/services/credentials');

test('encryptSecret stores API keys encrypted and decrypts them with the same key', () => {
  const encrypted = encryptSecret('sk-test-secret-value', 'dev-encryption-key');

  assert.notEqual(encrypted, 'sk-test-secret-value');
  assert.doesNotMatch(encrypted, /sk-test-secret-value/);
  assert.equal(decryptSecret(encrypted, 'dev-encryption-key'), 'sk-test-secret-value');
});

test('maskSecret returns only a safe key hint', () => {
  assert.equal(maskSecret('sk-test-secret-value'), 'sk-...alue');
  assert.equal(maskSecret('short'), 'sh...rt');
});
