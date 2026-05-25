const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildVisualProfile,
  findSimilarVisualItems,
} = require('../src/services/similarVisuals');

test('buildVisualProfile extracts visual text, topics, and image presence', () => {
  const profile = buildVisualProfile({
    id: 'save-1',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    platformKey: 'instagram',
    analysis: {
      title: 'Kitchen inspiration',
      visualDescription: 'A bright green kitchen with brass lighting and marble counters.',
      topics: ['Interior design'],
      tags: ['kitchen', 'brass'],
    },
  });

  assert.equal(profile.id, 'save-1');
  assert.equal(profile.hasImage, true);
  assert.ok(profile.visualTokens.includes('kitchen'));
  assert.ok(profile.visualTokens.includes('brass'));
  assert.ok(profile.keywords.includes('interior design'));
});

test('findSimilarVisualItems ranks visually related saves above unrelated saves', () => {
  const source = {
    id: 'source',
    thumbnailUrl: 'https://example.com/source.jpg',
    platformKey: 'instagram',
    contentType: 'post',
    collections: ['Home'],
    analysis: {
      title: 'Kitchen moodboard',
      visualDescription: 'Warm kitchen shelves, brass hardware, marble island, green cabinets.',
      topics: ['interior design', 'kitchen'],
      tags: ['home', 'brass'],
    },
  };
  const related = {
    id: 'related',
    thumbnailUrl: 'https://example.com/related.jpg',
    platformKey: 'pinterest',
    contentType: 'pin',
    analysis: {
      title: 'Green cabinet idea',
      visualDescription: 'Green cabinets with brass pulls beside a marble kitchen counter.',
      topics: ['kitchen', 'interior design'],
      tags: ['brass'],
    },
  };
  const unrelated = {
    id: 'unrelated',
    thumbnailUrl: 'https://example.com/unrelated.jpg',
    platformKey: 'instagram',
    contentType: 'post',
    analysis: {
      title: 'Workout routine',
      visualDescription: 'Gym bench, dumbbells, running shoes, and a timer.',
      topics: ['fitness'],
      tags: ['training'],
    },
  };

  const result = findSimilarVisualItems([source, unrelated, related], 'source');

  assert.equal(result.source.id, 'source');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].item.id, 'related');
  assert.ok(result.items[0].similarity.score > 0.5);
  assert.match(result.items[0].similarity.reasons[0], /Similar visual details|Shared topics/);
});
