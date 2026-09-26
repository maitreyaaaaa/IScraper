const ALLOWED_SCOPES = new Set([
  'ai_search',
  'automation_generation',
  'automation_run',
  'workflow_generation',
  'media_analysis',
  'semantic_embedding',
]);

function normalizeRateBudgetRequest({ userId, scope, minuteLimit, dailyLimit, now = Date.now() }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const minuteCap = Number(minuteLimit);
  const dailyCap = Number(dailyLimit);
  if (!userId || typeof userId !== 'string') throw new TypeError('Rate budgets require a user ID.');
  if (!ALLOWED_SCOPES.has(scope)) throw new TypeError('Unsupported rate budget scope.');
  if (!Number.isInteger(minuteCap) || minuteCap < 1 || !Number.isInteger(dailyCap) || dailyCap < 1) {
    throw new TypeError('Rate budget limits must be positive integers.');
  }
  if (!Number.isFinite(nowMs)) throw new TypeError('Rate budget time must be valid.');

  const minuteWindowStart = Math.floor(nowMs / 60_000) * 60_000;
  const dayWindowStart = Math.floor(nowMs / 86_400_000) * 86_400_000;
  return {
    userId,
    scope,
    minuteLimit: minuteCap,
    dailyLimit: dailyCap,
    nowMs,
    minuteWindowStart,
    minuteResetAt: minuteWindowStart + 60_000,
    dayWindowStart,
    dayResetAt: dayWindowStart + 86_400_000,
  };
}

function consumeRateBudgetInMemory(buckets, request) {
  const normalized = normalizeRateBudgetRequest(request);
  const key = `${normalized.userId}:${normalized.scope}`;
  const current = buckets.get(key) || {};
  const minuteCount = current.minuteWindowStart === normalized.minuteWindowStart ? current.minuteCount : 0;
  const dailyCount = current.dayWindowStart === normalized.dayWindowStart ? current.dailyCount : 0;
  const minuteExceeded = minuteCount >= normalized.minuteLimit;
  const dailyExceeded = dailyCount >= normalized.dailyLimit;
  const allowed = !minuteExceeded && !dailyExceeded;
  const nextMinuteCount = minuteCount + (allowed ? 1 : 0);
  const nextDailyCount = dailyCount + (allowed ? 1 : 0);
  buckets.set(key, {
    minuteWindowStart: normalized.minuteWindowStart,
    minuteResetAt: normalized.minuteResetAt,
    minuteCount: nextMinuteCount,
    dayWindowStart: normalized.dayWindowStart,
    dayResetAt: normalized.dayResetAt,
    dailyCount: nextDailyCount,
    resetAt: Math.max(normalized.minuteResetAt, normalized.dayResetAt),
  });

  if (buckets.size > 5000 && shouldRunCleanup(buckets, normalized.nowMs)) {
    for (const [key, value] of buckets.entries()) {
      if (value.resetAt <= normalized.nowMs) buckets.delete(key);
    }
    buckets.lastCleanupAt = normalized.nowMs;
  }

  return {
    allowed,
    retryAt: minuteExceeded && dailyExceeded
      ? new Date(Math.max(normalized.minuteResetAt, normalized.dayResetAt)).toISOString()
      : minuteExceeded
        ? new Date(normalized.minuteResetAt).toISOString()
        : dailyExceeded
          ? new Date(normalized.dayResetAt).toISOString()
          : null,
    exceeded: minuteExceeded && dailyExceeded ? 'minute_and_day' : minuteExceeded ? 'minute' : dailyExceeded ? 'day' : null,
    minuteCount: nextMinuteCount,
    dailyCount: nextDailyCount,
  };
}

function shouldRunCleanup(buckets, nowMs) {
  return !Number.isFinite(buckets.lastCleanupAt) || nowMs - buckets.lastCleanupAt >= 60_000;
}

function rateLimitError(result, message = 'Usage limit reached. Please try again later.', now = Date.now()) {
  const retryAtMs = Date.parse(result?.retryAt || '');
  const retryAfterSeconds = Number.isFinite(retryAtMs)
    ? Math.max(1, Math.ceil((retryAtMs - (now instanceof Date ? now.getTime() : Number(now))) / 1000))
    : 60;
  const error = new Error(message);
  error.name = 'RateLimitError';
  error.code = 'RATE_LIMIT_EXCEEDED';
  error.statusCode = 429;
  error.retryAt = Number.isFinite(retryAtMs) ? new Date(retryAtMs).toISOString() : null;
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

async function consumeSharedRateBudget(store, request) {
  if (typeof store?.consumeRateBudget !== 'function') {
    throw rateBudgetStoreUnavailable();
  }
  try {
    const result = await store.consumeRateBudget(request);
    if (typeof result?.allowed !== 'boolean'
      || (!result.allowed && !Number.isFinite(Date.parse(result.retryAt || '')))) {
      throw new Error('The rate budget store returned an invalid result.');
    }
    return result;
  } catch {
    throw rateBudgetStoreUnavailable();
  }
}

async function assertSharedRateBudget(store, request, message, now = request.now || new Date()) {
  const budget = await consumeSharedRateBudget(store, { ...request, now });
  if (!budget.allowed) throw rateLimitError(budget, message, now);
  return budget;
}

function assertMediaAnalysisBudget(store, config, userId, message, now = new Date()) {
  return assertSharedRateBudget(store, {
    userId,
    scope: 'media_analysis',
    minuteLimit: config.mediaAnalysisRateLimitPerMinute || 5,
    dailyLimit: config.mediaAnalysisRateLimitPerDay || 20,
    now,
  }, message, now);
}

function rateBudgetStoreUnavailable() {
  const error = new Error('Usage limits are temporarily unavailable. Please try again shortly.');
  error.name = 'RateBudgetStoreUnavailableError';
  error.code = 'RATE_BUDGET_STORE_UNAVAILABLE';
  error.statusCode = 503;
  return error;
}

module.exports = {
  consumeRateBudgetInMemory,
  consumeSharedRateBudget,
  assertSharedRateBudget,
  assertMediaAnalysisBudget,
  normalizeRateBudgetRequest,
  rateLimitError,
};
