const assert = require('node:assert/strict');
const test = require('node:test');

const { createInMemoryRateLimitStore, createRateLimiter } = require('../src/http/rateLimit');

function runLimiter(limiter, req = {}) {
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        resolve(this);
      },
    };
    limiter({
      headers: {},
      ip: '127.0.0.1',
      socket: {},
      app: { locals: {} },
      ...req,
    }, response, () => resolve(response));
  });
}

test('in-memory rate limiter store preserves current fail-closed throttling behavior', async () => {
  const store = createInMemoryRateLimitStore();
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    name: 'test',
    namespace: 'unit',
    store,
  });

  const first = await runLimiter(limiter, { ip: '203.0.113.10' });
  const second = await runLimiter(limiter, { ip: '203.0.113.10' });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(second.body.error, 'Too many requests. Please try again later.');
  assert.ok(Number(second.headers['retry-after']) > 0);
  assert.equal(store.size(), 1);
});

test('rate limiter accepts a replaceable store boundary for future distributed limits', async () => {
  const hits = [];
  const store = {
    hit(key, windowMs, now) {
      hits.push({ key, windowMs, now });
      return { count: hits.length, resetAt: now + windowMs };
    },
  };
  const limiter = createRateLimiter({
    windowMs: 30_000,
    max: 2,
    name: 'search',
    namespace: 'adapter',
    store,
  });

  await runLimiter(limiter, { headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.1' } });
  await runLimiter(limiter, { headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.1' } });
  const limited = await runLimiter(limiter, { headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.1' } });

  assert.equal(limited.statusCode, 429);
  assert.equal(hits.length, 3);
  assert.equal(hits[0].key, 'adapter:search:198.51.100.20');
  assert.equal(hits[0].windowMs, 30_000);
});
