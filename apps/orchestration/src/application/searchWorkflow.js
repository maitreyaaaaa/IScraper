const crypto = require('crypto');
const { createOpenRouterEmbedding } = require('../services/embeddings');
const { createOpenAiWebSearchAnswer, createOpenRouterLibraryChatAnswer, createOpenRouterSearchAnswer } = require('../services/aiSearch');
const { recordRequestTiming } = require('../services/observability');
const { cleanText, withTimeout } = require('./common');

const aiSearchCache = new Map();
const aiUsageBuckets = new Map();

function currentUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

function assertAiSearchUsageAllowed(req, config, clientIp) {
  const now = Date.now();
  const userKey = req.user?.id || clientIp(req);
  const minuteKey = `minute:${userKey}`;
  const dayKey = `day:${currentUtcDay()}:${userKey}`;
  const minuteMax = config.aiSearchRateLimitMax || 60;
  const dayMax = config.aiSearchDailyLimit || 1000;
  const minute = aiUsageBuckets.get(minuteKey);
  const minuteBucket = minute && minute.resetAt > now ? minute : { count: 0, resetAt: now + 60 * 1000 };
  const day = aiUsageBuckets.get(dayKey);
  const dayBucket = day && day.resetAt > now ? day : { count: 0, resetAt: now + 24 * 60 * 60 * 1000 };

  minuteBucket.count += 1;
  dayBucket.count += 1;
  aiUsageBuckets.set(minuteKey, minuteBucket);
  aiUsageBuckets.set(dayKey, dayBucket);

  if (minuteBucket.count > minuteMax || dayBucket.count > dayMax) {
    const error = new Error('AI search is busy. Please try again later.');
    error.statusCode = 429;
    throw error;
  }

  if (aiUsageBuckets.size > 5000) {
    for (const [bucketKey, value] of aiUsageBuckets.entries()) {
      if (value.resetAt <= now) aiUsageBuckets.delete(bucketKey);
    }
  }
}

function aiSearchCacheKey({ userId, query, results, model }) {
  const ids = results.map((item) => item.id).join(',');
  return crypto
    .createHash('sha256')
    .update([userId, model, String(query || '').trim().toLowerCase(), ids].join('\n'))
    .digest('hex');
}

function firstLine(value = '') {
  return String(value).split('\n').find(Boolean)?.slice(0, 160);
}

function publicLensResult(item) {
  const analysis = item.analysis || {};
  return {
    id: item.id,
    url: item.url,
    platform: item.platform || 'Web',
    sourceTitle: item.sourceTitle || analysis.title || firstLine(item.caption) || 'Saved item',
    sourceAuthor: item.sourceAuthor || item.ownerUsername || item.ownerName || '',
    sourceDescription: item.sourceDescription || analysis.summary || item.caption || '',
    thumbnailUrl: item.thumbnailUrl || '',
    status: item.status,
    summary: analysis.summary || '',
    tags: analysis.tags || item.hashtags || [],
  };
}

function recordSearchTiming(req, name, startedAt) {
  recordRequestTiming(req, name, startedAt);
}

function semanticSearchRequested(filters = {}) {
  return filters.semantic === true
    || filters.semanticSearch === true
    || filters.mode === 'semantic';
}

function createSearchWorkflow({ store, config, http }) {
  const { clientIp } = http;

  function createSearchEventId() {
    return crypto.randomUUID();
  }

  function aiTimeoutMs() {
    return Math.max(1000, Math.min(Number(config.aiSearchTimeoutMs || 12_000), 25_000));
  }

  function aiContextLimit() {
    return Math.max(1, Math.min(Number(config.aiSearchContextLimit || 5), 8));
  }

  async function runSearch({ req = null, userId, query, filters = {} }) {
    let queryEmbedding = null;
    const shouldTrySemantic = query
      && semanticSearchRequested(filters)
      && config.credentialEncryptionKey
      && store.supportsSemanticSearch
      && typeof store.getPreferredProviderCredential === 'function';
    if (shouldTrySemantic) {
      try {
        const credentialStartedAt = process.hrtime.bigint();
        const embeddingCredential = await store.getPreferredProviderCredential(userId, 'embedding', config.credentialEncryptionKey);
        recordSearchTiming(req, 'searchSemanticCredentialMs', credentialStartedAt);
        if (embeddingCredential) {
          const embeddingStartedAt = process.hrtime.bigint();
          queryEmbedding = await createOpenRouterEmbedding({
            apiKey: embeddingCredential.apiKey,
            model: embeddingCredential.model || 'openai/text-embedding-3-small',
            input: query,
            dimensions: config.embeddingDimensions,
            inputType: 'search_query',
          });
          recordSearchTiming(req, 'searchSemanticEmbeddingMs', embeddingStartedAt);
        }
      } catch (error) {
        console.warn(`Semantic query embedding failed: ${error.message}`);
      }
    }
    const searchStartedAt = process.hrtime.bigint();
    const searchOptions = {
      queryEmbedding,
      recordTiming(name, startedAt) {
        recordSearchTiming(req, name, startedAt);
      },
    };
    const useLeanSearch = !queryEmbedding && typeof store.searchLean === 'function';
    const results = useLeanSearch
      ? await store.searchLean(userId, query, filters, searchOptions)
      : await store.search(userId, query, filters, searchOptions);
    recordSearchTiming(req, useLeanSearch ? 'searchLeanTotalMs' : 'searchFetchMs', searchStartedAt);
    return results;
  }

  async function runAiSearchAnswer({ req, userId, query, results }) {
    if (config.aiSearchEnabled === false || !config.openAiApiKey || !query || !results.length) return null;
    const topResults = results.slice(0, aiContextLimit());
    const model = config.aiSearchModel || config.openAiModel || 'gpt-4o';
    const cacheKey = aiSearchCacheKey({ userId, query, results: topResults, model });
    const cached = aiSearchCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return { ...cached.value, cached: true };

    assertAiSearchUsageAllowed(req, config, clientIp);
    const ai = await withTimeout(
      createOpenRouterSearchAnswer({
        apiKey: config.openAiApiKey,
        model,
        query,
        results: topResults,
      }),
      aiTimeoutMs(),
      'AI search answer timed out.'
    );
    if (!ai) return null;

    const value = { ...ai, model, resultIds: topResults.map((item) => item.id), cached: false };
    aiSearchCache.set(cacheKey, {
      value,
      expiresAt: now + (config.aiSearchCacheTtlMs || 6 * 60 * 60 * 1000),
    });

    if (aiSearchCache.size > 500) {
      for (const [entryKey, entry] of aiSearchCache.entries()) {
        if (entry.expiresAt <= now || aiSearchCache.size > 500) aiSearchCache.delete(entryKey);
      }
    }

    return value;
  }

  function normalizeChatMessages(messages = []) {
    return Array.isArray(messages)
      ? messages
        .filter((message) => ['user', 'assistant'].includes(message?.role))
        .slice(-8)
        .map((message) => ({
          role: message.role,
          content: cleanText(message.content || message.text || '', 1200),
        }))
        .filter((message) => message.content)
      : [];
  }

  async function runLibraryChatAnswer({ req, userId, question, messages = [], results, includeWeb = false }) {
    const cleanQuestion = cleanText(question || '', 240);
    if (!cleanQuestion) {
      const error = new Error('Ask a question before chatting with your library.');
      error.statusCode = 400;
      throw error;
    }

    const topResults = (results || []).slice(0, aiContextLimit());
    const searchEventId = createSearchEventId();
    if (typeof store.recordSearchEvent === 'function') {
      await store.recordSearchEvent({
        id: searchEventId,
        userId,
        query: topResults.length === 0 ? cleanQuestion : '',
        queryLength: cleanQuestion.length,
        filters: { source: includeWeb ? 'library-chat-web' : 'library-chat', limit: topResults.length },
        resultCount: topResults.length,
        includeAi: true,
        resultIds: topResults.map((item) => item.id),
      });
    }

    if (!topResults.length && !includeWeb) {
      return {
        searchEventId,
        ai: {
          answer: 'I could not find enough matching saves in your Library to answer that.',
          citations: [],
          suggestions: ['Try a different keyword', 'Ask about a creator, topic, or tag'],
        },
        results: [],
      };
    }

    if (config.aiSearchEnabled === false || !config.openAiApiKey) {
      return {
        searchEventId,
        ai: {
          error: 'AI library chat is not configured right now. Showing matching saves instead.',
          citations: [],
          suggestions: [],
        },
        results: topResults,
      };
    }

    assertAiSearchUsageAllowed(req, config, clientIp);
    const model = config.aiSearchModel || config.openAiModel || 'gpt-4o';
    if (includeWeb) {
      try {
        const webAi = await withTimeout(
          createOpenAiWebSearchAnswer({
            apiKey: config.openAiApiKey,
            model,
            question: cleanQuestion,
            messages: normalizeChatMessages(messages),
            results: topResults,
          }),
          aiTimeoutMs(),
          'Web search timed out.'
        );
        return {
          searchEventId,
          ai: webAi ? { ...webAi, model, resultIds: topResults.map((item) => item.id), cached: false } : null,
          results: topResults,
          progress: {
            saved: { status: 'done', count: topResults.length },
            web: { status: webAi ? 'done' : 'failed' },
          },
        };
      } catch (error) {
        return {
          searchEventId,
          ai: {
            error: error.statusCode === 429
              ? 'Web search is rate-limited right now. Your saved matches are still shown, and you can try again after the OpenAI limit resets.'
              : /timed out/i.test(error.message)
                ? 'Web search is taking too long right now. Your saved matches are still shown, and you can try again.'
                : 'Web search is unavailable right now. Showing matching saves instead.',
            citations: [],
            webCitations: [],
            suggestions: ['Try again', 'Ask a shorter question'],
            mode: 'web',
          },
          results: topResults,
          progress: {
            saved: { status: 'done', count: topResults.length },
            web: { status: 'failed' },
          },
        };
      }
    }
    let ai;
    try {
      ai = await withTimeout(
        createOpenRouterLibraryChatAnswer({
          apiKey: config.openAiApiKey,
          model,
          question: cleanQuestion,
          messages: normalizeChatMessages(messages),
          results: topResults,
        }),
        aiTimeoutMs(),
        'AI library chat timed out.'
      );
    } catch (error) {
      if (error.statusCode === 429) throw error;
      return {
        searchEventId,
        ai: {
          error: /timed out/i.test(error.message)
            ? 'AI is taking too long right now. Your matching saves are still shown, and you can try again.'
            : 'AI answer is unavailable right now. Showing matching saves instead.',
          citations: [],
          suggestions: ['Try again', 'Ask a shorter question'],
        },
        results: topResults,
      };
    }

    return {
      searchEventId,
      ai: ai ? { ...ai, model, resultIds: topResults.map((item) => item.id), cached: false } : null,
      results: topResults,
    };
  }

  return {
    createSearchEventId,
    publicLensResult,
    runAiSearchAnswer,
    runLibraryChatAnswer,
    runSearch,
  };
}

module.exports = {
  createSearchWorkflow,
};
