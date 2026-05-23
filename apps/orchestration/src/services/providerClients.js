const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  analyzeMediaWithGemini,
  analyzeTextMetadata,
  analyzeTextWithOpenRouter,
  buildOpenRouterAnalysisRequest,
  mergeAnalysis,
  parseOpenRouterAnalysisResponse,
} = require('./analyzer');
const { createOpenRouterEmbedding } = require('./embeddings');
const { OPENAI_COMPATIBLE_PROVIDER, assertMediaModelAllowed, openAICompatibleChatEndpoint } = require('./providers');

const OPENAI_COMPATIBLE_TEXT_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};

function appReferer() {
  return process.env.APP_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173';
}

function parseJsonContent(content) {
  return JSON.parse(String(content || '').replace(/```json|```/g, '').trim());
}

function isProviderLimitError(error) {
  const message = String(error?.message || '').toLowerCase();
  return /rate|limit|quota|credit|insufficient|unauthorized|invalid api key|api key/.test(message);
}

async function analyzeTextWithCredential({ credential, item, baseAnalysis, fetchImpl = fetch }) {
  if (!credential?.apiKey) return null;

  if (credential.provider === 'openrouter') {
    return analyzeTextWithOpenRouter({
      apiKey: credential.apiKey,
      model: credential.model,
      item,
      baseAnalysis,
      fetchImpl,
    });
  }

  if (OPENAI_COMPATIBLE_TEXT_ENDPOINTS[credential.provider]) {
    return analyzeTextWithOpenAICompatible({
      apiKey: credential.apiKey,
      model: credential.model,
      endpoint: OPENAI_COMPATIBLE_TEXT_ENDPOINTS[credential.provider],
      item,
      baseAnalysis,
      fetchImpl,
    });
  }

  if (credential.provider === OPENAI_COMPATIBLE_PROVIDER) {
    return analyzeTextWithOpenAICompatible({
      apiKey: credential.apiKey,
      model: credential.model,
      endpoint: openAICompatibleChatEndpoint(credential.baseUrl),
      item,
      baseAnalysis,
      fetchImpl,
    });
  }

  if (credential.provider === 'anthropic') {
    return analyzeTextWithAnthropic({ apiKey: credential.apiKey, model: credential.model, item, baseAnalysis, fetchImpl });
  }

  if (credential.provider === 'gemini') {
    return analyzeTextWithGemini({ apiKey: credential.apiKey, model: credential.model, item, baseAnalysis });
  }

  return null;
}

async function testProviderCredential({ credential, fetchImpl = fetch }) {
  if (!credential?.apiKey) throw new Error('Credential is missing an API key.');

  if (credential.provider === 'openrouter') {
    if (credential.purpose === 'embedding') {
      await createOpenRouterEmbedding({
        apiKey: credential.apiKey,
        model: credential.model,
        input: 'test search',
        inputType: 'search_query',
        fetchImpl,
      });
      return true;
    }
    await simpleOpenAICompatibleRequest({
      apiKey: credential.apiKey,
      model: credential.model,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      fetchImpl,
      headers: {
        'HTTP-Referer': appReferer(),
        'X-Title': 'Instagram Brain',
      },
    });
    return true;
  }

  if (OPENAI_COMPATIBLE_TEXT_ENDPOINTS[credential.provider]) {
    await simpleOpenAICompatibleRequest({
      apiKey: credential.apiKey,
      model: credential.model,
      endpoint: OPENAI_COMPATIBLE_TEXT_ENDPOINTS[credential.provider],
      fetchImpl,
    });
    return true;
  }

  if (credential.provider === OPENAI_COMPATIBLE_PROVIDER) {
    await simpleOpenAICompatibleRequest({
      apiKey: credential.apiKey,
      model: credential.model,
      endpoint: openAICompatibleChatEndpoint(credential.baseUrl),
      fetchImpl,
    });
    return true;
  }

  if (credential.provider === 'anthropic') {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': credential.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: credential.model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply OK.' }],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `Anthropic request failed with ${response.status}`);
    return true;
  }

  if (credential.provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(credential.apiKey);
    const model = genAI.getGenerativeModel({ model: credential.model });
    await model.generateContent('Reply OK.');
    return true;
  }

  throw new Error(`Unsupported credential provider: ${credential.provider}`);
}

async function simpleOpenAICompatibleRequest({ apiKey, model, endpoint, fetchImpl, headers = {} }) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply OK.' }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Provider request failed with ${response.status}`);
  return body;
}

async function analyzeTextWithOpenAICompatible({ apiKey, model, endpoint, item, baseAnalysis, fetchImpl = fetch }) {
  const request = buildOpenRouterAnalysisRequest({ model, item, baseAnalysis });
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      messages: request.messages,
      response_format: { type: 'json_object' },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Provider request failed with ${response.status}`);
  return parseOpenRouterAnalysisResponse(body);
}

async function analyzeTextWithAnthropic({ apiKey, model, item, baseAnalysis, fetchImpl = fetch }) {
  const request = buildOpenRouterAnalysisRequest({ model, item, baseAnalysis });
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      system: `${request.messages[0].content} Return JSON only.`,
      messages: [request.messages[1]],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Anthropic request failed with ${response.status}`);
  return parseJsonContent(body?.content?.[0]?.text);
}

async function analyzeTextWithGemini({ apiKey, model, item, baseAnalysis }) {
  const request = buildOpenRouterAnalysisRequest({ model, item, baseAnalysis });
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });
  const result = await geminiModel.generateContent(`${request.messages[0].content}\n\n${request.messages[1].content}`);
  return parseJsonContent(result.response.text());
}

async function analyzeMediaWithCredential({ credential, mediaPaths, item, fetchImpl = fetch }) {
  if (!credential?.apiKey || !mediaPaths?.length) return null;
  if (credential.provider === 'gemini') {
    return analyzeMediaWithGemini({ apiKey: credential.apiKey, mediaPaths, item });
  }
  if (credential.provider === 'openrouter') {
    return analyzeMediaWithOpenRouter({
      apiKey: credential.apiKey,
      model: credential.model,
      mediaPaths,
      item,
      fetchImpl,
    });
  }
  return null;
}

async function analyzeMediaWithOpenRouter({ apiKey, model, mediaPaths, item, fetchImpl = fetch }) {
  assertMediaModelAllowed(model);
  const content = [
    {
      type: 'text',
      text: [
        'Analyze this Instagram saved item media for a searchable personal knowledge base.',
        'If video, transcribe spoken audio and visible text. If image, OCR visible text.',
        'Return strict JSON only with these keys: title, summary, transcript, ocrText, visualDescription, brandsMentioned, toolsMentioned, reposMentioned, peopleMentioned, topics, tags, whyUseful.',
        `Original caption: ${item.caption || ''}`,
      ].join('\n'),
    },
    ...mediaPaths.map(mediaContentPart),
  ];

  const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appReferer(),
      'X-Title': 'Instagram Brain',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 1600,
      messages: [{ role: 'user', content }],
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `OpenRouter media request failed with ${response.status}`);
  return parseOpenRouterAnalysisResponse(body);
}

function mediaContentPart(mediaPath) {
  const lower = mediaPath.toLowerCase();
  const isVideo = /\.(mp4|mov|webm|m4v)$/.test(lower);
  const mimeType = isVideo ? videoMimeType(lower) : imageMimeType(lower);
  const dataUrl = `data:${mimeType};base64,${fs.readFileSync(mediaPath).toString('base64')}`;
  if (isVideo) {
    return {
      type: 'video_url',
      video_url: { url: dataUrl },
    };
  }
  return {
    type: 'image_url',
    image_url: { url: dataUrl },
  };
}

function videoMimeType(lowerPath) {
  if (lowerPath.endsWith('.webm')) return 'video/webm';
  if (lowerPath.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

function imageMimeType(lowerPath) {
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function buildTextBaseAnalysis(item, mediaAnalysis = null) {
  const captionAnalysis = analyzeTextMetadata({ caption: item.caption });
  if (!mediaAnalysis) return captionAnalysis;
  return mergeAnalysis(captionAnalysis, mediaAnalysis);
}

module.exports = {
  analyzeMediaWithCredential,
  analyzeMediaWithOpenRouter,
  analyzeTextWithCredential,
  buildTextBaseAnalysis,
  isProviderLimitError,
  testProviderCredential,
};
