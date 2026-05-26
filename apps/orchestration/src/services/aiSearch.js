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

const OPENROUTER_CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-pro';

function appReferer() {
  return process.env.APP_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173';
}

function openRouterHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': appReferer(),
    'X-Title': 'IScraper',
  };
}

function buildOpenRouterSearchAnswerRequest({ model = DEFAULT_OPENROUTER_MODEL, query, results }) {
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

function compactConversation(messages = []) {
  return messages
    .filter((message) => ['user', 'assistant'].includes(message?.role) && compactText(message?.content || message?.text, 1200))
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: compactText(message.content || message.text, 1200),
    }));
}

function buildOpenRouterLibraryChatRequest({
  model = DEFAULT_OPENROUTER_MODEL,
  question,
  results,
  messages = [],
}) {
  const snippets = results.map(publicResultSnippet);
  return {
    model,
    temperature: 0.2,
    max_tokens: 1100,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You are the user-facing IScraper library assistant.',
          'Answer follow-up questions using only the provided saved-library snippets.',
          'Use the conversation only to understand context, never as factual evidence.',
          'Never invent saved items, URLs, facts, brands, or claims not present in the snippets.',
          'If the snippets do not support an answer, say that the library does not contain enough evidence.',
          'Keep answers practical, direct, and non-technical.',
          'Return valid JSON only with this shape:',
          '{"answer":"string","citations":[{"id":"string","reason":"string","snippet":"string"}],"suggestions":["string"]}',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: compactText(question, 240),
          conversation: compactConversation(messages),
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

async function createOpenRouterSearchAnswer({
  apiKey,
  model = DEFAULT_OPENROUTER_MODEL,
  query,
  results,
  fetchImpl = fetch,
}) {
  if (!apiKey || !compactText(query) || !results?.length) return null;

  const request = buildOpenRouterSearchAnswerRequest({ model, query, results });
  const response = await fetchImpl(OPENROUTER_CHAT_ENDPOINT, {
    method: 'POST',
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenRouter search answer failed with ${response.status}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no search answer.');
  return normalizeAiSearchAnswer(parseJsonContent(content), results);
}

async function createOpenRouterLibraryChatAnswer({
  apiKey,
  model = DEFAULT_OPENROUTER_MODEL,
  question,
  results,
  messages = [],
  fetchImpl = fetch,
}) {
  if (!apiKey || !compactText(question) || !results?.length) return null;

  const request = buildOpenRouterLibraryChatRequest({ model, question, results, messages });
  const response = await fetchImpl(OPENROUTER_CHAT_ENDPOINT, {
    method: 'POST',
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenRouter library chat failed with ${response.status}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no library chat answer.');
  return normalizeAiSearchAnswer(parseJsonContent(content), results);
}

module.exports = {
  buildOpenRouterLibraryChatRequest,
  buildOpenRouterSearchAnswerRequest,
  createOpenRouterLibraryChatAnswer,
  createOpenRouterSearchAnswer,
  normalizeAiSearchAnswer,
  publicResultSnippet,
};
