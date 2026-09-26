const assert = require('node:assert/strict');
const test = require('node:test');
const { createLocalStore } = require('../src/stores/localStore');
const { consumeSharedRateBudget } = require('../src/services/rateBudgets');

test('in-memory rate budget shares account limits and resets fixed UTC windows', async () => {
  const store = createLocalStore({ dataPath: 'unused-rate-budget-test-path' });
  const firstWindow = new Date('2026-09-26T12:59:20.000Z');
  const request = { userId: 'user-a', scope: 'automation_generation', minuteLimit: 2, dailyLimit: 3, now: firstWindow };

  assert.equal((await store.consumeRateBudget(request)).allowed, true);
  assert.equal((await store.consumeRateBudget(request)).allowed, true);
  const minuteLimited = await store.consumeRateBudget(request);
  assert.equal(minuteLimited.allowed, false);
  assert.equal(minuteLimited.exceeded, 'minute');
  assert.equal(minuteLimited.dailyCount, 2, 'denied attempts do not consume daily quota');
  assert.equal(minuteLimited.retryAt, '2026-09-26T13:00:00.000Z');

  assert.equal((await store.consumeRateBudget({ ...request, userId: 'user-b' })).allowed, true);
  assert.equal((await store.consumeRateBudget({ ...request, scope: 'automation_run' })).allowed, true);
  assert.equal((await store.consumeRateBudget({ ...request, scope: 'workflow_generation' })).allowed, true);
  assert.equal((await store.consumeRateBudget({ ...request, scope: 'media_analysis' })).allowed, true);
  assert.equal((await store.consumeRateBudget({ ...request, scope: 'semantic_embedding' })).allowed, true);

  const nextMinute = await store.consumeRateBudget({ ...request, now: new Date('2026-09-26T13:00:01.000Z') });
  assert.equal(nextMinute.allowed, true);
  assert.equal(nextMinute.dailyCount, 3);
  const dayLimited = await store.consumeRateBudget({ ...request, now: new Date('2026-09-26T13:00:02.000Z') });
  assert.equal(dayLimited.allowed, false);
  assert.equal(dayLimited.exceeded, 'day');
  assert.equal(dayLimited.retryAt, '2026-09-27T00:00:00.000Z');
  assert.equal((await store.consumeRateBudget({ ...request, now: new Date('2026-09-27T00:00:01.000Z') })).allowed, true);
});

test('in-memory rate budget enforces concurrent requests atomically per scope', async () => {
  const store = createLocalStore({ dataPath: 'unused-concurrency-test-path' });
  const now = new Date('2026-09-26T12:30:00.000Z');
  const results = await Promise.all(Array.from({ length: 100 }, () => store.consumeRateBudget({
    userId: 'user-a', scope: 'ai_search', minuteLimit: 1000, dailyLimit: 20, now,
  })));
  assert.equal(results.filter((result) => result.allowed).length, 20);
  assert.equal(results.filter((result) => result.exceeded === 'day').length, 80);
});

test('missing shared budget storage fails closed', async () => {
  await assert.rejects(
    () => consumeSharedRateBudget({}, {
      userId: 'user-a', scope: 'ai_search', minuteLimit: 60, dailyLimit: 1000,
    }),
    (error) => error.statusCode === 503 && error.code === 'RATE_BUDGET_STORE_UNAVAILABLE',
  );
});
