function cleanText(value = '', limit = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [value];
}

function publicAgentItem(item = {}, rank = 0) {
  const analysis = item.analysis || {};
  return {
    id: item.id,
    rank: rank + 1,
    title: cleanText(analysis.title || item.sourceTitle || item.caption || 'Untitled save', 180),
    url: item.url || '',
    platform: item.platform || '',
    contentType: item.contentType || '',
    sourceAuthor: item.sourceAuthor || item.ownerUsername || item.ownerName || '',
    savedAt: item.savedAt || item.createdAt || '',
    collections: arrayValue(item.collections).slice(0, 10),
    summary: cleanText(analysis.summary || item.sourceDescription || item.caption, 700),
    visualDescription: cleanText(analysis.visualDescription, 700),
    ocrText: cleanText(analysis.ocrText, 500),
    transcript: cleanText(analysis.transcript, 900),
    whyUseful: cleanText(analysis.whyUseful, 400),
    tags: arrayValue(analysis.tags || item.hashtags).slice(0, 16),
    topics: arrayValue(analysis.topics).slice(0, 16),
    searchMatch: item.searchMatch || null,
  };
}

function buildAgentQueryResponse({ query, results = [] }) {
  const items = results.map(publicAgentItem);
  return {
    query: cleanText(query, 240),
    resultCount: items.length,
    items,
    guidance: items.length
      ? 'Answer using only these IScraper saves. Cite save ids when making claims.'
      : 'No matching IScraper saves were found for this question.',
  };
}

function toolsList() {
  return [
    {
      name: 'ask_iscraper_library',
      description: 'Search the user-owned IScraper library and return grounded saved items for answering.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question or search query for the saved library.' },
          limit: { type: 'number', description: 'Maximum results to return. Defaults to 8.' },
        },
        required: ['question'],
      },
    },
    {
      name: 'get_iscraper_save',
      description: 'Read one saved IScraper item by id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Saved item id.' },
        },
        required: ['id'],
      },
    },
  ];
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function callAgentTool({ name, args = {}, userId, store, search }) {
  if (name === 'ask_iscraper_library') {
    const question = cleanText(args.question || args.query || '', 240);
    if (!question) {
      const error = new Error('Ask a question before searching your IScraper library.');
      error.statusCode = 400;
      throw error;
    }
    const limit = Math.max(1, Math.min(Number(args.limit) || 8, 20));
    const results = (await search({ userId, query: question, filters: { limit } })).slice(0, limit);
    return buildAgentQueryResponse({ query: question, results });
  }

  if (name === 'get_iscraper_save') {
    const id = cleanText(args.id || '', 120);
    if (!id) {
      const error = new Error('Saved item id is required.');
      error.statusCode = 400;
      throw error;
    }
    const item = await store.getItem(userId, id);
    if (!item) {
      const error = new Error('Saved item not found.');
      error.statusCode = 404;
      throw error;
    }
    return { item: publicAgentItem(item, 0) };
  }

  const error = new Error(`Unknown IScraper tool: ${name}`);
  error.statusCode = 404;
  throw error;
}

async function handleMcpRequest({ request, userId, store, search }) {
  const method = String(request?.method || '');
  const id = request?.id ?? null;

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'IScraper Agent Access', version: '0.1.0' },
    });
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: toolsList() });
  }

  if (method === 'tools/call') {
    try {
      const result = await callAgentTool({
        name: request?.params?.name,
        args: request?.params?.arguments || {},
        userId,
        store,
        search,
      });
      return jsonRpcResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      });
    } catch (error) {
      return jsonRpcError(id, error.statusCode === 404 ? -32601 : -32602, error.message);
    }
  }

  return jsonRpcError(id, -32601, `Unsupported MCP method: ${method}`);
}

module.exports = {
  buildAgentQueryResponse,
  callAgentTool,
  handleMcpRequest,
  publicAgentItem,
  toolsList,
};
