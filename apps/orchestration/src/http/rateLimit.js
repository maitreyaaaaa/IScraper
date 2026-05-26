const { contextForRequest } = require('../services/observability');

const rateBuckets = new Map();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function createRateLimiter({ windowMs, max, name, namespace = 'app' }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${namespace}:${name}:${clientIp(req)}`;
    const current = rateBuckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    rateBuckets.set(key, bucket);

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

    if (rateBuckets.size > 5000) {
      for (const [bucketKey, value] of rateBuckets.entries()) {
        if (value.resetAt <= now) rateBuckets.delete(bucketKey);
      }
    }
    return next();
  };
}

module.exports = {
  clientIp,
  createRateLimiter,
};
