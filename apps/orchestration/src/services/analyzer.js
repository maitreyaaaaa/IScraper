const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');

const KNOWN_TECH_TERMS = [
  'Adobe',
  'Anthropic',
  'ChatGPT',
  'Claude',
  'Codex',
  'Cursor',
  'Gemini',
  'GitHub',
  'OpenAI',
  'OpenSpace',
  'Photoshop',
  'Supabase',
  'Vercel',
];

const SEARCH_CONCEPTS = {
  security: ['security', 'secure', 'soc', 'soc2', 'compliance', 'audit', 'privacy', 'control', 'controls', 'access', 'data', 'protection', 'certification', 'certifications'],
  compliance: ['compliance', 'soc', 'soc2', 'audit', 'privacy', 'control', 'controls', 'policy', 'policies', 'certification', 'certifications'],
  privacy: ['privacy', 'data', 'protection', 'security', 'compliance', 'policy', 'policies'],
  marketing: ['marketing', 'promotion', 'promotional', 'brand', 'campaign', 'growth', 'traffic', 'conversion', 'content'],
  design: ['design', 'branding', 'palette', 'layout', 'visual', 'creative', 'ui', 'ux'],
  finance: ['finance', 'money', 'revenue', 'pricing', 'investment', 'investing', 'profit', 'sales'],
  fitness: ['fitness', 'workout', 'training', 'health', 'exercise', 'gym', 'nutrition'],
};

function appReferer() {
  return process.env.APP_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstSentence(text) {
  return String(text || '').split(/\n|\. /).find(Boolean)?.trim() || 'Untitled saved item';
}

function analyzeTextMetadata({ caption = '', transcript = '', ocrText = '', visualDescription = '' }) {
  const text = [caption, transcript, ocrText, visualDescription].filter(Boolean).join('\n');
  const lower = text.toLowerCase();
  const brandsMentioned = KNOWN_TECH_TERMS.filter((term) => lower.includes(term.toLowerCase()));
  const protocolTools = lower.includes('mcp') ? ['MCP'] : [];
  const reposMentioned = unique(
    [...text.matchAll(/\b([A-Z][A-Za-z0-9-]{2,})\b/g)]
      .map((match) => match[1])
      .filter((word) => /repo|github|open|space|mcp|agent/i.test(text) && ['OpenSpace'].includes(word)),
  );
  const topics = unique([
    lower.includes('agent') ? 'AI agents' : null,
    lower.includes('memory') ? 'agent memory' : null,
    lower.includes('repo') || lower.includes('github') ? 'GitHub repositories' : null,
    lower.includes('seo') ? 'SEO' : null,
    lower.includes('prompt') ? 'prompting' : null,
    lower.includes('design') || lower.includes('photoshop') ? 'design workflow' : null,
  ]);

  return {
    title: firstSentence(text).slice(0, 90),
    summary: firstSentence(text),
    transcript,
    ocrText,
    visualDescription,
    brandsMentioned: unique(brandsMentioned),
    toolsMentioned: unique([...brandsMentioned, ...protocolTools]),
    reposMentioned,
    peopleMentioned: [],
    topics,
    tags: unique([...topics, ...brandsMentioned]),
    whyUseful: topics.length ? `Useful for ${topics.join(', ')}.` : 'Useful saved Instagram reference.',
  };
}

function analysisSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      transcript: { type: 'string' },
      ocrText: { type: 'string' },
      visualDescription: { type: 'string' },
      brandsMentioned: { type: 'array', items: { type: 'string' } },
      toolsMentioned: { type: 'array', items: { type: 'string' } },
      reposMentioned: { type: 'array', items: { type: 'string' } },
      peopleMentioned: { type: 'array', items: { type: 'string' } },
      topics: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
      whyUseful: { type: 'string' },
    },
    required: [
      'title',
      'summary',
      'transcript',
      'ocrText',
      'visualDescription',
      'brandsMentioned',
      'toolsMentioned',
      'reposMentioned',
      'peopleMentioned',
      'topics',
      'tags',
      'whyUseful',
    ],
  };
}

function buildOpenRouterAnalysisRequest({ model, item, baseAnalysis }) {
  const content = [
    'Analyze this Instagram saved item for a searchable personal knowledge base.',
    'Extract exact brands, AI tools, product names, GitHub repositories, people, topics, and tags.',
    'Keep it useful for future search. Do not invent links or repos not present in the text.',
    '',
    `URL: ${item.url || ''}`,
    `Content type: ${item.contentType || ''}`,
    `Owner: ${item.ownerName || ''} ${item.ownerUsername ? `(@${item.ownerUsername})` : ''}`,
    `Caption: ${item.caption || ''}`,
    `Transcript: ${baseAnalysis.transcript || ''}`,
    `OCR text: ${baseAnalysis.ocrText || ''}`,
    `Visual description: ${baseAnalysis.visualDescription || ''}`,
  ].join('\n');

  return {
    model,
    temperature: 0.1,
    max_tokens: 1200,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'instagram_brain_item_analysis',
        strict: true,
        schema: analysisSchema(),
      },
    },
    messages: [
      {
        role: 'system',
        content: 'You return strict JSON only. You are indexing Instagram saved content for search and deep-dive retrieval.',
      },
      { role: 'user', content },
    ],
  };
}

function parseJsonContent(content) {
  return JSON.parse(String(content || '').replace(/```json|```/g, '').trim());
}

function parseOpenRouterAnalysisResponse(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no analysis content.');
  return parseJsonContent(content);
}

async function analyzeTextWithOpenRouter({ apiKey, model, item, baseAnalysis, fetchImpl = fetch }) {
  if (!apiKey) return null;

  const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appReferer(),
      'X-Title': 'Instagram Brain',
    },
    body: JSON.stringify(buildOpenRouterAnalysisRequest({ model, item, baseAnalysis })),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenRouter request failed with ${response.status}`);
  }
  return parseOpenRouterAnalysisResponse(body);
}

function mergeAnalysis(baseAnalysis, llmAnalysis) {
  if (!llmAnalysis) return baseAnalysis;
  return {
    ...baseAnalysis,
    ...llmAnalysis,
    brandsMentioned: unique([...(baseAnalysis.brandsMentioned || []), ...(llmAnalysis.brandsMentioned || [])]),
    toolsMentioned: unique([...(baseAnalysis.toolsMentioned || []), ...(llmAnalysis.toolsMentioned || [])]),
    reposMentioned: unique([...(baseAnalysis.reposMentioned || []), ...(llmAnalysis.reposMentioned || [])]),
    peopleMentioned: unique([...(baseAnalysis.peopleMentioned || []), ...(llmAnalysis.peopleMentioned || [])]),
    topics: unique([...(baseAnalysis.topics || []), ...(llmAnalysis.topics || [])]),
    tags: unique([...(baseAnalysis.tags || []), ...(llmAnalysis.tags || [])]),
  };
}

async function analyzeMediaWithGemini({ apiKey, mediaPaths, item }) {
  if (!apiKey || !mediaPaths?.length) return null;

  const fileManager = new GoogleAIFileManager(apiKey);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const analyses = [];

  for (const [index, mediaPath] of mediaPaths.entries()) {
    const mimeType = mediaPath.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
    const upload = await fileManager.uploadFile(mediaPath, {
      mimeType,
      displayName: `${item.id}-${index + 1}`,
    });

    let file = await fileManager.getFile(upload.file.name);
    while (file.state === 'PROCESSING') {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      file = await fileManager.getFile(upload.file.name);
    }
    if (file.state === 'FAILED') {
      throw new Error('Gemini could not process the media file.');
    }

    const prompt = [
      'Analyze this Instagram saved item media part for a searchable personal knowledge base.',
      'If this is video, transcribe spoken audio. If this is image, OCR all visible text.',
      'Return strict JSON only with these keys:',
      'title, summary, transcript, ocrText, visualDescription, brandsMentioned, toolsMentioned, reposMentioned, peopleMentioned, topics, tags, whyUseful.',
      `Original caption: ${item.caption || ''}`,
    ].join('\n');

    const result = await model.generateContent([
      {
        fileData: {
          mimeType: upload.file.mimeType,
          fileUri: upload.file.uri,
        },
      },
      { text: prompt },
    ]);

    const text = result.response.text().replace(/```json|```/g, '').trim();
    analyses.push(JSON.parse(text));
  }

  return mergeAnalyses(analyses);
}

function mergeAnalyses(analyses) {
  const base = analyses[0] || {};
  return {
    ...base,
    summary: analyses.map((analysis) => analysis.summary).filter(Boolean).join('\n\n'),
    transcript: analyses.map((analysis) => analysis.transcript).filter(Boolean).join('\n\n'),
    ocrText: analyses.map((analysis) => analysis.ocrText).filter(Boolean).join('\n\n'),
    visualDescription: analyses.map((analysis) => analysis.visualDescription).filter(Boolean).join('\n\n'),
    brandsMentioned: unique(analyses.flatMap((analysis) => analysis.brandsMentioned || [])),
    toolsMentioned: unique(analyses.flatMap((analysis) => analysis.toolsMentioned || [])),
    reposMentioned: unique(analyses.flatMap((analysis) => analysis.reposMentioned || [])),
    peopleMentioned: unique(analyses.flatMap((analysis) => analysis.peopleMentioned || [])),
    topics: unique(analyses.flatMap((analysis) => analysis.topics || [])),
    tags: unique(analyses.flatMap((analysis) => analysis.tags || [])),
  };
}

function searchableFields(item) {
  const analysis = item.analysis || {};
  return [
    { key: 'title', label: 'Title', weight: 9, text: analysis.title || item.sourceTitle },
    { key: 'ocr', label: 'Words on screen', weight: 7, text: analysis.ocrText },
    { key: 'transcript', label: 'Transcript', weight: 7, text: analysis.transcript },
    { key: 'summary', label: 'Summary', weight: 5, text: analysis.summary },
    { key: 'caption', label: 'Caption', weight: 5, text: item.caption },
    { key: 'source', label: 'Source metadata', weight: 5, text: [item.platform, item.platformKey, item.sourceTitle, item.sourceAuthor, item.sourceDescription].filter(Boolean).join(' ') },
    { key: 'visual', label: 'Visual notes', weight: 4, text: analysis.visualDescription },
    { key: 'topics', label: 'Topics and tags', weight: 4, text: [...(analysis.topics || []), ...(analysis.tags || [])].join(' ') },
    { key: 'mentions', label: 'Mentioned tools and brands', weight: 4, text: [...(analysis.brandsMentioned || []), ...(analysis.toolsMentioned || [])].join(' ') },
    { key: 'peopleRepos', label: 'People and repos', weight: 3, text: [...(analysis.reposMentioned || []), ...(analysis.peopleMentioned || [])].join(' ') },
    { key: 'url', label: 'Original URL', weight: 1, text: [item.ownerName, item.ownerUsername, item.url].filter(Boolean).join(' ') },
  ];
}

function searchableText(item) {
  return searchableFields(item)
    .map((field) => field.text)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchText(value) {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

function queryGroups(query) {
  return tokenizeSearchText(query).map((term) => {
    if (SEARCH_CONCEPTS[term]) {
      return SEARCH_CONCEPTS[term];
    }
    if (term === 'repo' || term === 'github') {
      return ['repo', 'repository', 'github'];
    }
    if (term === 'skills' || term === 'skill' || term === 'agent') {
      return ['skills', 'skill', 'agent', 'mcp'];
    }
    if (term === 'memory') {
      return ['memory', 'openspace'];
    }
    return [term];
  });
}

function fieldMatchesGroup(fieldText, group) {
  const tokens = new Set(tokenizeSearchText(fieldText));
  return group.some((term) => tokens.has(term));
}

function matchedTermsForField(fieldText, group) {
  const tokens = new Set(tokenizeSearchText(fieldText));
  return group.filter((term) => tokens.has(term));
}

function haystackMatchesGroup(haystack, group) {
  const tokens = new Set(tokenizeSearchText(haystack));
  return group.some((term) => tokens.has(term));
}

function scoreItem(item, query, groups) {
  return explainSearchMatch(item, query, groups).score;
}

function compactSearchSnippet(text, terms = [], maxLength = 180) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxLength) return value;
  const lower = value.toLowerCase();
  const firstTerm = terms.find((term) => lower.includes(String(term).toLowerCase()));
  const center = firstTerm ? lower.indexOf(String(firstTerm).toLowerCase()) : 0;
  const start = Math.max(0, center - Math.floor(maxLength / 2));
  const snippet = value.slice(start, start + maxLength).trim();
  return `${start > 0 ? '...' : ''}${snippet}${start + maxLength < value.length ? '...' : ''}`;
}

function explainSearchMatch(item, query, groups = queryGroups(query)) {
  const normalizedQuery = normalizeSearchText(query);
  const haystack = searchableText(item);
  if (!groups.every((group) => haystackMatchesGroup(haystack, group))) {
    return { score: 0, matchedTerms: [], matchedFields: [], matchTypes: [] };
  }

  const matchTypes = new Set();
  const matchedTerms = new Set();
  const matchedFields = [];
  const score = searchableFields(item).reduce((total, field) => {
    const normalizedField = normalizeSearchText(field.text);
    if (!normalizedField) return total;
    const terms = unique(groups.flatMap((group) => matchedTermsForField(normalizedField, group)));
    const groupScore = terms.length ? field.weight * terms.length : 0;
    const phraseMatched = Boolean(normalizedQuery && normalizedField.includes(normalizedQuery));
    const phraseScore = phraseMatched ? field.weight * 3 : 0;
    if (terms.length || phraseMatched) {
      terms.forEach((term) => matchedTerms.add(term));
      if (terms.length) matchTypes.add('keyword');
      if (phraseMatched) matchTypes.add('phrase');
      matchedFields.push({
        key: field.key,
        label: field.label,
        terms: terms.slice(0, 8),
        snippet: compactSearchSnippet(field.text, terms.length ? terms : [normalizedQuery]),
      });
    }
    return total + groupScore + phraseScore;
  }, 0);

  return {
    score,
    matchedTerms: [...matchedTerms].slice(0, 12),
    matchedFields: matchedFields
      .sort((a, b) => {
        const aWeight = searchableFields(item).find((field) => field.key === a.key)?.weight || 0;
        const bWeight = searchableFields(item).find((field) => field.key === b.key)?.weight || 0;
        return bWeight - aWeight;
      })
      .slice(0, 4),
    matchTypes: [...matchTypes],
  };
}

function searchItems(items, query, filters = {}) {
  return searchItemsWithDetails(items, query, filters).map(({ searchMatch, ...item }) => {
    void searchMatch;
    return item;
  });
}

function searchItemsWithDetails(items, query, filters = {}) {
  const groups = queryGroups(query);
  if (!groups.length) return items;

  return items
    .map((item) => ({ item, searchMatch: explainSearchMatch(item, query, groups) }))
    .map(({ item, searchMatch }) => ({ item, score: searchMatch.score, searchMatch }))
    .filter(({ item, score }) => {
      if (!score) return false;
      if (filters.contentType && item.contentType !== filters.contentType) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.platform && item.platform !== filters.platform) return false;
      if (filters.collection && !(item.collections || []).includes(filters.collection)) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item, searchMatch }) => ({
      ...item,
      searchMatch: {
        ...searchMatch,
        matchTypes: searchMatch.matchTypes.length ? searchMatch.matchTypes : ['keyword'],
      },
    }));
}

module.exports = {
  analyzeTextMetadata,
  analyzeMediaWithGemini,
  analyzeTextWithOpenRouter,
  buildOpenRouterAnalysisRequest,
  mergeAnalysis,
  parseOpenRouterAnalysisResponse,
  explainSearchMatch,
  searchItems,
  searchItemsWithDetails,
};
