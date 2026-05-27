const path = require('path');
const fs = require('fs');
const { analyzeMediaWithGemini, analyzeTextMetadata, analyzeTextWithOpenRouter, mergeAnalysis } = require('./analyzer');
const { buildEmbeddingContent, createOpenRouterEmbedding } = require('./embeddings');
const { analyzeMediaWithCredential, analyzeTextWithCredential, buildTextBaseAnalysis, isProviderLimitError } = require('./providerClients');
const { DEFAULT_MAX_JOB_ATTEMPTS, nextRetryAt, pickNextProcessableJob } = require('./queue');
const { downloadInstagramMedia } = require('./downloader');
const { DEFAULT_APP_MEDIA_MODEL } = require('./providers');
const { recordSupportEvent } = require('./auditLog');

const AI_STEP_TIMEOUT_MS = 90 * 1000;

async function analyzeItem({ item, mediaPaths = [], geminiApiKey = null, openRouterApiKey = null, openRouterModel = 'deepseek/deepseek-v4-pro' }) {
  let baseAnalysis = null;
  if (mediaPaths.length && geminiApiKey) {
    try {
      const geminiAnalysis = await analyzeMediaWithGemini({ apiKey: geminiApiKey, mediaPaths, item });
      if (geminiAnalysis) baseAnalysis = { ...analyzeTextMetadata({ caption: item.caption }), ...geminiAnalysis };
    } catch (error) {
      console.warn(`Gemini media analysis failed for ${item.id}: ${error.message}`);
    }
  }

  if (!baseAnalysis) {
    baseAnalysis = analyzeTextMetadata({
    caption: item.caption,
    transcript: item.contentType === 'reel' ? item.caption : '',
    ocrText: item.contentType === 'post' ? item.caption : '',
    visualDescription: mediaPaths.length ? `Downloaded ${mediaPaths.length} media file(s) for ${item.url}` : '',
    });
  }

  if (!openRouterApiKey) return baseAnalysis;

  try {
    const llmAnalysis = await analyzeTextWithOpenRouter({
      apiKey: openRouterApiKey,
      model: openRouterModel,
      item,
      baseAnalysis,
    });
    return mergeAnalysis(baseAnalysis, llmAnalysis);
  } catch (error) {
    console.warn(`OpenRouter analysis failed for ${item.id}: ${error.message}`);
    return baseAnalysis;
  }
}

async function processImportJobs({
  store,
  userId,
  importId,
  videoDir,
  shouldDownload = true,
  geminiApiKey = null,
  openRouterApiKey = null,
  openRouterModel = 'deepseek/deepseek-v4-pro',
  openRouterMediaModel = DEFAULT_APP_MEDIA_MODEL,
  openRouterEmbeddingModel = 'openai/text-embedding-3-small',
  embeddingDimensions = 1536,
  credentialEncryptionKey = null,
  indexingConcurrency = 3,
  maxJobs = Infinity,
  leaseOwner = 'worker',
  leaseMs = 15 * 60 * 1000,
  perUserConcurrency = 1,
  maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS,
  retryBackoffMs,
  maxRetryBackoffMs,
}) {
  fs.mkdirSync(videoDir, { recursive: true });
  const processed = [];
  let attempted = 0;
  const concurrency = Math.max(1, Math.min(Number(indexingConcurrency) || 1, 5));
  const jobLimit = Number.isFinite(Number(maxJobs)) ? Math.max(1, Number(maxJobs)) : Infinity;

  while (attempted < jobLimit) {
    const batchLimit = Math.min(concurrency, jobLimit - attempted);
    const batch = typeof store.claimNextJobs === 'function'
      ? await store.claimNextJobs({
          userId,
          importId,
          limit: batchLimit,
          leaseOwner,
          leaseMs,
          perUserConcurrency,
          maxAttempts,
        })
      : pickNextProcessableJobs(await store.getJobs(userId, importId), batchLimit);
    if (!batch.length) break;

    const batchResults = await Promise.all(batch.map((job) => processOneJob({
      store,
      userId,
      job,
      alreadyClaimed: typeof store.claimNextJobs === 'function',
      videoDir,
      shouldDownload,
      openRouterApiKey,
      openRouterModel,
      openRouterMediaModel,
      openRouterEmbeddingModel,
      embeddingDimensions,
      credentialEncryptionKey,
      maxAttempts,
      retryBackoffMs,
      maxRetryBackoffMs,
    })));
    attempted += batch.length;
    processed.push(...batchResults.filter(Boolean));
  }

  return processed;
}

async function processOneJob({
  store,
  userId,
  job,
  alreadyClaimed = false,
  videoDir,
  shouldDownload,
  openRouterApiKey,
  openRouterModel,
  openRouterMediaModel,
  openRouterEmbeddingModel,
  embeddingDimensions,
  credentialEncryptionKey,
  maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS,
  retryBackoffMs,
  maxRetryBackoffMs,
}) {
  let currentJob = job;
  const item = await store.getItem(userId, currentJob.itemId);
  if (!item) {
    await store.updateJob(userId, currentJob.id, {
      status: 'failed',
      attempts: (currentJob.attempts || 0) + 1,
      error: 'Saved item not found for job.',
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    await recordSupportEvent(store, {
      userId,
      eventType: 'background_job_failed',
      metadata: jobTraceMetadata(currentJob, { errorCategory: 'missing_item' }),
    });
    return null;
  }

  try {
    if (!alreadyClaimed) {
      const nextAttempts = (currentJob.attempts || 0) + 1;
      currentJob = typeof store.claimJob === 'function'
        ? await store.claimJob(userId, currentJob.id, {
            status: 'downloading',
            attempts: nextAttempts,
            error: null,
          })
        : await store.updateJob(userId, currentJob.id, {
            status: 'downloading',
            attempts: nextAttempts,
            error: null,
          });
    }

    if (!currentJob) return null;

    await store.setItemStatus?.(userId, item.id, 'downloading', null);

    const analysisPlan = await chooseAnalysisPlan({
      store,
      userId,
      item,
      credentialEncryptionKey,
      openRouterApiKey,
      openRouterModel,
      openRouterMediaModel,
      openRouterEmbeddingModel,
    });

    let mediaPaths = [];
    if (shouldDownload && requiresMediaAnalysis(item)) {
      try {
        const download = await downloadInstagramMedia({ url: item.url, outputDir: videoDir, id: item.id });
        mediaPaths = download.outputPaths || [];
      } catch (error) {
        mediaPaths = [];
      }
    }

    currentJob = await updateCurrentJob({ store, userId, job: currentJob, patch: { status: 'analyzing', error: null } });
    if (!currentJob) return null;
    await store.setItemStatus?.(userId, item.id, 'analyzing', null);

    const mediaAnalysis = analysisPlan.mediaCredential && mediaPaths.length
      ? await withTimeout(
        analyzeMediaWithCredential({
            credential: analysisPlan.mediaCredential,
            mediaPaths,
            item,
          }),
        AI_STEP_TIMEOUT_MS,
        'Media indexing timed out.',
      )
      : null;
    const baseAnalysis = buildTextBaseAnalysis(item, mediaAnalysis);
    const textAnalysis = analysisPlan.textCredential
      ? await withTimeout(
        analyzeTextWithCredential({
            credential: analysisPlan.textCredential,
            item,
            baseAnalysis,
          }),
        AI_STEP_TIMEOUT_MS,
        'Text indexing timed out.',
      )
      : null;
    const analysis = mergeAnalysis(baseAnalysis, textAnalysis);
    if (!(await isLeaseStillOwned({ store, userId, job: currentJob }))) return null;

    let embeddingPayload = null;
    if (analysisPlan.embeddingCredential && typeof store.saveEmbedding === 'function') {
      try {
        const content = buildEmbeddingContent(item, analysis);
        const embedding = await withTimeout(
          createOpenRouterEmbedding({
            apiKey: analysisPlan.embeddingCredential.apiKey,
            model: analysisPlan.embeddingCredential.model || openRouterEmbeddingModel,
            input: content,
            dimensions: embeddingDimensions,
            inputType: 'search_document',
          }),
          AI_STEP_TIMEOUT_MS,
          'Search embedding timed out.',
        );
        if (embedding) {
          embeddingPayload = {
            content,
            embedding,
            model: analysisPlan.embeddingCredential.model || openRouterEmbeddingModel,
          };
        }
      } catch (error) {
        console.warn(`OpenRouter embedding failed for ${item.id}: ${error.message}`);
      }
    }
    if (!(await isLeaseStillOwned({ store, userId, job: currentJob }))) return null;
    await store.saveAnalysis(userId, item.id, analysis);
    if (embeddingPayload) {
      await store.saveEmbedding(userId, item.id, embeddingPayload);
    }
    if (analysisPlan.source === 'free' || analysisPlan.source === 'paid') {
      await store.recordUsage({
        userId,
        itemId: item.id,
        source: analysisPlan.source,
        provider: analysisPlan.billingCredential.provider,
        model: analysisPlan.billingCredential.model,
      });
    }
    return updateCurrentJob({ store, userId, job: currentJob, patch: {
      status: 'done',
      error: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      completedAt: new Date().toISOString(),
    } });
  } catch (error) {
    if (!(await isLeaseStillOwned({ store, userId, job: currentJob }))) return null;
    if (error.pauseStatus) {
      await pauseJob({ store, userId, item, job: currentJob, status: error.pauseStatus, message: error.message });
      await recordSupportEvent(store, {
        userId,
        eventType: 'background_job_blocked',
        metadata: jobTraceMetadata(currentJob, { status: error.pauseStatus, errorCategory: error.pauseStatus }),
      });
      return null;
    }
    if (isProviderLimitError(error)) {
      await pauseJob({
        store,
        userId,
        item,
        job: currentJob,
        status: 'paused_api_limit',
        message: 'Saved post did not process because your API limit was reached.',
      });
      await recordSupportEvent(store, {
        userId,
        eventType: 'background_job_blocked',
        metadata: jobTraceMetadata(currentJob, { status: 'paused_api_limit', errorCategory: 'provider_limit' }),
      });
      return null;
    }
    const attempts = currentJob.attempts || (job.attempts || 0) + 1;
    const exhausted = attempts >= Math.max(1, Number(maxAttempts) || DEFAULT_MAX_JOB_ATTEMPTS);
    if (exhausted) {
      await store.markItemFailed(userId, item.id, userSafeIndexingError(error));
    } else {
      await store.setItemStatus?.(userId, item.id, 'queued', 'Indexing hit a temporary problem. IScraper will retry automatically.');
    }
    await updateCurrentJob({ store, userId, job: currentJob, patch: {
      status: exhausted ? 'failed' : 'queued',
      attempts,
      error: userSafeIndexingError(error),
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: exhausted ? null : nextRetryAt({ attempts, baseMs: retryBackoffMs, maxMs: maxRetryBackoffMs }),
      lastErrorAt: new Date().toISOString(),
    } });
    await recordSupportEvent(store, {
      userId,
      eventType: exhausted ? 'background_job_failed' : 'background_job_retrying',
      metadata: jobTraceMetadata(currentJob, {
        status: exhausted ? 'failed' : 'queued',
        errorCategory: userSafeIndexingErrorCategory(error),
      }),
    });
    return null;
  }
}

function jobTraceMetadata(job, extra = {}) {
  return {
    jobId: job?.id || '',
    importId: job?.importId || '',
    requestId: job?.requestId || '',
    correlationId: job?.correlationId || job?.requestId || '',
    sourceAction: job?.sourceAction || '',
    ...extra,
  };
}

function pickNextProcessableJobs(jobs, limit) {
  const selected = [];
  const remaining = [...jobs];
  while (selected.length < limit) {
    const job = pickNextProcessableJob(remaining);
    if (!job) break;
    selected.push(job);
    remaining.splice(remaining.findIndex((entry) => entry.id === job.id), 1);
  }
  return selected;
}

function requiresMediaAnalysis(item) {
  return ['reel', 'post'].includes(item.contentType);
}

async function chooseAnalysisPlan({
  store,
  userId,
  item,
  credentialEncryptionKey,
  openRouterApiKey = null,
  openRouterModel = 'deepseek/deepseek-v4-pro',
  openRouterMediaModel = DEFAULT_APP_MEDIA_MODEL,
  openRouterEmbeddingModel = 'openai/text-embedding-3-small',
}) {
  const needsMedia = requiresMediaAnalysis(item);

  const mediaUserCredential =
    needsMedia && typeof store.getPreferredProviderCredential === 'function' && credentialEncryptionKey
      ? await store.getPreferredProviderCredential(userId, 'media', credentialEncryptionKey)
      : null;
  const textUserCredential =
    typeof store.getPreferredProviderCredential === 'function' && credentialEncryptionKey
      ? await store.getPreferredProviderCredential(userId, 'text', credentialEncryptionKey)
      : null;
  const embeddingCredential =
    typeof store.getPreferredProviderCredential === 'function' && credentialEncryptionKey
      ? await store.getPreferredProviderCredential(userId, 'embedding', credentialEncryptionKey)
      : null;

  if (mediaUserCredential || textUserCredential) {
    return {
      source: 'byok',
      mediaCredential: mediaUserCredential,
      textCredential: textUserCredential,
      billingCredential: textUserCredential,
      embeddingCredential,
    };
  }

  const appTextCredential = openRouterApiKey
    ? appOpenRouterCredential({ purpose: 'text', apiKey: openRouterApiKey, model: openRouterModel })
    : null;
  const appMediaCredential = openRouterApiKey
    ? appOpenRouterCredential({ purpose: 'media', apiKey: openRouterApiKey, model: openRouterMediaModel })
    : null;
  const appEmbeddingCredential = openRouterApiKey
    ? appOpenRouterCredential({ purpose: 'embedding', apiKey: openRouterApiKey, model: openRouterEmbeddingModel })
    : null;

  if (appTextCredential && typeof store.getCredits === 'function') {
    const credits = await store.getCredits(userId);
    if (credits.paidCredits > 0) {
      return {
        source: 'paid',
        mediaCredential: needsMedia ? appMediaCredential : null,
        textCredential: appTextCredential,
        billingCredential: appTextCredential,
        embeddingCredential: appEmbeddingCredential,
      };
    }
    throw pauseError('paused_needs_billing', 'Saved post did not process because no enrichment credits are available.');
  }

  throw pauseError('paused_missing_provider', 'Saved post did not process because no text AI provider key is connected.');
}

function appOpenRouterCredential({ purpose, apiKey, model }) {
  return {
    id: `app-openrouter-${purpose}`,
    provider: 'openrouter',
    purpose,
    model,
    apiKey,
  };
}

function pauseError(status, message) {
  const error = new Error(message);
  error.pauseStatus = status;
  return error;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function pauseJob({ store, userId, item, job, status, message }) {
  if (typeof store.setItemStatus === 'function') {
    await store.setItemStatus(userId, item.id, status, message);
  } else {
    await store.markItemFailed(userId, item.id, message);
  }
  await updateCurrentJob({ store, userId, job, patch: {
    status,
    attempts: job.attempts || 0,
    error: message,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    lastErrorAt: new Date().toISOString(),
  } });
}

async function updateCurrentJob({ store, userId, job, patch }) {
  if (job?.leaseToken && typeof store.updateClaimedJob === 'function') {
    return store.updateClaimedJob(userId, job.id, job.leaseToken, patch);
  }
  return store.updateJob(userId, job.id, patch);
}

async function isLeaseStillOwned({ store, userId, job }) {
  if (!job?.leaseToken || typeof store.getJob !== 'function') return true;
  const latest = await store.getJob(userId, job.id);
  return latest?.leaseToken === job.leaseToken;
}

function userSafeIndexingError(error) {
  const message = String(error?.message || error || 'Indexing failed.');
  if (/timeout/i.test(message)) return message;
  if (/api limit|rate limit|quota/i.test(message)) return 'Provider API limit reached while indexing this save.';
  if (/billing|credits/i.test(message)) return 'Enrichment credits are not available for this save.';
  if (/provider key|api provider|no text ai provider/i.test(message)) return 'Connect an AI provider before indexing this save.';
  return 'Indexing failed for this save. IScraper will retry if attempts remain.';
}

function userSafeIndexingErrorCategory(error) {
  const message = String(error?.message || error || '');
  if (/timeout/i.test(message)) return 'timeout';
  if (/api limit|rate limit|quota/i.test(message)) return 'provider_limit';
  if (/billing|credits/i.test(message)) return 'billing';
  if (/provider key|api provider|no text ai provider/i.test(message)) return 'missing_provider';
  return 'indexing_error';
}

module.exports = {
  analyzeItem,
  chooseAnalysisPlan,
  processImportJobs,
  requiresMediaAnalysis,
};
