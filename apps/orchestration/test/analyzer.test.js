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

test('searchItems ranks exact phrases and ignores loose numeric-only matches', () => {
  const items = [
    {
      id: 'soc2',
      caption: 'SOC 2 compliance checklist for security audits',
      analysis: {
        title: 'SOC 2 compliance checklist',
        ocrText: 'SOC 2 security controls and audit evidence',
        topics: ['security compliance'],
        tags: ['SOC 2'],
      },
    },
    {
      id: 'promo2',
      caption: '2 quick ways to improve a promotional reel',
      analysis: {
        title: 'Quickshot AI Promotional Reel',
        summary: 'Marketing content tips',
        topics: ['content'],
        tags: ['marketing'],
      },
    },
    {
      id: 'traffic',
      caption: 'Free Google traffic for startups',
      analysis: {
        title: 'Free Google Traffic for Startups',
        summary: 'Growth tactic',
        topics: ['growth'],
        tags: ['startup'],
      },
    },
  ];

  const results = searchItems(items, 'SOC 2');

  assert.deepEqual(results.map((item) => item.id), ['soc2']);
});

test('searchItems expands broad security queries to compliance concepts', () => {
  const items = [
    {
      id: 'soc2',
      caption: 'SOC 2 audit checklist for privacy controls',
      analysis: {
        title: 'SOC 2 compliance checklist',
        ocrText: 'Access controls, audit evidence, data protection',
        topics: ['compliance'],
        tags: ['SOC 2'],
      },
    },
    {
      id: 'design',
      caption: 'Landing page color palette ideas',
      analysis: {
        title: 'Color palette inspiration',
        summary: 'Branding and visual design ideas',
        topics: ['design'],
        tags: ['branding'],
      },
    },
    {
      id: 'promo2',
      caption: '2 quick ways to improve a promotional reel',
      analysis: {
        title: 'Quickshot AI Promotional Reel',
        summary: 'Marketing content tips',
        topics: ['content'],
        tags: ['marketing'],
      },
    },
  ];

  const results = searchItems(items, 'security');

  assert.deepEqual(results.map((item) => item.id), ['soc2']);
});

test('buildOpenRouterAnalysisRequest creates a structured JSON chat request without exposing secrets', () => {
  const request = buildOpenRouterAnalysisRequest({
    model: 'deepseek/deepseek-v4-pro',
    item: { id: 'abc', caption: 'Claude Code and GitHub repo demo' },
    baseAnalysis: analyzeTextMetadata({ caption: 'Claude Code and GitHub repo demo' }),
  });

  assert.equal(request.model, 'deepseek/deepseek-v4-pro');
  assert.equal(request.response_format.type, 'json_schema');
  assert.match(request.messages[1].content, /Claude Code/);
  assert.match(request.messages[1].content, /Do not copy the caption/);
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
