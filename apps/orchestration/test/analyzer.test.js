const assert = require('node:assert/strict');
const test = require('node:test');

const {
  analyzeTextMetadata,
  buildOpenRouterAnalysisRequest,
  parseOpenRouterAnalysisResponse,
  searchItems,
} = require('../src/services/analyzer');

test('analyzeTextMetadata extracts useful tech entities from caption text', () => {
  const analysis = analyzeTextMetadata({
    caption: 'OpenSpace is a GitHub repo for AI agent memory. It works with Claude Code and MCP.',
  });

  assert.equal(analysis.title, 'OpenSpace is a GitHub repo for AI agent memory');
  assert.deepEqual(analysis.brandsMentioned.sort(), ['Claude', 'GitHub', 'OpenSpace'].sort());
  assert.deepEqual(analysis.reposMentioned, ['OpenSpace']);
  assert.match(analysis.summary, /AI agent memory/);
});

test('searchItems matches exact words and related metadata fields', () => {
  const items = [
    {
      id: '1',
      caption: 'OpenSpace improves AI agent memory',
      analysis: { brandsMentioned: ['GitHub'], topics: ['agent memory'], summary: 'MCP memory server' },
    },
    {
      id: '2',
      caption: 'Photoshop workflow for ecommerce covers',
      analysis: { brandsMentioned: ['Adobe'], topics: ['design'], summary: 'Image editing workflow' },
    },
  ];

  const results = searchItems(items, 'github skills memory');

  assert.equal(results[0].id, '1');
  assert.equal(results.length, 1);
});

test('buildOpenRouterAnalysisRequest creates a structured JSON chat request without exposing secrets', () => {
  const request = buildOpenRouterAnalysisRequest({
    model: 'openai/gpt-4o-mini',
    item: { id: 'abc', caption: 'Claude Code and GitHub repo demo' },
    baseAnalysis: analyzeTextMetadata({ caption: 'Claude Code and GitHub repo demo' }),
  });

  assert.equal(request.model, 'openai/gpt-4o-mini');
  assert.equal(request.response_format.type, 'json_schema');
  assert.match(request.messages[1].content, /Claude Code/);
  assert.doesNotMatch(JSON.stringify(request), /sk-or-v1/);
});

test('parseOpenRouterAnalysisResponse extracts JSON from OpenRouter choices', () => {
  const parsed = parseOpenRouterAnalysisResponse({
    choices: [
      {
        message: {
          content: JSON.stringify({
            title: 'Claude Code repo workflow',
            summary: 'A reel about Claude Code and GitHub.',
            transcript: '',
            ocrText: '',
            visualDescription: '',
            brandsMentioned: ['Claude', 'GitHub'],
            toolsMentioned: ['Claude Code'],
            reposMentioned: ['example/repo'],
            peopleMentioned: [],
            topics: ['AI agents'],
            tags: ['Claude', 'GitHub'],
            whyUseful: 'Useful for agent tooling research.',
          }),
        },
      },
    ],
  });

  assert.equal(parsed.title, 'Claude Code repo workflow');
  assert.deepEqual(parsed.reposMentioned, ['example/repo']);
});
