function compactText(value, maxLength = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanGeneratedText(value, maxLength = 1200) {
  let text = compactText(value, maxLength + 400)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\((?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\)/gi, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  const candidate = text.slice(0, maxLength);
  const sentenceEnd = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('! '), candidate.lastIndexOf('? '));
  text = sentenceEnd > Math.floor(maxLength * 0.6)
    ? candidate.slice(0, sentenceEnd + 1)
    : candidate.replace(/\s+\S*$/, '');
  return `${text.trim()}...`;
}

function removeIncompleteEnding(value = '') {
  const text = String(value || '').trim();
  if (!text || /[.!?)]$/.test(text)) return text;
  const sentenceEnd = Math.max(text.lastIndexOf('. '), text.lastIndexOf('! '), text.lastIndexOf('? '));
  if (sentenceEnd > 80) return text.slice(0, sentenceEnd + 1).trim();
  return `${text.replace(/\s+\S*$/, '').trim()}...`;
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

function webSearchFiltersForQuestion(question = '') {
  const text = String(question).toLowerCase();
  if (/\b(anthropic|claude|opus|sonnet|haiku)\b/.test(text)) {
    return {
      allowed_domains: [
        'anthropic.com',
        'claude.com',
        'platform.claude.com',
        'docs.anthropic.com',
      ],
    };
  }
  if (/\b(openai|chatgpt|gpt|codex)\b/.test(text)) {
    return {
      allowed_domains: [
        'openai.com',
        'platform.openai.com',
        'developers.openai.com',
        'help.openai.com',
      ],
    };
  }
  return null;
}

function buildWebSearchUserPrompt({ question, messages = [], results = [] }) {
  const snippets = results.map(publicResultSnippet);
  return [
    `Question: ${compactText(question, 240)}`,
    '',
    'Use the web to answer this question. If saved-library context is relevant, mention it only after the web facts.',
    '',
    `Recent conversation: ${JSON.stringify(compactConversation(messages))}`,
    '',
    snippets.length
      ? `Saved-library context: ${JSON.stringify(snippets)}`
      : 'Saved-library context: none',
  ].join('\n');
}

function buildOpenAiWebSearchRequest({
  model = DEFAULT_OPENAI_MODEL,
  question,
  results = [],
  messages = [],
  toolType = 'web_search',
  toolChoice = 'required',
}) {
  const tool = {
    type: toolType,
    search_context_size: 'high',
  };
  const filters = toolType === 'web_search' ? webSearchFiltersForQuestion(question) : null;
  if (filters) tool.filters = filters;
  return {
    model,
    tools: [tool],
    tool_choice: toolChoice,
    include: toolType === 'web_search' ? ['web_search_call.action.sources'] : undefined,
    max_output_tokens: 450,
    input: [
      {
        role: 'system',
        content: [
          'You are IScraper web search.',
          'You must search the web before answering.',
          'Answer using cited web results and the provided saved-library snippets only.',
          'For current facts, company news, product releases, model capabilities, pricing, and API details, prefer official vendor sources over news or blogs.',
          'Use news sources only for context when official sources do not cover the point.',
          'Every specific factual claim must be supported by a web result citation or a saved-library snippet.',
          'If the sources do not verify a detail, omit it or say it is not verified.',
          'Never invent API features, pricing, release dates, benchmark claims, URLs, or model names.',
          'Keep the answer direct, practical, and non-technical.',
          'Write one compact paragraph under 110 words unless the user asks for more detail.',
          'Do not use bullets, headings, numbered lists, tables, or long feature inventories.',
          'Do not include markdown links or raw URLs in the answer text; the app shows sources separately.',
          'Do not end mid-sentence.',
        ].join(' '),
      },
      {
        role: 'user',
        content: buildWebSearchUserPrompt({ question, messages, results }),
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
  if (body.output_text) return compactText(body.output_text, 8000);
  const messages = Array.isArray(body.output) ? body.output : [];
  return compactText(messages
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((content) => content.text || '')
    .filter(Boolean)
    .join('\n'), 8000);
}

function normalizeCitationUrl(url = '') {
  try {
    const parsed = new URL(url);
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      if (/^utm_/i.test(key) || /_page$/i.test(key) || /^ss_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(lowerKey)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '').split('#')[0].replace(/[?&]utm_[^=]+=[^&\s]+/gi, '').trim();
  }
}

function normalizeUrlCitation(annotation = {}) {
  const url = normalizeCitationUrl(annotation.url || annotation.uri || '');
  if (!url) return null;
  const rawTitle = annotation.title || annotation.url || annotation.uri || url;
  const title = /^https?:\/\//i.test(rawTitle) ? normalizeCitationUrl(rawTitle) : rawTitle;
  return {
    url,
    title: compactText(title || url, 180),
    snippet: compactText(annotation.snippet || annotation.text || '', 260),
  };
}

function responseWebCitations(body = {}) {
  const citations = [];
  const byUrl = new Map();
  const isBareUrlTitle = (title = '') => /^https?:\/\//i.test(title) || !String(title || '').trim();
  const addCitation = (entry) => {
    const normalized = normalizeUrlCitation(entry);
    if (!normalized) return;
    const existing = byUrl.get(normalized.url);
    if (existing) {
      if (isBareUrlTitle(existing.title) && !isBareUrlTitle(normalized.title)) existing.title = normalized.title;
      if (!existing.snippet && normalized.snippet) existing.snippet = normalized.snippet;
      return;
    }
    byUrl.set(normalized.url, normalized);
    citations.push(normalized);
  };

  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (Array.isArray(item.action?.sources)) {
      item.action.sources.forEach(addCitation);
    }
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

function normalizeWebSearchAnswer(parsed = {}, body = {}, results = []) {
  const webCitations = responseWebCitations(body);
  const hasSavedEvidence = Array.isArray(results) && results.length > 0;
  if (!webCitations.length && !hasSavedEvidence) {
    const error = new Error('OpenAI web search returned no verifiable sources.');
    error.statusCode = 502;
    throw error;
  }
  const answer = removeIncompleteEnding(cleanGeneratedText(parsed.answer, 700));
  if (!answer || parsed.confidence === 'not_enough_evidence') {
    return {
      answer: removeIncompleteEnding(cleanGeneratedText(parsed.uncertainty || 'I could not verify this well enough from web sources. Open the sources below or try a more specific question.', 500)),
      citations: [],
      webCitations,
      sources: webCitations,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map((entry) => cleanGeneratedText(entry, 90)).filter(Boolean).slice(0, 3) : [],
      mode: 'web',
      confidence: 'not_enough_evidence',
    };
  }
  const uncertainty = cleanGeneratedText(parsed.uncertainty, 300);
  return {
    answer: uncertainty ? `${answer} ${uncertainty}` : answer,
    citations: [],
    webCitations,
    sources: webCitations,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map((entry) => cleanGeneratedText(entry, 90)).filter(Boolean).slice(0, 3) : [],
    mode: 'web',
    confidence: parsed.confidence || 'grounded',
  };
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
    body = await attempt('web_search');
  } catch (error) {
    if (error.statusCode && error.statusCode !== 400) throw error;
    try {
      body = await attempt('web_search_preview');
    } catch (fallbackError) {
      if (fallbackError.statusCode && fallbackError.statusCode !== 400) throw fallbackError;
      const request = buildOpenAiWebSearchRequest({
        model,
        question,
        results,
        messages,
        toolType: 'web_search_preview',
        toolChoice: 'auto',
      });
      const fetched = await fetchOpenAiResponses({ apiKey, request, fetchImpl });
      if (!fetched.response.ok) {
        throw openAiApiError(fetched.body, `OpenAI web search failed with ${fetched.response.status}`, fetched.response.status);
      }
      body = fetched.body;
    }
  }

  const content = responseOutputText(body);
  if (!content) throw new Error('OpenAI returned no web search answer.');
  return normalizeWebSearchAnswer({
    answer: content,
    uncertainty: '',
    suggestions: [],
    confidence: 'grounded',
  }, body, results);
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
