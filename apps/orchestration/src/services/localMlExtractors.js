const path = require('node:path');
const { analyzeTextMetadata, mergeAnalysis } = require('./analyzer');
const { normalizeVisualEmbedding, visualEmbeddingModelFromAnalysis } = require('./visualEmbeddings');

const DEFAULT_TIMEOUT_MS = 30 * 1000;

async function analyzeMediaWithLocalMl({
  endpoint,
  apiKey = '',
  mediaPaths = [],
  item = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const baseUrl = normalizeEndpoint(endpoint);
  if (!baseUrl || !mediaPaths.length) return null;

  const body = {
    item: publicItemContext(item),
    media: mediaPaths.map((mediaPath) => ({
      path: mediaPath,
      fileName: path.basename(String(mediaPath || '')),
      kind: mediaKind(mediaPath),
      mimeType: mediaMimeType(mediaPath),
    })),
  };

  return requestLocalMlAnalysis({
    url: `${baseUrl}/v1/media/analyze`,
    apiKey,
    body,
    timeoutMs,
    fetchImpl,
  });
}

async function analyzeImageBufferWithLocalMl({
  endpoint,
  apiKey = '',
  imageBuffer,
  mimeType = 'image/png',
  item = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const baseUrl = normalizeEndpoint(endpoint);
  if (!baseUrl || !imageBuffer?.length) return null;

  return requestLocalMlAnalysis({
    url: `${baseUrl}/v1/image/analyze`,
    apiKey,
    body: {
      item: publicItemContext(item),
      image: {
        mimeType,
        base64: Buffer.from(imageBuffer).toString('base64'),
      },
    },
    timeoutMs,
    fetchImpl,
  });
}

async function requestLocalMlAnalysis({ url, apiKey = '', body, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-local-ml-api-key'] = apiKey;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `Local extractor failed with ${response.status}`);
    return normalizeLocalMlAnalysis(payload.analysis || payload);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLocalMlAnalysis(analysis = {}) {
  const ocrText = compactText(analysis.ocrText || analysis.ocr_text, 3000);
  const transcript = compactText(analysis.transcript, 5000);
  const visualDescription = compactText(analysis.visualDescription || analysis.visual_description, 1200);
  const visualEmbedding = normalizeVisualEmbedding(
    analysis.visualEmbedding
      || analysis.visual_embedding
      || analysis.imageEmbedding
      || analysis.image_embedding,
  );
  if (!ocrText && !transcript && !visualDescription && !visualEmbedding) return null;

  const deterministic = analyzeTextMetadata({ ocrText, transcript, visualDescription });
  const normalized = mergeAnalysis(deterministic, {
    title: compactText(analysis.title, 120) || deterministic.title,
    summary: compactText(analysis.summary, 900) || deterministic.summary,
    transcript,
    ocrText,
    visualDescription,
    brandsMentioned: shortList(analysis.brandsMentioned || analysis.brands_mentioned, 12),
    toolsMentioned: shortList(analysis.toolsMentioned || analysis.tools_mentioned, 12),
    reposMentioned: shortList(analysis.reposMentioned || analysis.repos_mentioned, 8),
    peopleMentioned: shortList(analysis.peopleMentioned || analysis.people_mentioned, 8),
    topics: shortList(analysis.topics, 12),
    tags: shortList(analysis.tags, 16),
    whyUseful: compactText(analysis.whyUseful || analysis.why_useful, 420) || deterministic.whyUseful,
  });
  if (visualEmbedding) {
    normalized._visualEmbedding = visualEmbedding;
    normalized._visualEmbeddingModel = visualEmbeddingModelFromAnalysis(analysis);
  }
  return normalized;
}

function publicItemContext(item = {}) {
  return {
    id: item.id || '',
    url: item.url || '',
    contentType: item.contentType || '',
    caption: item.caption || '',
    sourceTitle: item.sourceTitle || item.title || '',
    sourceDescription: item.sourceDescription || '',
    platform: item.platform || '',
  };
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  return value ? value.replace(/\/+$/, '') : '';
}

function mediaKind(mediaPath) {
  return /\.(mp4|mov|webm|m4v)$/i.test(String(mediaPath || '')) ? 'video' : 'image';
}

function mediaMimeType(mediaPath) {
  const lower = String(mediaPath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  return 'image/jpeg';
}

function compactText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function shortList(values, maxLength) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => compactText(value, 80)).filter(Boolean))]
    .slice(0, maxLength);
}

module.exports = {
  analyzeImageBufferWithLocalMl,
  analyzeMediaWithLocalMl,
  normalizeLocalMlAnalysis,
};
