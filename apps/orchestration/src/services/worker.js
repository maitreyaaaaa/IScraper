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

      const analysisPlan = await chooseAnalysisPlan({
        store,
        userId,
        item,
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

      const mediaAnalysis = analysisPlan.mediaCredential
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
        message: 'Saved post did not process because your API limit was reached.',
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

async function chooseAnalysisPlan({
  store,
  userId,
  item,
  credentialEncryptionKey,
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

  if ((needsMedia && mediaUserCredential) || (!needsMedia && textUserCredential)) {
    return {
      source: 'byok',
      mediaCredential: mediaUserCredential,
      textCredential: textUserCredential,
      billingCredential: textUserCredential,
      embeddingCredential,
    };
  }

  if (needsMedia) {
    throw pauseError('paused_missing_provider', 'Saved post did not process because no supported image/video provider key is connected.');
  }
  throw pauseError('paused_missing_provider', 'Saved post did not process because no text AI provider key is connected.');
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
