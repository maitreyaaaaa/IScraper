const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createLocalStore } = require('../src/stores/localStore');

test('local credit account starts with 200 free item analyses', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.ensureUser('u1', 'u1@example.com');
    const credits = store.getCredits('u1');

    assert.equal(credits.freeItemsLimit, 200);
    assert.equal(credits.freeItemsUsed, 0);
    assert.equal(credits.freeItemsRemaining, 200);
    assert.equal(credits.paidCredits, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordUsage consumes one free item without touching paid credits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.ensureUser('u1', 'u1@example.com');
    store.recordUsage({
      userId: 'u1',
      itemId: 'item-1',
      source: 'free',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-pro',
    });
    const credits = store.getCredits('u1');

    assert.equal(credits.freeItemsUsed, 1);
    assert.equal(credits.freeItemsRemaining, 199);
    assert.equal(credits.paidCredits, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider credential is encrypted and listed without exposing the key', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.ensureUser('u1', 'u1@example.com');
    const saved = store.saveProviderCredential('u1', {
      provider: 'openrouter',
      purpose: 'text',
      model: 'deepseek/deepseek-v4-pro',
      apiKey: 'sk-or-test-secret',
      encryptionKey: 'dev-encryption-key',
    });
    const listed = store.listProviderCredentials('u1');
    const decrypted = store.getPreferredProviderCredential('u1', 'text', 'dev-encryption-key');

    assert.equal(saved.keyHint, 'sk-...cret');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].apiKey, undefined);
    assert.equal(listed[0].encryptedKey, undefined);
    assert.equal(decrypted.apiKey, 'sk-or-test-secret');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OpenAI-compatible credentials store normalized base URL without exposing the key', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.ensureUser('u1', 'u1@example.com');
    const saved = store.saveProviderCredential('u1', {
      provider: 'openai_compatible',
      purpose: 'text',
      model: 'provider/model',
      baseUrl: 'https://api.example.com/v1/chat/completions',
      displayName: 'Example AI',
      apiKey: 'sk-test-secret',
      encryptionKey: 'dev-encryption-key',
    });
    const listed = store.listProviderCredentials('u1');
    const decrypted = store.getPreferredProviderCredential('u1', 'text', 'dev-encryption-key');

    assert.equal(saved.baseUrl, 'https://api.example.com/v1');
    assert.equal(saved.displayName, 'Example AI');
    assert.equal(listed[0].apiKey, undefined);
    assert.equal(decrypted.apiKey, 'sk-test-secret');
    assert.equal(decrypted.baseUrl, 'https://api.example.com/v1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
