const DEFAULT_MAX_VISUAL_EMBEDDING_DIMENSIONS = 2048;

function normalizeVisualEmbedding(value, { maxDimensions = DEFAULT_MAX_VISUAL_EMBEDDING_DIMENSIONS } = {}) {
  if (!Array.isArray(value) || !value.length) return null;
  const vector = value
    .slice(0, Math.max(1, Number(maxDimensions) || DEFAULT_MAX_VISUAL_EMBEDDING_DIMENSIONS))
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
  return vector.length === value.length ? vector : null;
}

function visualEmbeddingFromAnalysis(analysis = {}) {
  return normalizeVisualEmbedding(
    analysis._visualEmbedding
      || analysis.visualEmbedding
      || analysis.visual_embedding
      || analysis.imageEmbedding
      || analysis.image_embedding,
  );
}

function visualEmbeddingModelFromAnalysis(analysis = {}) {
  return String(
    analysis._visualEmbeddingModel
      || analysis.visualEmbeddingModel
      || analysis.visual_embedding_model
      || analysis.imageEmbeddingModel
      || analysis.image_embedding_model
      || 'local-ml-visual',
  ).trim().slice(0, 120) || 'local-ml-visual';
}

function vectorMagnitude(vector = []) {
  return Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
}

function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  const aMagnitude = vectorMagnitude(a);
  const bMagnitude = vectorMagnitude(b);
  if (!aMagnitude || !bMagnitude) return 0;
  const dot = a.reduce((total, value, index) => total + value * b[index], 0);
  return dot / (aMagnitude * bMagnitude);
}

module.exports = {
  cosineSimilarity,
  normalizeVisualEmbedding,
  visualEmbeddingFromAnalysis,
  visualEmbeddingModelFromAnalysis,
};
