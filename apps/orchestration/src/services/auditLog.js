const crypto = require('crypto');
const { routeGroupForPath } = require('./observability');

const SENSITIVE_KEY_RE = /(secret|token|password|authorization|cookie|api[_-]?key|encrypted|hash|session|credential|auth|raw|body|email)/i;
const SAFE_IDENTIFIER_KEY_RE = /^(tokenId|credentialId|extensionTokenId|agentTokenId|connectionId|requestId|correlationId|referenceId|exportRequestId|deletionRequestId|importId|jobId)$/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKENISH_RE = /\b(?:sk|sbp|xox|ghp|gho|ghu|ghs|glpat|AIza|eyJ)[A-Za-z0-9._~+/=-]{12,}\b/g;

function sanitizeAuditMetadata(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[redacted:depth]';
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => sanitizeAuditMetadata(entry, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(key) && !SAFE_IDENTIFIER_KEY_RE.test(key)) output[key] = '[redacted]';
      else output[key] = sanitizeAuditMetadata(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string') return sanitizeAuditString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).slice(0, 120);
}

function sanitizeAuditString(value) {
  return String(value || '')
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(BEARER_RE, 'Bearer [redacted]')
    .replace(TOKENISH_RE, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function hashAuditValue(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  return crypto.createHash('sha256').update(input).digest('hex');
}

function auditContextForRequest(req, metadata = {}) {
  const route = req?.route?.path ? `${req.baseUrl || ''}${req.route.path}` : req?.path || '';
  return {
    requestId: req?.context?.requestId || '',
    correlationId: req?.context?.correlationId || req?.context?.requestId || '',
    route,
    method: req?.method || '',
    routeGroup: routeGroupForPath(route),
    ipHash: hashAuditValue(req?.ip || req?.headers?.['x-forwarded-for'] || ''),
    userAgentHash: hashAuditValue(req?.headers?.['user-agent'] || ''),
    metadata: sanitizeAuditMetadata(metadata),
  };
}

async function recordSecurityAuditForRequest(store, req, {
  eventType,
  actorType = '',
  targetUserId = '',
  severity = 'info',
  result = 'success',
  metadata = {},
} = {}) {
  if (!store || typeof store.recordSecurityAudit !== 'function') return null;
  const context = auditContextForRequest(req, metadata);
  return safeAuditWrite(store.recordSecurityAudit({
    actorUserId: req?.user?.id || null,
    actorType: actorType || (context.routeGroup === 'admin' ? 'admin' : req?.user?.id ? 'user' : 'system'),
    targetUserId: targetUserId || req?.user?.id || null,
    eventType,
    severity,
    result,
    requestId: context.requestId,
    correlationId: context.correlationId,
    route: context.route,
    method: context.method,
    ipHash: context.ipHash,
    userAgentHash: context.userAgentHash,
    metadata: context.metadata,
  }));
}

async function recordSupportEvent(store, {
  userId,
  eventType,
  metadata = {},
} = {}) {
  if (!store || typeof store.recordUserActivity !== 'function' || !userId || !eventType) return null;
  return safeAuditWrite(store.recordUserActivity({
    userId,
    eventType,
    metadata: sanitizeAuditMetadata(metadata),
  }));
}

async function safeAuditWrite(promise) {
  try {
    return await promise;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  auditContextForRequest,
  hashAuditValue,
  recordSecurityAuditForRequest,
  recordSupportEvent,
  sanitizeAuditMetadata,
  sanitizeAuditString,
};
