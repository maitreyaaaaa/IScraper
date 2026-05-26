function registerWorkerRoutes(app, deps) {
  const { http, workflows } = deps;
  const { workerRateLimit } = http.rateLimiters;
  const { workerProcessHandler } = workflows.worker;

  app.get('/api/worker/process', workerRateLimit, workerProcessHandler);
  app.post('/api/worker/process', workerRateLimit, workerProcessHandler);
  app.get('/api/worker/process-one', workerRateLimit, workerProcessHandler);
  app.post('/api/worker/process-one', workerRateLimit, workerProcessHandler);
}

module.exports = {
  registerWorkerRoutes,
};
