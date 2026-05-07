const path = require('path');
const fs = require('fs');
const { analyzeMediaWithGemini, analyzeTextMetadata, analyzeTextWithOpenRouter, mergeAnalysis } = require('./analyzer');
const { pickNextProcessableJob } = require('./queue');
const { downloadInstagramMedia } = require('./downloader');

async function analyzeItem({ item, mediaPaths = [], geminiApiKey = null, openRouterApiKey = null, openRouterModel = 'openai/gpt-4o-mini' }) {
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
  openRouterModel = 'openai/gpt-4o-mini',
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
      const analysis = await analyzeItem({ item, mediaPaths, geminiApiKey, openRouterApiKey, openRouterModel });
      await store.saveAnalysis(userId, item.id, analysis);
      const done = await store.updateJob(userId, job.id, { status: 'done', error: null });
      processed.push(done);
    } catch (error) {
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

module.exports = {
  analyzeItem,
  processImportJobs,
};
