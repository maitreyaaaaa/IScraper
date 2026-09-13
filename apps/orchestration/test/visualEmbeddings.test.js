const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cosineSimilarity,
  normalizeVisualEmbedding,
  visualEmbeddingFromAnalysis,
  visualEmbeddingModelFromAnalysis,
} = require('../src/services/visualEmbeddings');

test('visual embedding helpers accept finite numeric vectors only', () => {
  assert.deepEqual(normalizeVisualEmbedding([0.1, '0.2', 0.3]), [0.1, 0.2, 0.3]);
  assert.equal(normalizeVisualEmbedding([0.1, Number.NaN]), null);
  assert.equal(normalizeVisualEmbedding([]), null);
});

test('visual embedding helpers compute cosine similarity and model defaults', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [1]), 0);
  assert.deepEqual(visualEmbeddingFromAnalysis({ image_embedding: [0.4, 0.5] }), [0.4, 0.5]);
  assert.equal(visualEmbeddingModelFromAnalysis({ image_embedding_model: 'clip-vit-base' }), 'clip-vit-base');
  assert.equal(visualEmbeddingModelFromAnalysis({}), 'local-ml-visual');
});
