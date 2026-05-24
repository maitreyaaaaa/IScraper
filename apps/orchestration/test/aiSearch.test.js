const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDeepSeekSearchAnswerRequest,
  createDeepSeekSearchAnswer,
  publicResultSnippet,
} = require('../src/services/aiSearch');

test('publicResultSnippet keeps only useful searchable fields', () => {
  const snippet = publicResultSnippet({
    id: 'save-1',
    url: 'https://example.com/post',
    platform: 'Instagram',
    caption: 'Long caption about SOC 2',
    analysis: {
      title: 'SOC 2 checklist',
      summary: 'Security audit checklist',
      transcript: 'Controls, evidence, and readiness',
      topics: ['security'],
      tags: ['SOC 2'],
      whyUseful: 'Useful for audit prep',
    },
  }, 0);

  assert.equal(snippet.id, 'save-1');
  assert.equal(snippet.rank, 1);
  assert.equal(snippet.title, 'SOC 2 checklist');
  assert.deepEqual(snippet.topics, ['security']);
});

test('buildDeepSeekSearchAnswerRequest asks for grounded JSON only', () => {
  const request = buildDeepSeekSearchAnswerRequest({
    model: 'deepseek-v4-flash',
    query: 'security audit',
    results: [
      {
        id: 'save-1',
        analysis: { title: 'SOC 2 checklist', summary: 'Security controls' },
      },
    ],
  });

  assert.equal(request.model, 'deepseek-v4-flash');
  assert.equal(request.response_format.type, 'json_object');
  assert.match(request.messages[0].content, /Never invent/);
  assert.match(request.messages[1].content, /security audit/);
});

test('createDeepSeekSearchAnswer returns normalized grounded answer', async () => {
  const answer = await createDeepSeekSearchAnswer({
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    query: 'security audit',
    results: [
      {
        id: 'save-1',
        analysis: { title: 'SOC 2 checklist', summary: 'Security controls' },
      },
    ],
    fetchImpl: async (_url, options) => {
      assert.match(options.headers.Authorization, /Bearer test-key/);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: 'This saved post is about SOC 2 security controls.',
                  resultReasons: [
                    { id: 'save-1', reason: 'It directly mentions SOC 2 and security controls.' },
                    { id: 'unknown', reason: 'Should be removed.' },
                  ],
                  suggestions: ['audit checklist'],
                }),
              },
            },
          ],
        }),
      };
    },
  });

  assert.equal(answer.answer, 'This saved post is about SOC 2 security controls.');
  assert.deepEqual(answer.resultReasons, [
    { id: 'save-1', reason: 'It directly mentions SOC 2 and security controls.' },
  ]);
  assert.deepEqual(answer.citations, [
    {
      id: 'save-1',
      title: 'SOC 2 checklist',
      url: '',
      reason: 'It directly mentions SOC 2 and security controls.',
      snippet: 'Security controls',
    },
  ]);
  assert.deepEqual(answer.suggestions, ['audit checklist']);
});
