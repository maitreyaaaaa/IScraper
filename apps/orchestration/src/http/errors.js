const { contextForRequest } = require('../services/observability');
const { recordSecurityAuditForRequest, recordSupportEvent } = require('../services/auditLog');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createErrorHandler({ multer, store, warnWorkflow }) {
  return (error, req, res, _next) => {
    const uploadError = error instanceof multer.MulterError || /Upload Instagram|bookmark export/.test(error.message);
    const statusCode = error.statusCode || (uploadError ? 400 : 500);
    const properties = contextForRequest(req, { statusCode });
    if ([401, 403, 423, 429].includes(statusCode)) {
      const eventType = statusCode === 423 ? 'blocked_action_denied' : statusCode === 401 ? 'auth_failed' : 'security_event_denied';
      void recordSecurityAuditForRequest(store, req, {
        eventType,
        severity: statusCode === 423 || statusCode === 429 ? 'warning' : 'critical',
        result: 'denied',
        metadata: { statusCode, errorName: error.name || 'request_error' },
      });
      if (req.user?.id && statusCode === 423) {
        void recordSupportEvent(store, {
          userId: req.user.id,
          eventType: 'blocked_action_denied',
          metadata: { route: req.path, method: req.method, statusCode },
        });
      }
    }
    if (statusCode >= 500) {
      req.app?.locals?.observability?.captureError(error, properties, req.user?.id || 'server');
    } else {
      warnWorkflow(req, 'api request rejected', { statusCode, errorCategory: error.name || 'request_error' });
    }
    if (statusCode === 429 && Number.isFinite(Number(error.retryAfterSeconds))) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(Number(error.retryAfterSeconds)))));
    }
    res.status(statusCode).json({
      error: error.message,
      requestId: req.context?.requestId,
      correlationId: req.context?.correlationId || req.context?.requestId,
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      ...(error.deletion ? { deletion: error.deletion } : {}),
    });
  };
}

module.exports = {
  asyncRoute,
  createErrorHandler,
};
