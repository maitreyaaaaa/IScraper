const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createLocalStore } = require('../src/stores/localStore');

test('local credit account starts with zero included items', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.ensureUser('u1', 'u1@example.com');
    const credits = store.getCredits('u1');

    assert.equal(credits.freeItemsLimit, 0);
    assert.equal(credits.freeItemsUsed, 0);
    assert.equal(credits.freeItemsRemaining, 0);
    assert.equal(credits.paidCredits, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordUsage consumes one paid credit for app-owned analysis', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.ensureUser('u1', 'u1@example.com');
    store.addCreditTransaction({ userId: 'u1', amount: 1, reason: 'test' });
    store.recordUsage({
      userId: 'u1',
      itemId: 'item-1',
      source: 'paid',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-pro',
    });
    const credits = store.getCredits('u1');

    assert.equal(credits.freeItemsUsed, 0);
    assert.equal(credits.freeItemsRemaining, 0);
    assert.equal(credits.paidCredits, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

