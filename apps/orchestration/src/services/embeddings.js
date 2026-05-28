function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function appReferer() {
  return process.env.APP_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173';
}

function buildEmbeddingContent(item, analysis = {}) {
  return [
    compactText(item.caption),
    compactText(analysis.title),
    compactText(analysis.summary),
    compactText(analysis.transcript),
    compactText(analysis.ocrText),
    compactText(analysis.visualDescription),
    ...(analysis.brandsMentioned || []),
    ...(analysis.toolsMentioned || []),
    ...(analysis.reposMentioned || []),
    ...(analysis.peopleMentioned || []),
    ...(analysis.topics || []),
    ...(analysis.tags || []),
    compactText(analysis.whyUseful),
  ]
    .map(compactText)
    .filter(Boolean)
    .join('\n')
    .slice(0, 24000);
}

function parseOpenRouterEmbeddingResponse(response) {
  const embedding = response?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || !embedding.length) {
    throw new Error('Embedding provider returned no embedding.');
  }
  return embedding;
}

async function createOpenAIEmbedding({
  apiKey,
  model = 'text-embedding-3-small',
  input,
  dimensions = 1536,
  fetchImpl = fetch,
}) {
  if (!apiKey || !compactText(input)) return null;

  const response = await fetchImpl('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
      dimensions,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenAI embedding request failed with ${response.status}`);
  }
  return parseOpenRouterEmbeddingResponse(body);
}

async function createOpenRouterEmbedding({
  apiKey,
  model = 'openai/text-embedding-3-small',
  input,
  dimensions = 1536,
  inputType = 'search_document',
  fetchImpl = fetch,
}) {
  if (!apiKey || !compactText(input)) return null;

  const response = await fetchImpl('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appReferer(),
      'X-Title': 'Instagram Brain',
    },
    body: JSON.stringify({
      model,
      input,
      dimensions,
      input_type: inputType,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenRouter embedding request failed with ${response.status}`);
  }
  return parseOpenRouterEmbeddingResponse(body);
}

async function createEmbeddingWithCredential({
  credential,
  input,
  dimensions = 1536,
  inputType = 'search_document',
  fetchImpl = fetch,
}) {
  if (!credential?.apiKey) return null;
  if (credential.provider === 'openai') {
    return createOpenAIEmbedding({
      apiKey: credential.apiKey,
      model: credential.model || 'text-embedding-3-small',
      input,
      dimensions,
      fetchImpl,
    });
  }
  return createOpenRouterEmbedding({
    apiKey: credential.apiKey,
    model: credential.model || 'openai/text-embedding-3-small',
    input,
    dimensions,
    inputType,
    fetchImpl,
  });
}

module.exports = {
  buildEmbeddingContent,
  createEmbeddingWithCredential,
  createOpenAIEmbedding,
  createOpenRouterEmbedding,
  parseOpenRouterEmbeddingResponse,
};
