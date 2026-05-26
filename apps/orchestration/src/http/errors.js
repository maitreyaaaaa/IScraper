const { contextForRequest } = require('../services/observability');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createErrorHandler({ multer, warnWorkflow }) {
  return (error, req, res, _next) => {
    const uploadError = error instanceof multer.MulterError || /Upload Instagram|bookmark export/.test(error.message);
    const statusCode = error.statusCode || (uploadError ? 400 : 500);
    const properties = contextForRequest(req, { statusCode });
    if (statusCode >= 500) {
      req.app?.locals?.observability?.captureError(error, properties, req.user?.id || 'server');
    } else {
      warnWorkflow(req, 'api request rejected', { statusCode, errorCategory: error.name || 'request_error' });
    }
    res.status(statusCode).json({
      error: error.message,
      requestId: req.context?.requestId,
      ...(error.deletion ? { deletion: error.deletion } : {}),
    });
  };
}

module.exports = {
  asyncRoute,
  createErrorHandler,
};
