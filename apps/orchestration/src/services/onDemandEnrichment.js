const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { buildEmbeddingContent, createOpenRouterEmbedding } = require('./embeddings');
const {
  analyzeMediaWithCredential,
  analyzeTextWithCredential,
  buildTextBaseAnalysis,
  isProviderLimitError,
} = require('./providerClients');
const { analyzeTextMetadata, mergeAnalysis } = require('./analyzer');
const { DEFAULT_APP_MEDIA_MODEL } = require('./providers');
const { INDEXING_STAGES, isEnrichedStage } = require('./indexingStages');
const { normalizeSavedUrl } = require('./linkSaver');

const MAX_MEDIA_FETCH_BYTES = 4 * 1024 * 1024;
const MEDIA_CONTENT_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

async function enrichSavedItem({
  store,
  config,
  userId,
  itemId,
  force = false,
  allowMedia = true,
  reason = 'user-opened',
}) {
  const item = await store.getItem(userId, itemId);
  if (!item) {
    const error = new Error('Item not found.');
    error.statusCode = 404;
    throw error;
  }

  if (!force && (isEnrichedStage(item.indexingStage) || (item.indexingStage === INDEXING_STAGES.TEXT_INDEXED && item.analysis))) {
    return { item, enriched: false, skipped: true, reason: 'already-enriched' };
  }

  await markStage(store, userId, item.id, {
    indexingStage: INDEXING_STAGES.VISUAL_INDEXING,
    indexingError: null,
    lastEnrichmentRequestedAt: new Date().toISOString(),
  });

  let tempMediaPath = null;
  try {
    const plan = await chooseEnrichmentPlan({ store, config, userId, item, allowMedia });
    tempMediaPath = allowMedia && plan.mediaCredential ? await fetchThumbnailToTemp(item.thumbnailUrl) : null;
    const mediaPaths = tempMediaPath ? [tempMediaPath] : [];
    const mediaAnalysis = mediaPaths.length
      ? await analyzeMediaWithCredential({ credential: plan.mediaCredential, mediaPaths, item })
      : null;
    const baseAnalysis = buildTextBaseAnalysis(item, mediaAnalysis);
    const textAnalysis = plan.textCredential
      ? await analyzeTextWithCredential({ credential: plan.textCredential, item, baseAnalysis })
      : null;
    const analysis = mergeAnalysis(baseAnalysis, textAnalysis);

    await store.saveAnalysis(userId, item.id, analysis);
    await recordBillableUsage({ store, userId, item, plan });
    await saveSearchEmbedding({ store, userId, item, analysis, plan, config });

    const nextStage = nextStageFor({ item, mediaAnalysis, analysis });
    const updated = await markStage(store, userId, item.id, {
      indexingStage: nextStage,
      indexingError: null,
      indexedTextAt: new Date().toISOString(),
      indexedVisualAt: mediaAnalysis ? new Date().toISOString() : null,
    });
    return { item: updated, enriched: true, skipped: false, reason };
  } catch (error) {
    const fallbackAnalysis = analyzeTextMetadata({ caption: item.caption });
    await store.saveAnalysis(userId, item.id, fallbackAnalysis).catch(() => {});
    const updated = await markStage(store, userId, item.id, {
      indexingStage: INDEXING_STAGES.INDEX_FAILED,
      indexingError: friendlyEnrichmentError(error, item),
      indexedTextAt: new Date().toISOString(),
    });
    return { item: updated || item, enriched: false, skipped: false, error: friendlyEnrichmentError(error, item), reason };
  } finally {
    if (tempMediaPath) await fs.unlink(tempMediaPath).catch(() => {});
  }
}

async function enrichIntentBatch({ store, config, userId, itemIds = [] }) {
  const uniqueIds = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 3);
  const results = [];
  for (const itemId of uniqueIds) {
    results.push(await enrichSavedItem({
      store,
      config,
      userId,
      itemId,
      allowMedia: false,
      reason: 'search-intent',
    }));
  }
  return results;
}

async function chooseEnrichmentPlan({ store, config, userId, item, allowMedia }) {
  const needsMedia = allowMedia && Boolean(item.thumbnailUrl);
  const mediaUserCredential =
    needsMedia && config.credentialEncryptionKey && typeof store.getPreferredProviderCredential === 'function'
      ? await store.getPreferredProviderCredential(userId, 'media', config.credentialEncryptionKey)
      : null;
  const textUserCredential =
    config.credentialEncryptionKey && typeof store.getPreferredProviderCredential === 'function'
      ? await store.getPreferredProviderCredential(userId, 'text', config.credentialEncryptionKey)
      : null;
  const embeddingCredential =
    config.credentialEncryptionKey && typeof store.getPreferredProviderCredential === 'function'
      ? await store.getPreferredProviderCredential(userId, 'embedding', config.credentialEncryptionKey)
      : null;

  if (textUserCredential || mediaUserCredential) {
    return {
      source: 'byok',
      mediaCredential: mediaUserCredential,
      textCredential: textUserCredential,
      billingCredential: textUserCredential || mediaUserCredential,
      embeddingCredential,
    };
  }

  if (config.openRouterApiKey) {
    const credits = typeof store.getCredits === 'function' ? await store.getCredits(userId) : { freeItemsRemaining: 1, paidCredits: 0 };
    const source = credits.freeItemsRemaining > 0 ? 'free' : credits.paidCredits > 0 ? 'paid' : null;
    if (!source) throw Object.assign(new Error('The free indexing allowance is used up.'), { pauseStatus: 'paused_needs_billing' });
    return {
      source,
      mediaCredential: needsMedia ? appOpenRouterCredential({ purpose: 'media', apiKey: config.openRouterApiKey, model: config.openRouterMediaModel || DEFAULT_APP_MEDIA_MODEL }) : null,
      textCredential: appOpenRouterCredential({ purpose: 'text', apiKey: config.openRouterApiKey, model: config.openRouterModel }),
      billingCredential: appOpenRouterCredential({ purpose: 'text', apiKey: config.openRouterApiKey, model: config.openRouterModel }),
      embeddingCredential: appOpenRouterCredential({ purpose: 'embedding', apiKey: config.openRouterApiKey, model: config.openRouterEmbeddingModel }),
    };
  }

  return {
    source: 'metadata',
    mediaCredential: null,
    textCredential: null,
    billingCredential: null,
    embeddingCredential: null,
  };
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

async function recordBillableUsage({ store, userId, item, plan }) {
  if (!['free', 'paid'].includes(plan.source) || !plan.billingCredential || typeof store.recordUsage !== 'function') return;
  await store.recordUsage({
    userId,
    itemId: item.id,
    source: plan.source,
    provider: plan.billingCredential.provider,
    model: plan.billingCredential.model,
  });
}

async function saveSearchEmbedding({ store, userId, item, analysis, plan, config }) {
  if (!plan.embeddingCredential || typeof store.saveEmbedding !== 'function') return;
  const content = buildEmbeddingContent(item, analysis);
  const embedding = await createOpenRouterEmbedding({
    apiKey: plan.embeddingCredential.apiKey,
    model: plan.embeddingCredential.model || config.openRouterEmbeddingModel,
    input: content,
    dimensions: config.embeddingDimensions,
    inputType: 'search_document',
  });
  if (embedding) {
    await store.saveEmbedding(userId, item.id, {
      content,
      embedding,
      model: plan.embeddingCredential.model || config.openRouterEmbeddingModel,
    });
  }
}

function nextStageFor({ item, mediaAnalysis, analysis }) {
  if (item.contentType === 'reel' && (analysis.transcript || analysis.ocrText || mediaAnalysis)) return INDEXING_STAGES.DEEP_INDEXED;
  if (mediaAnalysis) return INDEXING_STAGES.VISUAL_INDEXED;
  return INDEXING_STAGES.TEXT_INDEXED;
}

async function markStage(store, userId, itemId, patch) {
  if (typeof store.updateSavedItem !== 'function') return store.getItem(userId, itemId);
  return store.updateSavedItem(userId, itemId, patch);
}

async function fetchThumbnailToTemp(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  const safeUrl = normalizeSavedUrl(thumbnailUrl);
  const response = await fetch(safeUrl);
  if (!response.ok) throw new Error(`Thumbnail fetch failed with ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const extension = MEDIA_CONTENT_TYPES[contentType];
  if (!extension) throw new Error('Thumbnail is not a supported image type.');
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_MEDIA_FETCH_BYTES) throw new Error('Thumbnail is too large for Vercel-safe enrichment.');
  const tempPath = path.join(os.tmpdir(), `iscraper-enrich-${crypto.randomUUID()}${extension}`);
  await fs.writeFile(tempPath, Buffer.from(arrayBuffer));
  return tempPath;
}

function friendlyEnrichmentError(error, item) {
  if (isProviderLimitError(error)) return 'Provider limit reached. The save remains searchable from metadata.';
  if (item.contentType === 'reel') return `${error.message || 'Reel media could not be enriched.'} The reel remains searchable from captions and tags.`;
  return `${error.message || 'Media could not be enriched.'} The save remains searchable from metadata.`;
}

module.exports = {
  enrichIntentBatch,
  enrichSavedItem,
};
