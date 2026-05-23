const assert = require('node:assert/strict');
const test = require('node:test');

const { buildKnowledgeGraph, buildObsidianFiles } = require('../src/services/graph');

test('buildKnowledgeGraph turns indexed items into item and concept nodes', () => {
  const graph = buildKnowledgeGraph([
    {
      id: 'save-1',
      url: 'https://instagram.com/reel/AAA111',
      status: 'done',
      collections: ['Security'],
      analysis: {
        title: 'SOC 2 checklist',
        summary: 'A save about audit evidence and privacy controls.',
        topics: ['security compliance'],
        tags: ['SOC 2'],
        brandsMentioned: ['Vanta'],
        toolsMentioned: [],
        peopleMentioned: [],
      },
    },
    {
      id: 'save-2',
      url: 'https://instagram.com/reel/BBB222',
      status: 'queued',
      analysis: {
        title: 'Not indexed yet',
        topics: ['security compliance'],
      },
    },
  ]);

  assert.equal(graph.stats.indexedItems, 1);
  assert.equal(graph.nodes.some((node) => node.id === 'item:save-1' && node.type === 'item'), true);
  assert.equal(graph.nodes.some((node) => node.id === 'topic:security-compliance'), true);
  assert.equal(graph.nodes.some((node) => node.id === 'brand:vanta'), true);
  assert.equal(graph.nodes.some((node) => node.id === 'item:save-2'), false);
  assert.equal(graph.links.some((link) => link.source === 'item:save-1' && link.target === 'topic:security-compliance'), true);
});

test('buildObsidianFiles creates markdown notes with wikilinks and a graph json file', () => {
  const graph = buildKnowledgeGraph([
    {
      id: 'save-1',
      url: 'https://instagram.com/reel/AAA111',
      status: 'done',
      collections: ['Security'],
      analysis: {
        title: 'SOC 2 checklist',
        summary: 'A save about audit evidence and privacy controls.',
        topics: ['security compliance'],
        tags: ['SOC 2'],
        brandsMentioned: ['Vanta'],
        toolsMentioned: [],
        peopleMentioned: [],
      },
    },
  ]);

  const files = buildObsidianFiles(graph);
  const itemNote = files.find((file) => file.path.startsWith('IScraper Items/'));
  const conceptNote = files.find((file) => file.path === 'IScraper Graph/SOC 2.md');

  assert.ok(itemNote);
  assert.match(itemNote.content, /\[\[security compliance\]\]/);
  assert.match(itemNote.content, /\[\[SOC 2\]\]/);
  assert.match(itemNote.content, /https:\/\/instagram\.com\/reel\/AAA111/);
  assert.ok(conceptNote);
  assert.match(conceptNote.content, /\[\[SOC 2 checklist\]\]/);
  assert.equal(files.some((file) => file.path === 'graph.json'), true);
});
