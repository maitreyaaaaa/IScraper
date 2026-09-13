function checkWorkerPreflight(config = {}) {
  const errors = [];
  const warnings = [];
  const storageMode = config.storageMode || 'local';

  if (storageMode !== 'supabase') {
    errors.push('STORAGE_MODE must be supabase for production worker mode.');
  }

  if (!config.supabaseUrl) {
    errors.push('SUPABASE_URL is required for production worker mode.');
  }

  if (!config.supabaseServiceRoleKey) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is required for production worker mode.');
  }

  if (!config.openAiApiKey) {
    warnings.push('OPENAI_API_KEY is not configured; worker will run basic indexing only.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function shouldRunWorkerPreflight(config = {}) {
  return (
    config.storageMode === 'supabase'
    || process.env.NODE_ENV === 'production'
    || process.env.WORKER_PREFLIGHT === 'true'
  );
}

function assertWorkerPreflight(config = {}) {
  const result = checkWorkerPreflight(config);
  if (!result.ok) {
    const error = new Error('Worker preflight failed.');
    error.name = 'WorkerPreflightError';
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = {
  assertWorkerPreflight,
  checkWorkerPreflight,
  shouldRunWorkerPreflight,
};
