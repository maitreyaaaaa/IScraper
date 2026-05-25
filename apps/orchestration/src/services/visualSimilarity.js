const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'and',
  'are',
  'because',
  'been',
  'before',
  'being',
  'between',
  'can',
  'could',
  'for',
  'from',
  'has',
  'have',
  'into',
  'its',
  'just',
  'like',
  'more',
  'over',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'this',
  'with',
  'your',
]);

const FIELD_WEIGHTS = {
  visualDescription: 7,
  ocrText: 5,
  title: 4,
  summary: 4,
  sourceDescription: 3,
  caption: 3,
  topics: 6,
  tags: 6,
  brandsMentioned: 5,
  toolsMentioned: 5,
  collections: 2,
  platform: 1,
};

function cleanText(value, maxLength = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function tokenize(value) {
  return cleanText(value, 3000)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9#]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^#+/, ''))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .slice(0, 160);
}

function addWeightedTokens(map, value, weight) {
  for (const token of tokenize(value)) {
    map.set(token, (map.get(token) || 0) + weight);
  }
}

function vectorFromParts(parts = {}) {
  const vector = new Map();
  for (const [key, weight] of Object.entries(FIELD_WEIGHTS)) {
    const value = parts[key];
    if (Array.isArray(value)) {
      addWeightedTokens(vector, value.join(' '), weight);
    } else {
      addWeightedTokens(vector, value, weight);
    }
  }
  return vector;
}

function vectorMagnitude(vector) {
  let total = 0;
  for (const weight of vector.values()) total += weight * weight;
  return Math.sqrt(total);
}

function cosineScore(a, b) {
  const aMagnitude = vectorMagnitude(a);
  const bMagnitude = vectorMagnitude(b);
  if (!aMagnitude || !bMagnitude) return 0;
  let dot = 0;
  for (const [token, weight] of a.entries()) {
    dot += weight * (b.get(token) || 0);
  }
  return dot / (aMagnitude * bMagnitude);
}

function hasVisualSurface(item = {}) {
  return Boolean(
    item.thumbnailUrl
      || (item.assets || []).some((asset) => asset.assetType === 'image' && (asset.url || asset.storagePath))
      || item.analysis?.visualDescription
      || item.analysis?.ocrText,
  );
}

function itemVisualParts(item = {}) {
  const analysis = item.analysis || {};
  return {
    visualDescription: analysis.visualDescription,
    ocrText: analysis.ocrText,
    title: analysis.title || item.sourceTitle,
    summary: analysis.summary,
    sourceDescription: item.sourceDescription,
    caption: item.caption,
    topics: analysis.topics || [],
    tags: [...(analysis.tags || []), ...(item.hashtags || [])],
    brandsMentioned: analysis.brandsMentioned || [],
    toolsMentioned: analysis.toolsMentioned || [],
    collections: item.collections || [],
    platform: item.platform || '',
  };
}

function queryPartsFromAnalysis(analysis = {}) {
  return {
    visualDescription: analysis.visualDescription,
    ocrText: analysis.ocrText,
    title: analysis.title,
    summary: analysis.summary,
    topics: analysis.topics || [],
    tags: analysis.tags || [],
    brandsMentioned: analysis.brandsMentioned || [],
    toolsMentioned: analysis.toolsMentioned || [],
  };
}

function topOverlapTokens(queryVector, itemVector, limit = 5) {
  return [...queryVector.keys()]
    .filter((token) => itemVector.has(token))
    .sort((a, b) => (queryVector.get(b) * itemVector.get(b)) - (queryVector.get(a) * itemVector.get(a)))
    .slice(0, limit);
}

function reasonForMatch(item, overlapTokens, score) {
  const parts = [];
  if (overlapTokens.length) parts.push(`Matches ${overlapTokens.slice(0, 3).join(', ')}`);
  if (item.analysis?.visualDescription) parts.push('visual notes');
  if (item.thumbnailUrl || (item.assets || []).some((asset) => asset.assetType === 'image')) parts.push('saved image');
  if (!parts.length && score > 0) parts.push('similar saved metadata');
  return parts.join(' + ') || 'Similar visual save';
}

function publicVisualSearchAnalysis(analysis = {}, query = '') {
  return {
    query: cleanText(query, 500),
    title: cleanText(analysis.title, 160),
    visualDescription: cleanText(analysis.visualDescription, 500),
    ocrText: cleanText(analysis.ocrText, 500),
    topics: (analysis.topics || []).slice(0, 12),
    tags: (analysis.tags || []).slice(0, 12),
    brandsMentioned: (analysis.brandsMentioned || []).slice(0, 10),
    toolsMentioned: (analysis.toolsMentioned || []).slice(0, 10),
  };
}

function findSimilarVisualItems(items = [], analysis = {}, { limit = 24, minScore = 0.04 } = {}) {
  const queryVector = vectorFromParts(queryPartsFromAnalysis(analysis));
  if (!queryVector.size) return [];

  return items
    .filter((item) => item.status !== 'needs_review' && hasVisualSurface(item))
    .map((item) => {
      const itemVector = vectorFromParts(itemVisualParts(item));
      const score = cosineScore(queryVector, itemVector);
      const overlapTokens = topOverlapTokens(queryVector, itemVector);
      const visualBoost = hasVisualSurface(item) ? 0.015 : 0;
      const finalScore = Math.min(1, score + visualBoost);
      return {
        ...item,
        searchMatch: {
          type: 'visual',
          score: Number(finalScore.toFixed(4)),
          matchedTerms: overlapTokens,
          matchedFields: [{
            label: 'Same vibe',
            snippet: reasonForMatch(item, overlapTokens, finalScore),
          }],
        },
      };
    })
    .filter((item) => item.searchMatch.score >= minScore)
    .sort((a, b) => b.searchMatch.score - a.searchMatch.score || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || 24, 60)));
}

module.exports = {
  findSimilarVisualItems,
  hasVisualSurface,
  publicVisualSearchAnalysis,
  queryPartsFromAnalysis,
  tokenize,
  vectorFromParts,
};
