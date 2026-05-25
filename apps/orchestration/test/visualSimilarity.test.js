const assert = require('node:assert/strict');
const test = require('node:test');

const {
  findSimilarVisualItems,
  hasVisualSurface,
  publicVisualSearchAnalysis,
  tokenize,
} = require('../src/services/visualSimilarity');

test('visual search ranks saved visual items from existing analysis and tags', () => {
  const items = [
    {
      id: 'ui-1',
      status: 'done',
      thumbnailUrl: 'https://example.com/ui.png',
      sourceTitle: 'Mobile checkout UI',
      sourceDescription: 'Clean product card layout',
      platform: 'Pinterest',
      collections: ['UI inspiration'],
      hashtags: ['design'],
      analysis: {
        visualDescription: 'Minimal ecommerce mobile checkout with green buttons and product cards',
        ocrText: 'Checkout',
        topics: ['ui design', 'ecommerce'],
        tags: ['mobile', 'product card'],
      },
    },
    {
      id: 'recipe-1',
      status: 'done',
      thumbnailUrl: 'https://example.com/recipe.png',
      sourceTitle: 'Pasta recipe',
      analysis: {
        visualDescription: 'Tomato pasta dish on a kitchen counter',
        topics: ['recipes'],
        tags: ['food'],
      },
    },
  ];

  const results = findSimilarVisualItems(items, {
    visualDescription: 'green ecommerce app screen with product cards and checkout button',
    topics: ['ui design', 'ecommerce'],
    tags: ['mobile'],
  });

  assert.equal(results[0].id, 'ui-1');
  assert.ok(results[0].searchMatch.score > results[1]?.searchMatch.score || results.length === 1);
  assert.equal(results[0].searchMatch.type, 'visual');
  assert.ok(results[0].searchMatch.matchedTerms.includes('checkout'));
});

test('visual search ignores private review-only and non-visual items', () => {
  const results = findSimilarVisualItems([
    {
      id: 'review-1',
      status: 'needs_review',
      thumbnailUrl: 'https://example.com/private.png',
      analysis: { visualDescription: 'blue dashboard chart' },
    },
    {
      id: 'text-1',
      status: 'done',
      sourceTitle: 'Blue dashboard note',
      analysis: { summary: 'blue dashboard chart' },
    },
  ], {
    visualDescription: 'blue dashboard chart',
  });

  assert.deepEqual(results.map((item) => item.id), []);
});

test('visual helpers keep query summaries small and tokenized', () => {
  assert.deepEqual(tokenize('The clean, clean UI for a product-card #Design!').slice(0, 4), ['clean', 'clean', 'product', 'card']);
  assert.equal(hasVisualSurface({ assets: [{ assetType: 'image', storagePath: 'u/item/a.png' }] }), true);

  const publicAnalysis = publicVisualSearchAnalysis({
    title: 'Uploaded mood board',
    visualDescription: 'x'.repeat(800),
    topics: Array.from({ length: 20 }, (_, index) => `topic-${index}`),
  }, 'same vibe search query');

  assert.equal(publicAnalysis.visualDescription.length, 500);
  assert.equal(publicAnalysis.topics.length, 12);
  assert.equal(publicAnalysis.query, 'same vibe search query');
});
