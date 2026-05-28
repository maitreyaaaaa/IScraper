const { analyzeImageBufferWithCredential } = require('../services/providerClients');
const { withTimeout } = require('./common');

const SCREENSHOT_ANALYSIS_TIMEOUT_MS = 60 * 1000;

function createScreenshotWorkflow({ store, config }) {
  async function chooseScreenshotAnalysisPlan({ userId }) {
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

    const userCredential =
      config.credentialEncryptionKey && typeof store.getPreferredProviderCredential === 'function'
        ? await store.getPreferredProviderCredential(userId, 'media', config.credentialEncryptionKey)
        : null;
    return userCredential ? { credential: userCredential, source: 'byok' } : null;
  }

  async function analyzeExtensionScreenshot({ userId, item, file }) {
    if (typeof store.saveAnalysis !== 'function' || !file?.buffer?.length) return null;
    const plan = await chooseScreenshotAnalysisPlan({ userId });
    if (!plan?.credential) return null;

    const analysis = await withTimeout(
      analyzeImageBufferWithCredential({
        credential: plan.credential,
        imageBuffer: file.buffer,
        mimeType: file.mimetype || 'image/png',
        item,
      }),
      SCREENSHOT_ANALYSIS_TIMEOUT_MS,
      'Screenshot image analysis timed out.',
    );
    if (!analysis) return null;

    const updatedMetadata = await store.updateSavedItem?.(userId, item.id, {
      sourceDescription: analysis.summary || analysis.visualDescription || item.sourceDescription,
    });
    const saved = await store.saveAnalysis(userId, item.id, analysis);
    if (['free', 'paid'].includes(plan.source) && typeof store.recordUsage === 'function') {
      await store.recordUsage({
        userId,
        itemId: item.id,
        source: plan.source,
        provider: plan.credential.provider,
        model: plan.credential.model,
      }).catch(() => {});
    }
    return saved || updatedMetadata || await store.getItem(userId, item.id);
  }

  return {
    analyzeExtensionScreenshot,
    chooseScreenshotAnalysisPlan,
  };
}

module.exports = {
  createScreenshotWorkflow,
};
