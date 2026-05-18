const path = require('path');
const fs = require('fs');
const { analyzeMediaWithGemini, analyzeTextMetadata, analyzeTextWithOpenRouter, mergeAnalysis } = require('./analyzer');
const { buildEmbeddingContent, createOpenRouterEmbedding } = require('./embeddings');
const { analyzeMediaWithCredential, analyzeTextWithCredential, buildTextBaseAnalysis, isProviderLimitError } = require('./providerClients');
const { pickNextProcessableJob } = require('./queue');
const { downloadInstagramMedia } = require('./downloader');
const { DEFAULT_APP_MEDIA_MODEL } = require('./providers');

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
}) {
  let currentJob = job;
  const item = await store.getItem(userId, currentJob.itemId);
  if (!item) {
    await store.updateJob(userId, currentJob.id, {
      status: 'failed',
      attempts: (currentJob.attempts || 0) + 1,
      error: 'Saved item not found for job.',
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

    await store.updateJob(userId, currentJob.id, { status: 'analyzing', error: null });
    await store.setItemStatus?.(userId, item.id, 'analyzing', null);

    const mediaAnalysis = analysisPlan.mediaCredential && mediaPaths.length
      ? await analyzeMediaWithCredential({
          credential: analysisPlan.mediaCredential,
          mediaPaths,
          item,
        })
      : null;
    const baseAnalysis = buildTextBaseAnalysis(item, mediaAnalysis);
    const textAnalysis = analysisPlan.textCredential
      ? await analyzeTextWithCredential({
          credential: analysisPlan.textCredential,
          item,
          baseAnalysis,
        })
      : null;
    const analysis = mergeAnalysis(baseAnalysis, textAnalysis);
    await store.saveAnalysis(userId, item.id, analysis);
    if (analysisPlan.source === 'free' || analysisPlan.source === 'paid') {
      await store.recordUsage({
        userId,
        itemId: item.id,
        source: analysisPlan.source,
        provider: analysisPlan.billingCredential.provider,
        model: analysisPlan.billingCredential.model,
      });
    }
    if (analysisPlan.embeddingCredential && typeof store.saveEmbedding === 'function') {
      try {
        const content = buildEmbeddingContent(item, analysis);
        const embedding = await createOpenRouterEmbedding({
          apiKey: analysisPlan.embeddingCredential.apiKey,
          model: analysisPlan.embeddingCredential.model || openRouterEmbeddingModel,
          input: content,
          dimensions: embeddingDimensions,
          inputType: 'search_document',
        });
        if (embedding) {
          await store.saveEmbedding(userId, item.id, {
            content,
            embedding,
            model: analysisPlan.embeddingCredential.model || openRouterEmbeddingModel,
          });
        }
      } catch (error) {
        console.warn(`OpenRouter embedding failed for ${item.id}: ${error.message}`);
      }
    }
    return store.updateJob(userId, currentJob.id, {
      status: 'done',
      error: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.pauseStatus) {
      await pauseJob({ store, userId, item, job: currentJob, status: error.pauseStatus, message: error.message });
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
      return null;
    }
    await store.markItemFailed(userId, item.id, error.message);
    await store.updateJob(userId, currentJob.id, {
      status: 'failed',
      attempts: currentJob.attempts || (job.attempts || 0) + 1,
      error: error.message,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorAt: new Date().toISOString(),
    });
    return null;
  }
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
    if (credits.freeItemsRemaining > 0) {
      return {
        source: 'free',
        mediaCredential: needsMedia ? appMediaCredential : null,
        textCredential: appTextCredential,
        billingCredential: appTextCredential,
        embeddingCredential: appEmbeddingCredential,
      };
    }
    if (credits.paidCredits > 0) {
      return {
        source: 'paid',
        mediaCredential: needsMedia ? appMediaCredential : null,
        textCredential: appTextCredential,
        billingCredential: appTextCredential,
        embeddingCredential: appEmbeddingCredential,
      };
    }
    throw pauseError('paused_needs_billing', 'Saved post did not process because the free indexing allowance is used up.');
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

async function pauseJob({ store, userId, item, job, status, message }) {
  if (typeof store.setItemStatus === 'function') {
    await store.setItemStatus(userId, item.id, status, message);
  } else {
    await store.markItemFailed(userId, item.id, message);
  }
  await store.updateJob(userId, job.id, {
    status,
    attempts: job.attempts || 0,
    error: message,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorAt: new Date().toISOString(),
  });
}

module.exports = {
  analyzeItem,
  chooseAnalysisPlan,
  processImportJobs,
  requiresMediaAnalysis,
};
