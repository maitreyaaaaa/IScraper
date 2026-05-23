const assert = require('node:assert/strict');
const test = require('node:test');

const { createObservability, sanitize, validRequestId } = require('../src/services/observability');

test('validRequestId accepts safe IDs and rejects unsafe IDs', () => {
  assert.equal(validRequestId('bug-12345678'), 'bug-12345678');
  assert.equal(validRequestId('../secret'), '');
  assert.equal(validRequestId('short'), '');
});

test('sanitize redacts sensitive fields and keeps safe metadata', () => {
  const safe = sanitize({
    requestId: 'bug-12345678',
    route: '/api/items/:id/enrich',
    userId: 'user-1',
    provider: 'openrouter',
    apiKey: 'sk-secret',
    Authorization: 'Bearer secret',
    imageDataUrl: 'data:image/png;base64,abc',
    nested: {
      query: 'private search text',
      itemId: 'item-1',
    },
  });

  assert.equal(safe.requestId, 'bug-12345678');
  assert.equal(safe.route, '/api/items/:id/enrich');
  assert.equal(safe.provider, 'openrouter');
  assert.equal(safe.apiKey, '[redacted]');
  assert.equal(safe.Authorization, '[redacted]');
  assert.equal(safe.imageDataUrl, '[redacted]');
  assert.equal(safe.nested.query, '[redacted]');
  assert.equal(safe.nested.itemId, 'item-1');
});

test('observability is a no-op when PostHog is disabled', () => {
  const writes = [];
  const observability = createObservability({
    posthogEnabled: false,
    observabilityStdout: { write: (entry) => writes.push(JSON.parse(entry)) },
  });

  assert.equal(observability.enabled, false);
  assert.doesNotThrow(() => observability.capture('event', { requestId: 'bug-12345678' }));
  observability.info('server started', { storageMode: 'local' });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].event, 'server started');
});

test('PostHog failures do not break logging or capture', () => {
  const observability = createObservability({
    posthogClient: {
      capture() {
        throw new Error('posthog unavailable');
      },
      captureException() {
        throw new Error('posthog unavailable');
      },
    },
    observabilityStdout: { write: () => {} },
  });

  assert.equal(observability.enabled, true);
  assert.doesNotThrow(() => observability.capture('workflow event', { requestId: 'bug-12345678' }));
  assert.doesNotThrow(() => observability.captureError(new Error('boom'), { requestId: 'bug-12345678' }));
});
