const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAgentQueryResponse,
  handleMcpRequest,
  publicAgentItem,
} = require('../src/services/agentAccess');

test('publicAgentItem exposes useful library fields without raw internals', () => {
  const item = publicAgentItem({
    id: 'save-1',
    url: 'https://example.com/post',
    platform: 'Instagram',
    collections: ['Research'],
    analysis: {
      title: 'SOC 2 checklist',
      summary: 'Controls and evidence list',
      visualDescription: 'A checklist on a laptop screen',
      tags: ['security'],
      topics: ['compliance'],
    },
  });

  assert.equal(item.id, 'save-1');
  assert.equal(item.title, 'SOC 2 checklist');
  assert.deepEqual(item.tags, ['security']);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'raw'), false);
});

test('buildAgentQueryResponse tells agents to cite saved item ids', () => {
  const response = buildAgentQueryResponse({
    query: 'security checklist',
    results: [
      {
        id: 'save-1',
        analysis: { title: 'SOC 2 checklist', summary: 'Controls and evidence list' },
      },
    ],
  });

  assert.equal(response.resultCount, 1);
  assert.match(response.guidance, /Cite save ids/);
  assert.equal(response.items[0].rank, 1);
});

test('handleMcpRequest supports initialize and tool listing', async () => {
  const initialize = await handleMcpRequest({
    request: { jsonrpc: '2.0', id: 1, method: 'initialize' },
    userId: 'user-1',
    store: {},
    search: async () => [],
  });
  const tools = await handleMcpRequest({
    request: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    userId: 'user-1',
    store: {},
    search: async () => [],
  });

  assert.equal(initialize.result.serverInfo.name, 'IScraper Agent Access');
  assert.equal(tools.result.tools[0].name, 'ask_iscraper_library');
});
