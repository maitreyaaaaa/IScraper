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
    throw new Error('OpenRouter returned no embedding.');
  }
  return embedding;
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

module.exports = {
  buildEmbeddingContent,
  createOpenRouterEmbedding,
  parseOpenRouterEmbeddingResponse,
};
