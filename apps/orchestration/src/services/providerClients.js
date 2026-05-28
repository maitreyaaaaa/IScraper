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
  if (credential.provider === 'openai') {
    return analyzeMediaWithOpenAI({
      apiKey: credential.apiKey,
      model: credential.model,
      mediaPaths,
      item,
      fetchImpl,
    });
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

async function analyzeImageBufferWithCredential({ credential, imageBuffer, mimeType = 'image/png', item, fetchImpl = fetch }) {
  if (!credential?.apiKey || !imageBuffer?.length) return null;
  if (credential.provider === 'gemini') {
    return analyzeImageBufferWithGemini({
      apiKey: credential.apiKey,
      model: credential.model,
      imageBuffer,
      mimeType,
      item,
    });
  }
  if (credential.provider === 'openai') {
    return analyzeImageBufferWithOpenAI({
      apiKey: credential.apiKey,
      model: credential.model,
      imageBuffer,
      mimeType,
      item,
      fetchImpl,
    });
  }
  if (credential.provider === 'openrouter') {
    return analyzeImageBufferWithOpenRouter({
      apiKey: credential.apiKey,
      model: credential.model,
      imageBuffer,
      mimeType,
      item,
      fetchImpl,
    });
  }
  return null;
}

async function analyzeMediaWithOpenAI({ apiKey, model, mediaPaths, item, fetchImpl = fetch }) {
  const imagePaths = (mediaPaths || []).filter((mediaPath) => !/\.(mp4|mov|webm|m4v)$/i.test(mediaPath));
  if (!imagePaths.length) return null;
  const content = [
    {
      type: 'text',
      text: [
        'Analyze this Instagram saved item media for a searchable personal knowledge base.',
        'OCR visible text, describe the visual content, and extract searchable topics.',
        'Return strict JSON only with these keys: title, summary, transcript, ocrText, visualDescription, brandsMentioned, toolsMentioned, reposMentioned, peopleMentioned, topics, tags, whyUseful.',
        'Use an empty string for transcript unless there is spoken/audio content.',
        `Original caption: ${item.caption || ''}`,
      ].join('\n'),
    },
    ...imagePaths.map(mediaContentPart),
  ];

  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI media request failed with ${response.status}`);
  return parseOpenRouterAnalysisResponse(body);
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

async function analyzeImageBufferWithOpenAI({ apiKey, model, imageBuffer, mimeType, item, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: screenshotAnalysisPrompt(item) },
          imageContentPart(imageBuffer, mimeType),
        ],
      }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI image analysis failed with ${response.status}`);
  return normalizeScreenshotAnalysis(parseOpenRouterAnalysisResponse(body));
}

async function analyzeImageBufferWithOpenRouter({ apiKey, model, imageBuffer, mimeType, item, fetchImpl = fetch }) {
  assertMediaModelAllowed(model);
  const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appReferer(),
      'X-Title': 'IScraper',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: screenshotAnalysisPrompt(item) },
          imageContentPart(imageBuffer, mimeType),
        ],
      }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `OpenRouter image analysis failed with ${response.status}`);
  return normalizeScreenshotAnalysis(parseOpenRouterAnalysisResponse(body));
}

async function analyzeImageBufferWithGemini({ apiKey, model, imageBuffer, mimeType, item }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });
  const result = await geminiModel.generateContent([
    {
      inlineData: {
        mimeType,
        data: Buffer.from(imageBuffer).toString('base64'),
      },
    },
    { text: screenshotAnalysisPrompt(item) },
  ]);
  return normalizeScreenshotAnalysis(parseJsonContent(result.response.text()));
}

function imageContentPart(imageBuffer, mimeType) {
  return {
    type: 'image_url',
    image_url: {
      url: `data:${mimeType};base64,${Buffer.from(imageBuffer).toString('base64')}`,
    },
  };
}

function screenshotAnalysisPrompt(item = {}) {
  return [
    'Analyze this browser screenshot for a private searchable library.',
    'Write a useful medium-length analysis, not a long essay.',
    'OCR visible text exactly where useful. Do not invent facts outside the screenshot.',
    'Return strict JSON only with these keys: title, summary, transcript, ocrText, visualDescription, brandsMentioned, toolsMentioned, reposMentioned, peopleMentioned, topics, tags, whyUseful.',
    'Use an empty string for transcript unless there is spoken/audio content.',
    'Keep summary to 2-4 sentences, visualDescription to 2-4 sentences, whyUseful to 1-2 sentences, and arrays short.',
    `Source page title: ${item.sourceTitle || item.title || ''}`,
    `Source page URL: ${item.url || ''}`,
  ].join('\n');
}

function normalizeScreenshotAnalysis(analysis = {}) {
  const summary = compactAnalysisText(analysis.summary, 700);
  const visualDescription = compactAnalysisText(analysis.visualDescription, 700);
  const ocrText = compactAnalysisText(analysis.ocrText, 1400);
  return {
    title: compactAnalysisText(analysis.title, 120) || 'Screen capture',
    summary,
    transcript: compactAnalysisText(analysis.transcript, 500),
    ocrText,
    visualDescription,
    brandsMentioned: shortList(analysis.brandsMentioned, 10),
    toolsMentioned: shortList(analysis.toolsMentioned, 10),
    reposMentioned: shortList(analysis.reposMentioned, 8),
    peopleMentioned: shortList(analysis.peopleMentioned, 8),
    topics: shortList(analysis.topics, 10),
    tags: shortList(analysis.tags, 12),
    whyUseful: compactAnalysisText(analysis.whyUseful, 360) || 'Useful browser screenshot reference.',
  };
}

function compactAnalysisText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function shortList(values, maxLength) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => compactAnalysisText(value, 80)).filter(Boolean))].slice(0, maxLength);
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
  analyzeImageBufferWithCredential,
  analyzeMediaWithCredential,
  analyzeMediaWithOpenRouter,
  analyzeTextWithCredential,
  buildTextBaseAnalysis,
  isProviderLimitError,
  testProviderCredential,
};
