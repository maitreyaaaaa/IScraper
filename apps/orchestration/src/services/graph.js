function slugify(value) {
  return String(value || 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
}

function safeFileName(value) {
  return String(value || 'Untitled')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    || 'Untitled';
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function addNode(nodes, node) {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
  return nodes.get(node.id);
}

function conceptEntries(item) {
  const analysis = item.analysis || {};
  return [
    ...(analysis.topics || []).map((label) => ({ type: 'topic', label })),
    ...(analysis.tags || []).map((label) => ({ type: 'tag', label })),
    ...(analysis.brandsMentioned || []).map((label) => ({ type: 'brand', label })),
    ...(analysis.toolsMentioned || []).map((label) => ({ type: 'tool', label })),
    ...(analysis.peopleMentioned || []).map((label) => ({ type: 'person', label })),
    ...(item.collections || []).map((label) => ({ type: 'collection', label })),
  ];
}

function buildKnowledgeGraph(items = []) {
  const nodes = new Map();
  const links = new Map();
  const indexed = items.filter((item) => item.status === 'done' && item.analysis);

  for (const item of indexed) {
    const analysis = item.analysis || {};
    const itemNode = addNode(nodes, {
      id: `item:${item.id}`,
      type: 'item',
      label: analysis.title || item.caption || 'Untitled save',
      itemId: item.id,
      url: item.url,
      summary: analysis.summary || '',
      collections: item.collections || [],
      weight: 5,
    });

    for (const concept of conceptEntries(item)) {
      const conceptNode = addNode(nodes, {
        id: `${concept.type}:${slugify(concept.label)}`,
        type: concept.type,
        label: concept.label,
        weight: 0,
        itemCount: 0,
      });
      conceptNode.weight += 1;
      conceptNode.itemCount += 1;

      const linkId = `${itemNode.id}->${conceptNode.id}`;
      links.set(linkId, {
        id: linkId,
        source: itemNode.id,
        target: conceptNode.id,
        type: concept.type,
        weight: 1,
      });
    }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.label).localeCompare(String(b.label))),
    links: [...links.values()],
    stats: {
      indexedItems: indexed.length,
      conceptNodes: [...nodes.values()].filter((node) => node.type !== 'item').length,
      links: links.size,
    },
  };
}

function wiki(label) {
  return `[[${String(label || '').trim()}]]`;
}

function buildItemNote(node, graph) {
  const linkedConcepts = graph.links
    .filter((link) => link.source === node.id)
    .map((link) => graph.nodes.find((candidate) => candidate.id === link.target))
    .filter(Boolean);
  const conceptLinks = unique(linkedConcepts.map((concept) => wiki(concept.label)));

  return [
    `# ${node.label}`,
    '',
    `Source: ${node.url || ''}`,
    '',
    '## Summary',
    node.summary || 'No summary available.',
    '',
    '## Graph Links',
    conceptLinks.length ? conceptLinks.join(' ') : 'No graph links.',
    '',
    '## Collections',
    node.collections?.length ? node.collections.map(wiki).join(' ') : 'No collection.',
    '',
  ].join('\n');
}

function buildConceptNote(node, graph) {
  const linkedItems = graph.links
    .filter((link) => link.target === node.id)
    .map((link) => graph.nodes.find((candidate) => candidate.id === link.source))
    .filter(Boolean);

  return [
    `# ${node.label}`,
    '',
    `Type: ${node.type}`,
    `Linked saves: ${linkedItems.length}`,
    '',
    '## Saves',
    ...(linkedItems.length ? linkedItems.map((item) => `- ${wiki(item.label)}`) : ['No linked saves.']),
    '',
  ].join('\n');
}

function buildObsidianFiles(graph) {
  const files = [];
  for (const node of graph.nodes) {
    if (node.type === 'item') {
      files.push({
        path: `IScraper Items/${safeFileName(node.label)}.md`,
        content: buildItemNote(node, graph),
      });
    } else {
      files.push({
        path: `IScraper Graph/${safeFileName(node.label)}.md`,
        content: buildConceptNote(node, graph),
      });
    }
  }
  files.push({
    path: 'graph.json',
    content: JSON.stringify(graph, null, 2),
  });
  return files;
}

module.exports = {
  buildKnowledgeGraph,
  buildObsidianFiles,
  safeFileName,
  slugify,
};
