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
}) {
  fs.mkdirSync(videoDir, { recursive: true });
  const processed = [];

  while (true) {
    const jobs = await store.getJobs(userId, importId);
    const job = pickNextProcessableJob(jobs);
    if (!job) break;

    const item = await store.getItem(userId, job.itemId);
    if (!item) {
      await store.updateJob(userId, job.id, {
        status: 'failed',
        attempts: (job.attempts || 0) + 1,
        error: 'Saved item not found for job.',
      });
      continue;
    }

    try {
      await store.updateJob(userId, job.id, {
        status: 'downloading',
        attempts: (job.attempts || 0) + 1,
        error: null,
      });

      const mediaPlan = await chooseMediaPlan({
        store,
        userId,
        item,
        openRouterApiKey,
        openRouterMediaModel,
        geminiApiKey,
        credentialEncryptionKey,
      });

      let mediaPaths = [];
      if (shouldDownload && item.contentType !== 'unknown') {
        try {
          const download = await downloadInstagramMedia({ url: item.url, outputDir: videoDir, id: item.id });
          mediaPaths = download.outputPaths || [];
        } catch (error) {
          mediaPaths = [];
        }
      }

      await store.updateJob(userId, job.id, { status: 'analyzing', error: null });
      if (requiresMediaAnalysis(item) && !mediaPaths.length) {
        throw new Error('Media file could not be downloaded for analysis.');
      }

      const mediaAnalysis = mediaPlan
        ? await analyzeMediaWithCredential({
            credential: mediaPlan.credential,
            mediaPaths,
            item,
          })
        : null;
      const baseAnalysis = buildTextBaseAnalysis(item, mediaAnalysis);
      const textCredential = await chooseTextCredential({
        store,
        userId,
        openRouterApiKey,
        openRouterModel,
        credentialEncryptionKey,
        source: mediaPlan?.source,
      });
      const textAnalysis = textCredential
        ? await analyzeTextWithCredential({
            credential: textCredential,
            item,
            baseAnalysis,
          })
        : null;
      const analysis = mergeAnalysis(baseAnalysis, textAnalysis);
      await store.saveAnalysis(userId, item.id, analysis);
      if (mediaPlan?.source === 'free' || mediaPlan?.source === 'paid') {
        await store.recordUsage({
          userId,
          itemId: item.id,
          source: mediaPlan.source,
          provider: mediaPlan.credential.provider,
          model: mediaPlan.credential.model,
        });
      }
      if (openRouterApiKey && typeof store.saveEmbedding === 'function') {
        try {
          const content = buildEmbeddingContent(item, analysis);
          const embedding = await createOpenRouterEmbedding({
            apiKey: openRouterApiKey,
            model: openRouterEmbeddingModel,
            input: content,
            dimensions: embeddingDimensions,
            inputType: 'search_document',
          });
          if (embedding) {
            await store.saveEmbedding(userId, item.id, {
              content,
              embedding,
              model: openRouterEmbeddingModel,
            });
          }
        } catch (error) {
          console.warn(`OpenRouter embedding failed for ${item.id}: ${error.message}`);
        }
      }
      const done = await store.updateJob(userId, job.id, { status: 'done', error: null });
      processed.push(done);
    } catch (error) {
      if (error.pauseStatus) {
        await pauseJob({ store, userId, item, job, status: error.pauseStatus, message: error.message });
        continue;
      }
      if (isProviderLimitError(error)) {
        await pauseJob({
          store,
          userId,
          item,
          job,
          status: 'paused_api_limit',
          message: 'Video did not process because your API limit was reached.',
        });
        continue;
      }
      await store.markItemFailed(userId, item.id, error.message);
      await store.updateJob(userId, job.id, {
        status: 'failed',
        attempts: (job.attempts || 0) + 1,
        error: error.message,
      });
    }
  }

  return processed;
}

function requiresMediaAnalysis(item) {
  return ['reel', 'post'].includes(item.contentType);
}

async function chooseMediaPlan({ store, userId, item, openRouterApiKey, openRouterMediaModel, geminiApiKey, credentialEncryptionKey }) {
  if (!requiresMediaAnalysis(item)) return null;
  const credits = typeof store.getCredits === 'function' ? await store.getCredits(userId) : { freeItemsRemaining: 0, paidCredits: 0 };

  if (credits.freeItemsRemaining > 0) {
    const credential = appMediaCredential({ openRouterApiKey, openRouterMediaModel, geminiApiKey });
    if (!credential) throw pauseError('paused_missing_provider', 'Video did not process because no supported image/video provider is connected.');
    return { source: 'free', credential };
  }

  const userCredential =
    typeof store.getPreferredProviderCredential === 'function' && credentialEncryptionKey
      ? await store.getPreferredProviderCredential(userId, 'media', credentialEncryptionKey)
      : null;
  if (userCredential) return { source: 'byok', credential: userCredential };

  if (credits.paidCredits > 0) {
    const credential = appMediaCredential({ openRouterApiKey, openRouterMediaModel, geminiApiKey });
    if (!credential) throw pauseError('paused_missing_provider', 'Video did not process because no supported image/video provider is connected.');
    return { source: 'paid', credential };
  }

  throw pauseError('paused_needs_billing', 'Video did not process because credits are over. Add credits or connect your own API key.');
}

async function chooseTextCredential({ store, userId, openRouterApiKey, openRouterModel, credentialEncryptionKey, source }) {
  if (source === 'free' || source === 'paid') {
    return openRouterApiKey ? { provider: 'openrouter', purpose: 'text', model: openRouterModel, apiKey: openRouterApiKey } : null;
  }
  const userCredential =
    typeof store.getPreferredProviderCredential === 'function' && credentialEncryptionKey
      ? await store.getPreferredProviderCredential(userId, 'text', credentialEncryptionKey)
      : null;
  if (userCredential) return userCredential;
  return openRouterApiKey ? { provider: 'openrouter', purpose: 'text', model: openRouterModel, apiKey: openRouterApiKey } : null;
}

function appMediaCredential({ openRouterApiKey, openRouterMediaModel, geminiApiKey }) {
  if (openRouterApiKey) {
    return { provider: 'openrouter', purpose: 'media', model: openRouterMediaModel, apiKey: openRouterApiKey };
  }
  if (geminiApiKey) {
    return { provider: 'gemini', purpose: 'media', model: 'gemini-1.5-flash', apiKey: geminiApiKey };
  }
  return null;
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
  });
}

module.exports = {
  analyzeItem,
  processImportJobs,
  requiresMediaAnalysis,
};
