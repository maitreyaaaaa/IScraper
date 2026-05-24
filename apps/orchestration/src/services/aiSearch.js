function compactText(value, maxLength = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function publicResultSnippet(item, index) {
  const analysis = item.analysis || {};
  return {
    rank: index + 1,
    id: item.id,
    title: compactText(item.sourceTitle || analysis.title || item.caption || 'Saved item', 180),
    platform: item.platform || 'Web',
    url: item.url || '',
    summary: compactText(analysis.summary || item.sourceDescription || item.caption, 700),
    transcript: compactText(analysis.transcript, 700),
    ocrText: compactText(analysis.ocrText, 700),
    visualDescription: compactText(analysis.visualDescription, 500),
    topics: (analysis.topics || []).slice(0, 10),
    tags: (analysis.tags || item.hashtags || []).slice(0, 12),
    brands: (analysis.brandsMentioned || []).slice(0, 10),
    tools: (analysis.toolsMentioned || []).slice(0, 10),
    whyUseful: compactText(analysis.whyUseful, 300),
    match: item.searchMatch ? {
      terms: (item.searchMatch.matchedTerms || []).slice(0, 8),
      fields: (item.searchMatch.matchedFields || []).slice(0, 3).map((field) => ({
        label: field.label,
        snippet: compactText(field.snippet, 180),
      })),
    } : null,
  };
}

function buildDeepSeekSearchAnswerRequest({ model = 'deepseek-v4-flash', query, results }) {
  const snippets = results.map(publicResultSnippet);
  return {
    model,
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You answer search queries using only the provided saved-post snippets.',
          'Never invent posts, URLs, facts, brands, or claims not present in the snippets.',
          'Keep the answer short and useful.',
          'Ground every useful claim in saved item ids from the snippets.',
          'Return valid JSON only with this shape:',
          '{"answer":"string","citations":[{"id":"string","reason":"string","snippet":"string"}],"resultReasons":[{"id":"string","reason":"string"}],"suggestions":["string"]}',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: compactText(query, 240),
          snippets,
        }),
      },
    ],
  };
}

function parseJsonContent(content) {
  return JSON.parse(String(content || '').replace(/```json|```/g, '').trim());
}

function normalizeAiSearchAnswer(parsed = {}, results = []) {
  const resultIds = new Set(results.map((item) => item.id));
  const byId = new Map(results.map((item, index) => [item.id, publicResultSnippet(item, index)]));
  const rawCitations = Array.isArray(parsed.citations) && parsed.citations.length
    ? parsed.citations
    : parsed.resultReasons;
  const citations = Array.isArray(rawCitations)
    ? rawCitations
      .map((entry) => {
        const id = String(entry.id || '');
        const snippet = byId.get(id);
        return {
          id,
          title: compactText(snippet?.title, 160),
          url: snippet?.url || '',
          reason: compactText(entry.reason, 320),
          snippet: compactText(entry.snippet || snippet?.summary || snippet?.transcript || snippet?.ocrText || snippet?.visualDescription, 260),
        };
      })
      .filter((entry) => resultIds.has(entry.id) && (entry.reason || entry.snippet))
      .slice(0, 8)
    : [];
  return {
    answer: compactText(parsed.answer, 1800) || 'I found related saved posts, but there was not enough indexed text to write a useful answer.',
    resultReasons: Array.isArray(parsed.resultReasons)
      ? parsed.resultReasons
        .map((entry) => ({
          id: String(entry.id || ''),
          reason: compactText(entry.reason, 320),
        }))
        .filter((entry) => resultIds.has(entry.id) && entry.reason)
        .slice(0, 8)
      : [],
    citations,
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.map((entry) => compactText(entry, 120)).filter(Boolean).slice(0, 5)
      : [],
  };
}

async function createDeepSeekSearchAnswer({
  apiKey,
  model = 'deepseek-v4-flash',
  query,
  results,
  fetchImpl = fetch,
}) {
  if (!apiKey || !compactText(query) || !results?.length) return null;

  const request = buildDeepSeekSearchAnswerRequest({ model, query, results });
  const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `DeepSeek search answer failed with ${response.status}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no search answer.');
  return normalizeAiSearchAnswer(parseJsonContent(content), results);
}

module.exports = {
  buildDeepSeekSearchAnswerRequest,
  createDeepSeekSearchAnswer,
  normalizeAiSearchAnswer,
  publicResultSnippet,
};
