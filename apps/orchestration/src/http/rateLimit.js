const { contextForRequest } = require('../services/observability');

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function createInMemoryRateLimitStore({ maxBuckets = 5000 } = {}) {
  const rateBuckets = new Map();

  function sweep(now) {
    for (const [bucketKey, value] of rateBuckets.entries()) {
      if (value.resetAt <= now) rateBuckets.delete(bucketKey);
    }
  }

  return {
    kind: 'in-memory',
    hit(key, windowMs, now = Date.now()) {
      const current = rateBuckets.get(key);
      const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
      bucket.count += 1;
      rateBuckets.set(key, bucket);

      if (rateBuckets.size > maxBuckets) sweep(now);

      return {
        count: bucket.count,
        resetAt: bucket.resetAt,
      };
    },
    size() {
      return rateBuckets.size;
    },
    clear() {
      rateBuckets.clear();
    },
  };
}

const defaultRateLimitStore = createInMemoryRateLimitStore();

function createRateLimiter({
  windowMs,
  max,
  name,
  namespace = 'app',
  store = defaultRateLimitStore,
}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${namespace}:${name}:${clientIp(req)}`;
    const bucket = store.hit(key, windowMs, now);

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      req.app?.locals?.observability?.warn('rate limit exceeded', contextForRequest(req, {
        limiter: name,
        windowMs,
        max,
      }));
      req.app?.locals?.observability?.capture('rate limit exceeded', contextForRequest(req, {
        limiter: name,
        windowMs,
        max,
        statusCode: 429,
      }), req.user?.id || 'server');
      return res.status(429).json({ error: 'Too many requests. Please try again later.', requestId: req.context?.requestId });
    }

    return next();
  };
}

module.exports = {
  clientIp,
  createInMemoryRateLimitStore,
  createRateLimiter,
};
