const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAnalysisInputHash,
  buildEmbeddingContentHash,
} = require('../src/services/contentHashes');

test('analysis input hashes are stable across unordered metadata arrays', () => {
  const first = buildAnalysisInputHash({
    id: 'save-1',
    url: 'https://example.com/post',
    platformKey: 'instagram',
    caption: '  Useful save   text ',
    hashtags: ['ml', 'search'],
    collections: ['Ideas', 'Research'],
  }, ['C:/tmp/frame-b.jpg', 'C:/tmp/frame-a.jpg']);

  const second = buildAnalysisInputHash({
    id: 'save-1',
    url: 'https://example.com/post',
    platformKey: 'instagram',
    caption: 'Useful save text',
    hashtags: ['search', 'ml'],
    collections: ['Research', 'Ideas'],
  }, ['D:/cache/frame-a.jpg', 'D:/cache/frame-b.jpg']);

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('embedding content hashes normalize whitespace', () => {
  assert.equal(
    buildEmbeddingContentHash('saved\n\nidea'),
    buildEmbeddingContentHash(' saved idea '),
  );
});
