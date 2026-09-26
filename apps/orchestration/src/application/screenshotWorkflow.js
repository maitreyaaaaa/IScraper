const { analyzeImageBufferWithCredential } = require('../services/providerClients');
const { analyzeImageBufferWithLocalMl } = require('../services/localMlExtractors');
const { assertMediaAnalysisBudget } = require('../services/rateBudgets');
const { withTimeout } = require('./common');

const SCREENSHOT_ANALYSIS_TIMEOUT_MS = 60 * 1000;

function createScreenshotWorkflow({ store, config }) {
  async function chooseScreenshotAnalysisPlan({ userId }) {
    const fallback = await choosePaidScreenshotAnalysisPlan({ userId });
    if (config.localMlEndpoint) {
      return {
        credential: {
          provider: 'local_ml',
          purpose: 'media',
          endpoint: config.localMlEndpoint,
          apiKey: config.localMlApiKey || '',
        },
        fallbackCredential: fallback?.credential || null,
        fallbackSource: fallback?.source || null,
        source: null,
      };
    }

    return fallback;
  }

  async function choosePaidScreenshotAnalysisPlan({ userId }) {
    if (config.openAiApiKey) {
      const appCredential = {
        id: 'app-openai-screenshot-media',
        provider: 'openai',
        purpose: 'media',
        model: config.openAiMediaModel || config.openAiModel || 'gpt-4o',
        apiKey: config.openAiApiKey,
      };

      if (typeof store.getCredits !== 'function') return { credential: appCredential, source: null };
      const credits = await store.getCredits(userId);
      if (credits.paidCredits > 0) return { credential: appCredential, source: 'paid' };
    }

    return null;
  }

  async function prepareScreenshotAnalysis({ userId }) {
    const plan = await chooseScreenshotAnalysisPlan({ userId });
    if (plan?.credential) {
      await assertMediaAnalysisBudget(store, config, userId, 'Screenshot analysis limit reached. Please try again later.');
    }
    return plan;
  }

  async function analyzeExtensionScreenshot({ userId, item, file, plan: suppliedPlan = null }) {
    if (typeof store.saveAnalysis !== 'function' || !file?.buffer?.length) return null;
    const plan = suppliedPlan || await prepareScreenshotAnalysis({ userId });
    if (!plan?.credential) return null;

    const { analysis, source, credential } = await runScreenshotAnalysis({ plan, item, file });
    if (!analysis) return null;
    const analysisWithMetadata = credential.provider === 'local_ml'
      ? { ...analysis, _processingLevel: 'ml' }
      : { ...analysis, _processingLevel: 'ai_enriched' };

    const updatedMetadata = await store.updateSavedItem?.(userId, item.id, {
      sourceDescription: analysisWithMetadata.summary || analysisWithMetadata.visualDescription || item.sourceDescription,
    });
    const saved = await store.saveAnalysis(userId, item.id, analysisWithMetadata);
    if (['free', 'paid'].includes(source) && typeof store.recordUsage === 'function') {
      await Promise.resolve(store.recordUsage({
        userId,
        itemId: item.id,
        source,
        provider: credential.provider,
        model: credential.model,
      })).catch(() => {});
    }
    return saved || updatedMetadata || await store.getItem(userId, item.id);
  }

  async function runScreenshotAnalysis({ plan, item, file }) {
    if (plan.credential.provider === 'local_ml') {
      const localAnalysis = await analyzeImageBufferWithLocalMl({
        endpoint: plan.credential.endpoint,
        apiKey: plan.credential.apiKey,
        imageBuffer: file.buffer,
        mimeType: file.mimetype || 'image/png',
        item,
        timeoutMs: config.localMlTimeoutMs,
      }).catch(() => null);
      if (localAnalysis) {
        return {
          analysis: localAnalysis,
          credential: plan.credential,
          source: plan.source,
        };
      }
      if (!plan.fallbackCredential) return { analysis: null, credential: plan.credential, source: plan.source };
      const fallbackAnalysis = await runPaidScreenshotAnalysis({ credential: plan.fallbackCredential, item, file });
      return {
        analysis: fallbackAnalysis,
        credential: plan.fallbackCredential,
        source: plan.fallbackSource,
      };
    }

    return {
      analysis: await runPaidScreenshotAnalysis({ credential: plan.credential, item, file }),
      credential: plan.credential,
      source: plan.source,
    };
  }

  async function runPaidScreenshotAnalysis({ credential, item, file }) {
    return withTimeout(
      analyzeImageBufferWithCredential({
        credential,
        imageBuffer: file.buffer,
        mimeType: file.mimetype || 'image/png',
        item,
      }),
      SCREENSHOT_ANALYSIS_TIMEOUT_MS,
      'Screenshot image analysis timed out.',
    );
  }

  return {
    prepareScreenshotAnalysis,
    analyzeExtensionScreenshot,
    chooseScreenshotAnalysisPlan,
  };
}

module.exports = {
  createScreenshotWorkflow,
};
