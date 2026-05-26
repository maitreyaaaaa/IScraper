const { contextForRequest } = require('../services/observability');

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function captureWorkflow(req, event, properties = {}) {
  req.app?.locals?.observability?.capture(event, contextForRequest(req, properties), req.user?.id || properties.userId || 'server');
}

function warnWorkflow(req, event, properties = {}) {
  req.app?.locals?.observability?.warn(event, contextForRequest(req, properties));
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

module.exports = {
  captureWorkflow,
  cleanText,
  warnWorkflow,
  withTimeout,
};
