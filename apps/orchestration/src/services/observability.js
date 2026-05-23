const crypto = require('crypto');
const { PostHog } = require('posthog-node');

const REQUEST_ID_HEADER = 'X-Request-ID';
const CLIENT_ACTION_HEADER = 'X-IScraper-Client-Action';
const REQUEST_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,127}$/;
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const SENSITIVE_KEY_RE = /(authorization|password|secret|token|api[_-]?key|credential|signature|cookie|encrypted|imageDataUrl|body|caption|transcript|ocr|query|url|filename|path|email|ip)/i;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createObservability(config = {}) {
  const stdout = config.observabilityStdout || process.stdout;
  const level = normalizeLevel(config.logLevel || 'info');
  const posthog = createPostHog(config);
  const posthogEnabled = Boolean(posthog);
  const flushImmediate = config.posthogFlushImmediate === true;

  function shouldLog(messageLevel) {
    return LEVELS[normalizeLevel(messageLevel)] >= LEVELS[level];
  }

  function writeLog(levelName, event, properties = {}) {
    const normalizedLevel = normalizeLevel(levelName);
    const safeProperties = sanitize(properties);
    if (shouldLog(normalizedLevel)) {
      safeWrite(stdout, {
        timestamp: new Date().toISOString(),
        level: normalizedLevel,
        event,
        ...safeProperties,
      });
    }
    if (posthogEnabled && ['warn', 'error'].includes(normalizedLevel)) {
      capture('server log', {
        level: normalizedLevel,
        logEvent: event,
        ...safeProperties,
      });
    }
  }

  function capture(event, properties = {}, distinctId = properties.userId || 'server') {
    if (!posthogEnabled) return;
    safePostHog(() => {
      const payload = {
        distinctId: String(distinctId || 'server'),
        event,
        properties: sanitize(properties),
      };
      if (flushImmediate && typeof posthog.captureImmediate === 'function') return posthog.captureImmediate(payload);
      return posthog.capture(payload);
    });
  }

  function captureError(error, properties = {}, distinctId = properties.userId || 'server') {
    const safeProperties = {
      ...sanitize(properties),
      errorName: error?.name || 'Error',
      errorMessage: safeErrorMessage(error),
      errorCategory: errorCategory(error),
      statusCode: error?.statusCode || error?.status || 500,
    };
    writeLog('error', 'server error', safeProperties);
    if (!posthogEnabled) return;
    safePostHog(() => {
      if (typeof posthog.captureException === 'function') {
        return posthog.captureException(error, String(distinctId || 'server'), safeProperties);
      }
      return posthog.capture({
        distinctId: String(distinctId || 'server'),
        event: '$exception',
        properties: safeProperties,
      });
    });
  }

  async function shutdown() {
    if (!posthogEnabled || typeof posthog.shutdown !== 'function') return;
    await Promise.resolve(posthog.shutdown()).catch(() => {});
  }

  return {
    enabled: posthogEnabled,
    requestMiddleware: requestContextMiddleware,
    capture,
    captureError,
    debug: (event, properties) => writeLog('debug', event, properties),
    info: (event, properties) => writeLog('info', event, properties),
    warn: (event, properties) => writeLog('warn', event, properties),
    error: (event, properties) => writeLog('error', event, properties),
    sanitize,
    shutdown,
  };
}

function createPostHog(config = {}) {
  if (config.posthogClient) return config.posthogClient;
  const enabled = config.posthogEnabled !== false && config.posthogProjectKey;
  if (!enabled) return null;
  try {
    return new PostHog(config.posthogProjectKey, {
      host: config.posthogHost || DEFAULT_POSTHOG_HOST,
      flushAt: config.posthogFlushImmediate ? 1 : 20,
      flushInterval: config.posthogFlushImmediate ? 0 : 10000,
      enableExceptionAutocapture: false,
    });
  } catch (_error) {
    return null;
  }
}

function requestContextMiddleware(req, res, next) {
  const requestId = validRequestId(req.header(REQUEST_ID_HEADER)) || crypto.randomUUID();
  const clientAction = safeClientAction(req.header(CLIENT_ACTION_HEADER));
  const startedAt = process.hrtime.bigint();
  req.context = {
    requestId,
    clientAction,
    startedAt,
    route: null,
  };
  res.setHeader(REQUEST_ID_HEADER, requestId);
  res.on('finish', () => {
    const observability = req.app?.locals?.observability;
    if (!observability) return;
    const route = routePattern(req);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const properties = {
      requestId,
      clientAction,
      route,
      method: req.method,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: req.user?.id,
    };
    if (res.statusCode >= 500) {
      observability.capture('api request failed', properties, req.user?.id || 'server');
    }
    observability.info('api request completed', properties);
  });
  next();
}

function contextForRequest(req, extra = {}) {
  return {
    requestId: req.context?.requestId,
    clientAction: req.context?.clientAction,
    route: routePattern(req),
    method: req.method,
    userId: req.user?.id,
    ...extra,
  };
}

function routePattern(req) {
  const routePath = req.route?.path;
  if (routePath) return `${req.baseUrl || ''}${routePath}`;
  return req.path || 'unknown';
}

function validRequestId(value) {
  const candidate = String(value || '').trim();
  return REQUEST_ID_RE.test(candidate) ? candidate : '';
}

function safeClientAction(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80);
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 5) return '[redacted:depth]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: safeErrorMessage(value),
      category: errorCategory(value),
      statusCode: value.statusCode || value.status,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => sanitize(entry, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        output[key] = '[redacted]';
      } else {
        output[key] = sanitize(entry, depth + 1);
      }
    }
    return output;
  }
  if (typeof value === 'string') {
    if (value.length > 240) return `${value.slice(0, 240)}...`;
    return value;
  }
  return value;
}

function safeErrorMessage(error) {
  const message = String(error?.message || 'Unknown error');
  if (SENSITIVE_KEY_RE.test(message) || message.length > 240) return errorCategory(error);
  return message;
}

function errorCategory(error) {
  if (!error) return 'unknown_error';
  if (error.statusCode || error.status) return `http_${error.statusCode || error.status}`;
  if (error.name && error.name !== 'Error') return error.name;
  return 'server_error';
}

function normalizeLevel(value) {
  return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : 'info';
}

function safePostHog(callback) {
  try {
    const result = callback();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (_error) {
    // Observability must never break product behavior.
  }
}

function safeWrite(stdout, record) {
  try {
    stdout.write(`${JSON.stringify(record)}\n`);
  } catch (_error) {
    // Logging must never break product behavior.
  }
}

module.exports = {
  CLIENT_ACTION_HEADER,
  REQUEST_ID_HEADER,
  contextForRequest,
  createObservability,
  sanitize,
  validRequestId,
};
