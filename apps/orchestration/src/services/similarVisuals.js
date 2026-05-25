const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'around',
  'because',
  'been',
  'being',
  'can',
  'could',
  'from',
  'has',
  'have',
  'her',
  'his',
  'into',
  'its',
  'just',
  'like',
  'more',
  'not',
  'one',
  'only',
  'over',
  'post',
  'save',
  'saved',
  'that',
  'the',
  'their',
  'there',
  'this',
  'through',
  'with',
  'you',
  'your',
]);

const VISUAL_FIELDS = [
  'visualDescription',
  'ocrText',
  'summary',
  'title',
];

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeToken(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

function tokenizeText(value = '') {
  return unique(cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

function fieldArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function buildVisualProfile(item = {}) {
  const analysis = item.analysis || {};
  const text = [
    item.sourceTitle,
    item.sourceDescription,
    item.caption,
    ...VISUAL_FIELDS.map((field) => analysis[field]),
  ].filter(Boolean).join(' ');
  const keywords = unique([
    ...fieldArray(analysis.tags),
    ...fieldArray(analysis.topics),
    ...fieldArray(analysis.brandsMentioned),
    ...fieldArray(analysis.toolsMentioned),
    ...fieldArray(item.hashtags),
    ...fieldArray(item.collections),
  ].map((value) => cleanText(value).toLowerCase()));
  const imageAssets = (item.assets || []).filter((asset) => asset.assetType === 'image' && asset.url);

  return {
    id: item.id,
    title: cleanText(analysis.title || item.sourceTitle || item.caption),
    tokens: tokenizeText(text),
    visualTokens: tokenizeText([analysis.visualDescription, analysis.ocrText].filter(Boolean).join(' ')),
    keywords,
    platformKey: cleanText(item.platformKey || item.platform).toLowerCase(),
    contentType: cleanText(item.contentType).toLowerCase(),
    hasImage: Boolean(item.thumbnailUrl || imageAssets.length),
  };
}

function intersect(a = [], b = []) {
  const bSet = new Set(b);
  return a.filter((value) => bSet.has(value));
}

function weightedOverlap(source = [], candidate = [], weight = 1) {
  if (!source.length || !candidate.length) return { score: 0, matches: [] };
  const matches = intersect(source, candidate);
  const denominator = Math.sqrt(source.length * candidate.length) || 1;
  return {
    score: (matches.length / denominator) * weight,
    matches,
  };
}

function similarityReason({ visualMatches, keywordMatches, candidate }) {
  if (visualMatches.length) return `Similar visual details: ${visualMatches.slice(0, 3).join(', ')}`;
  if (keywordMatches.length) return `Shared topics: ${keywordMatches.slice(0, 3).join(', ')}`;
  if (candidate.hasImage) return 'Another image-based save from your library.';
  return 'Related saved item.';
}

function scoreVisualSimilarity(sourceProfile, candidateProfile) {
  const visual = weightedOverlap(sourceProfile.visualTokens, candidateProfile.visualTokens, 2.4);
  const text = weightedOverlap(sourceProfile.tokens, candidateProfile.tokens, 1.2);
  const keywords = weightedOverlap(sourceProfile.keywords, candidateProfile.keywords, 1.8);
  let score = visual.score + text.score + keywords.score;

  if (sourceProfile.hasImage && candidateProfile.hasImage) score += 0.12;
  if (sourceProfile.platformKey && sourceProfile.platformKey === candidateProfile.platformKey) score += 0.04;
  if (sourceProfile.contentType && sourceProfile.contentType === candidateProfile.contentType) score += 0.03;

  return {
    score,
    hasContentMatch: Boolean(visual.matches.length || text.matches.length || keywords.matches.length),
    reasons: [similarityReason({
      visualMatches: visual.matches,
      keywordMatches: keywords.matches,
      candidate: candidateProfile,
    })],
    matchedVisualTerms: visual.matches.slice(0, 6),
    matchedTopics: keywords.matches.slice(0, 6),
  };
}

function findSimilarVisualItems(items = [], sourceItemId, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 20));
  const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 0.16;
  const source = items.find((item) => String(item.id) === String(sourceItemId));
  if (!source) return { source: null, items: [] };

  const sourceProfile = buildVisualProfile(source);
  const results = items
    .filter((item) => String(item.id) !== String(sourceItemId))
    .map((item) => {
      const candidateProfile = buildVisualProfile(item);
      const similarity = scoreVisualSimilarity(sourceProfile, candidateProfile);
      return { item, similarity };
    })
    .filter((entry) => entry.similarity.hasContentMatch && entry.similarity.score >= threshold)
    .sort((a, b) => b.similarity.score - a.similarity.score || String(b.item.createdAt || '').localeCompare(String(a.item.createdAt || '')))
    .slice(0, limit)
    .map((entry) => ({
      item: entry.item,
      similarity: {
        score: Number(entry.similarity.score.toFixed(3)),
        reasons: entry.similarity.reasons,
        matchedVisualTerms: entry.similarity.matchedVisualTerms,
        matchedTopics: entry.similarity.matchedTopics,
      },
    }));

  return { source, items: results };
}

module.exports = {
  buildVisualProfile,
  findSimilarVisualItems,
  scoreVisualSimilarity,
};
