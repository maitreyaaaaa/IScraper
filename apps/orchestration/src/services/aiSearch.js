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

const OPENAI_CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';

function openAiHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function buildOpenRouterSearchAnswerRequest({ model = DEFAULT_OPENAI_MODEL, query, results }) {
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
          'Write a concise 30-50 word answer when possible.',
          'Recommend the best matching saved item for the user use case and explain why it fits.',
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
  model = DEFAULT_OPENAI_MODEL,
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

function buildOpenAiWebSearchRequest({
  model = DEFAULT_OPENAI_MODEL,
  question,
  results = [],
  messages = [],
  toolType = 'web_search_preview',
}) {
  return {
    model,
    tools: [{ type: toolType }],
    tool_choice: 'auto',
    max_output_tokens: 1200,
    input: [
      {
        role: 'system',
        content: [
          'You are IScraper web search.',
          'Answer using live web search and the provided saved-library snippets.',
          'Search the web for current or external facts when useful.',
          'Mention when a useful saved item also relates to the answer.',
          'Keep the answer direct, practical, and non-technical.',
          'Do not invent saved items or URLs.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: compactText(question, 240),
          conversation: compactConversation(messages),
          savedLibrarySnippets: results.map(publicResultSnippet),
        }),
      },
    ],
  };
}

function buildPlainTextRetryRequest(request) {
  return {
    ...request,
    response_format: undefined,
    max_tokens: Math.max(request.max_tokens || 900, 1200),
    messages: request.messages.map((message, index) => index === 0
      ? {
          ...message,
          content: `${message.content} If JSON mode is unavailable, write a concise plain-text answer using only the snippets.`,
        }
      : message),
  };
}

async function fetchOpenAiChat({ apiKey, request, fetchImpl }) {
  const response = await fetchImpl(OPENAI_CHAT_ENDPOINT, {
    method: 'POST',
    headers: openAiHeaders(apiKey),
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function fetchOpenAiResponses({ apiKey, request, fetchImpl }) {
  const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: openAiHeaders(apiKey),
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function openAiApiError(body, fallback, statusCode = 500) {
  const error = new Error(body?.error?.message || fallback);
  error.statusCode = statusCode;
  return error;
}

function parseJsonContent(content) {
  const text = String(content || '').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      const repaired = text
        .slice(objectStart, objectEnd + 1)
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(repaired);
    }
    throw new Error('OpenRouter returned an answer that was not valid JSON.');
  }
}

function plainTextAiSearchAnswer(content, results = []) {
  const answer = compactText(content, 1800);
  if (!answer) return null;
  const citations = results
    .slice(0, 3)
    .map((item, index) => {
      const snippet = publicResultSnippet(item, index);
      return {
        id: snippet.id,
        title: compactText(snippet.title, 160),
        url: snippet.url || '',
        reason: compactText(`Matched this answer for ${snippet.title}.`, 320),
        snippet: compactText(snippet.summary || snippet.transcript || snippet.ocrText || snippet.visualDescription, 260),
      };
    })
    .filter((entry) => entry.id && (entry.reason || entry.snippet));
  return {
    answer,
    resultReasons: citations.map((entry) => ({ id: entry.id, reason: entry.reason })),
    citations,
    suggestions: [],
  };
}

function responseOutputText(body = {}) {
  if (body.output_text) return compactText(body.output_text, 2400);
  const messages = Array.isArray(body.output) ? body.output : [];
  return compactText(messages
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((content) => content.text || '')
    .filter(Boolean)
    .join('\n'), 2400);
}

function normalizeUrlCitation(annotation = {}) {
  const url = annotation.url || annotation.uri || '';
  if (!url) return null;
  return {
    url,
    title: compactText(annotation.title || annotation.url || url, 180),
    snippet: compactText(annotation.snippet || annotation.text || '', 260),
  };
}

function responseWebCitations(body = {}) {
  const citations = [];
  const seen = new Set();
  const addCitation = (entry) => {
    const normalized = normalizeUrlCitation(entry);
    if (!normalized || seen.has(normalized.url)) return;
    seen.add(normalized.url);
    citations.push(normalized);
  };

  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (Array.isArray(item.sources)) {
      item.sources.forEach(addCitation);
    }
    for (const content of Array.isArray(item.content) ? item.content : []) {
      for (const annotation of Array.isArray(content.annotations) ? content.annotations : []) {
        if (annotation.type === 'url_citation' || annotation.url || annotation.uri) addCitation(annotation);
      }
    }
  }
  return citations.slice(0, 8);
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
  model = DEFAULT_OPENAI_MODEL,
  query,
  results,
  fetchImpl = fetch,
}) {
  if (!apiKey || !compactText(query) || !results?.length) return null;

  const request = buildOpenRouterSearchAnswerRequest({ model, query, results });
  let { response, body } = await fetchOpenAiChat({ apiKey, request, fetchImpl });
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenAI search answer failed with ${response.status}`);
  }

  let content = body?.choices?.[0]?.message?.content;
  if (!content) {
    ({ response, body } = await fetchOpenAiChat({
      apiKey,
      request: buildPlainTextRetryRequest(request),
      fetchImpl,
    }));
    if (!response.ok) {
      throw new Error(body?.error?.message || `OpenAI search retry failed with ${response.status}`);
    }
    content = body?.choices?.[0]?.message?.content;
  }
  if (!content) throw new Error('OpenAI returned no search answer.');
  try {
    return normalizeAiSearchAnswer(parseJsonContent(content), results);
  } catch {
    const fallback = plainTextAiSearchAnswer(content, results);
    if (fallback) return fallback;
    throw new Error('OpenAI returned an answer that could not be parsed.');
  }
}

async function createOpenRouterLibraryChatAnswer({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  question,
  results,
  messages = [],
  fetchImpl = fetch,
}) {
  if (!apiKey || !compactText(question) || !results?.length) return null;

  const request = buildOpenRouterLibraryChatRequest({ model, question, results, messages });
  let { response, body } = await fetchOpenAiChat({ apiKey, request, fetchImpl });
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenAI library chat failed with ${response.status}`);
  }

  let content = body?.choices?.[0]?.message?.content;
  if (!content) {
    ({ response, body } = await fetchOpenAiChat({
      apiKey,
      request: buildPlainTextRetryRequest(request),
      fetchImpl,
    }));
    if (!response.ok) {
      throw new Error(body?.error?.message || `OpenAI library chat retry failed with ${response.status}`);
    }
    content = body?.choices?.[0]?.message?.content;
  }
  if (!content) throw new Error('OpenAI returned no library chat answer.');
  try {
    return normalizeAiSearchAnswer(parseJsonContent(content), results);
  } catch {
    const fallback = plainTextAiSearchAnswer(content, results);
    if (fallback) return fallback;
    throw new Error('OpenAI returned a library chat answer that could not be parsed.');
  }
}

async function createOpenAiWebSearchAnswer({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  question,
  results = [],
  messages = [],
  fetchImpl = fetch,
}) {
  if (!apiKey || !compactText(question)) return null;

  const attempt = async (toolType) => {
    const request = buildOpenAiWebSearchRequest({ model, question, results, messages, toolType });
    const { response, body } = await fetchOpenAiResponses({ apiKey, request, fetchImpl });
    if (!response.ok) {
      throw openAiApiError(body, `OpenAI web search failed with ${response.status}`, response.status);
    }
    return body;
  };

  let body;
  try {
    body = await attempt('web_search_preview');
  } catch (error) {
    if (error.statusCode && error.statusCode !== 400) throw error;
    body = await attempt('web_search');
  }

  const answer = responseOutputText(body);
  if (!answer) throw new Error('OpenAI returned no web search answer.');
  return {
    answer,
    citations: [],
    webCitations: responseWebCitations(body),
    sources: responseWebCitations(body),
    suggestions: [],
    mode: 'web',
  };
}

module.exports = {
  buildOpenAiWebSearchRequest,
  buildOpenRouterLibraryChatRequest,
  buildOpenRouterSearchAnswerRequest,
  createOpenAiWebSearchAnswer,
  createOpenRouterLibraryChatAnswer,
  createOpenRouterSearchAnswer,
  normalizeAiSearchAnswer,
  publicResultSnippet,
};
