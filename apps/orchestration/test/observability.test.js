const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  REQUEST_ID_HEADER,
  createObservability,
  recordRequestTiming,
  routeGroupForPath,
  sanitize,
  validRequestId,
} = require('../src/services/observability');

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

test('routeGroupForPath classifies API routes for observability only', () => {
  assert.equal(routeGroupForPath('/api/admin/worker/status'), 'admin');
  assert.equal(routeGroupForPath('/api/worker/process'), 'worker');
  assert.equal(routeGroupForPath('/api/imports'), 'import');
  assert.equal(routeGroupForPath('/api/jobs/job-1'), 'import');
  assert.equal(routeGroupForPath('/api/search'), 'search');
  assert.equal(routeGroupForPath('/api/search/feedback'), 'search');
  assert.equal(routeGroupForPath('/api/extension/saves/link'), 'integration');
  assert.equal(routeGroupForPath('/api/health'), 'public');
  assert.equal(routeGroupForPath('/api/credit-packages'), 'public');
  assert.equal(routeGroupForPath('/api/items'), 'authenticated');
});

test('request middleware logs sanitized timing metadata', () => {
  const writes = [];
  const observability = createObservability({
    posthogEnabled: false,
    observabilityStdout: { write: (entry) => writes.push(JSON.parse(entry)) },
  });
  const req = {
    app: { locals: { observability } },
    baseUrl: '',
    header(name) {
      if (name === REQUEST_ID_HEADER) return 'phase6f-12345678';
      return '';
    },
    method: 'GET',
    path: '/api/items',
    route: { path: '/api/items' },
    user: { id: 'user-1' },
  };
  const res = new EventEmitter();
  res.statusCode = 200;
  res.setHeader = () => {};
  let nextCalled = false;

  observability.requestMiddleware(req, res, () => {
    nextCalled = true;
  });
  const startedAt = process.hrtime.bigint();
  recordRequestTiming(req, 'authMs', startedAt);
  res.emit('finish');

  assert.equal(nextCalled, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].event, 'api request completed');
  assert.equal(writes[0].requestId, 'phase6f-12345678');
  assert.equal(writes[0].routeGroup, 'authenticated');
  assert.equal(writes[0].method, 'GET');
  assert.equal(writes[0].statusCode, 200);
  assert.equal(typeof writes[0].durationMs, 'number');
  assert.equal(typeof writes[0].coldStart, 'boolean');
  assert.equal(typeof writes[0].processUptimeMs, 'number');
  assert.equal(typeof writes[0].timings.authMs, 'number');
});
