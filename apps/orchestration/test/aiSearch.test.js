const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildOpenAiWebSearchRequest,
  buildOpenRouterLibraryChatRequest,
  buildOpenRouterSearchAnswerRequest,
  createOpenAiWebSearchAnswer,
  createOpenRouterLibraryChatAnswer,
  createOpenRouterSearchAnswer,
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

test('buildOpenRouterSearchAnswerRequest asks for grounded JSON only', () => {
  const request = buildOpenRouterSearchAnswerRequest({
    model: 'deepseek/deepseek-v4-pro',
    query: 'security audit',
    results: [
      {
        id: 'save-1',
        analysis: { title: 'SOC 2 checklist', summary: 'Security controls' },
      },
    ],
  });

  assert.equal(request.model, 'deepseek/deepseek-v4-pro');
  assert.equal(request.response_format.type, 'json_object');
  assert.match(request.messages[0].content, /Never invent/);
  assert.match(request.messages[0].content, /30-50 word answer/);
  assert.match(request.messages[0].content, /best matching saved item/);
  assert.match(request.messages[1].content, /security audit/);
});

test('buildOpenAiWebSearchRequest includes saved snippets and web search tool', () => {
  const request = buildOpenAiWebSearchRequest({
    model: 'gpt-4o',
    question: 'What is an AI engine?',
    messages: [{ role: 'user', content: 'Earlier question' }],
    results: [
      {
        id: 'save-1',
        url: 'https://example.com/ai',
        analysis: { title: 'Saved AI note', summary: 'AI engine explainer' },
      },
    ],
  });

  assert.equal(request.model, 'gpt-4o');
  assert.equal(request.tools[0].type, 'web_search_preview');
  assert.match(request.input[0].content, /Search the web/);
  const payload = JSON.parse(request.input[1].content);
  assert.equal(payload.question, 'What is an AI engine?');
  assert.equal(payload.savedLibrarySnippets[0].id, 'save-1');
});

test('buildOpenRouterLibraryChatRequest keeps follow-ups grounded in saved snippets', () => {
  const request = buildOpenRouterLibraryChatRequest({
    model: 'deepseek/deepseek-v4-pro',
    question: 'Which saved item should I use next?',
    messages: [
      { role: 'user', content: 'Find security saves' },
      { role: 'assistant', content: 'SOC 2 is relevant.' },
      { role: 'system', content: 'ignored' },
    ],
    results: [
      {
        id: 'save-1',
        analysis: { title: 'SOC 2 checklist', summary: 'Security controls' },
      },
    ],
  });

  const payload = JSON.parse(request.messages[1].content);
  assert.equal(request.model, 'deepseek/deepseek-v4-pro');
  assert.equal(request.response_format.type, 'json_object');
  assert.match(request.messages[0].content, /using only the provided saved-library snippets/);
  assert.deepEqual(payload.conversation, [
    { role: 'user', content: 'Find security saves' },
    { role: 'assistant', content: 'SOC 2 is relevant.' },
  ]);
  assert.equal(payload.snippets[0].id, 'save-1');
});

test('createOpenRouterSearchAnswer returns normalized grounded answer', async () => {
  const answer = await createOpenRouterSearchAnswer({
    apiKey: 'test-key',
    model: 'deepseek/deepseek-v4-pro',
    query: 'security audit',
    results: [
      {
        id: 'save-1',
        analysis: { title: 'SOC 2 checklist', summary: 'Security controls' },
      },
    ],
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
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

test('createOpenRouterLibraryChatAnswer returns citations from retrieved saves only', async () => {
  const answer = await createOpenRouterLibraryChatAnswer({
    apiKey: 'test-key',
    model: 'deepseek/deepseek-v4-pro',
    question: 'What should I use for audit prep?',
    messages: [{ role: 'user', content: 'Find security saves' }],
    results: [
      {
        id: 'save-1',
        url: 'https://example.com/soc2',
        analysis: { title: 'SOC 2 checklist', summary: 'Security controls' },
      },
    ],
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.match(options.headers.Authorization, /Bearer test-key/);
      const request = JSON.parse(options.body);
      assert.match(request.messages[0].content, /IScraper library assistant/);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: 'Use the SOC 2 checklist save for audit prep.',
                  citations: [
                    { id: 'save-1', reason: 'It mentions security controls.', snippet: 'Security controls' },
                    { id: 'missing', reason: 'Should be removed.', snippet: 'Nope' },
                  ],
                  suggestions: ['show me control evidence'],
                }),
              },
            },
          ],
        }),
      };
    },
  });

  assert.equal(answer.answer, 'Use the SOC 2 checklist save for audit prep.');
  assert.deepEqual(answer.citations, [
    {
      id: 'save-1',
      title: 'SOC 2 checklist',
      url: 'https://example.com/soc2',
      reason: 'It mentions security controls.',
      snippet: 'Security controls',
    },
  ]);
  assert.deepEqual(answer.suggestions, ['show me control evidence']);
});

test('createOpenAiWebSearchAnswer returns web citations from Responses API annotations', async () => {
  const answer = await createOpenAiWebSearchAnswer({
    apiKey: 'test-key',
    model: 'gpt-4o',
    question: 'What is an AI engine?',
    results: [
      {
        id: 'save-1',
        analysis: { title: 'Saved AI note', summary: 'AI engine explainer' },
      },
    ],
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.match(options.headers.Authorization, /Bearer test-key/);
      const request = JSON.parse(options.body);
      assert.equal(request.tools[0].type, 'web_search_preview');
      return {
        ok: true,
        json: async () => ({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'An AI engine is the runtime and model layer that powers AI features.',
                  annotations: [
                    {
                      type: 'url_citation',
                      url: 'https://example.com/ai-engine',
                      title: 'AI Engine overview',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      };
    },
  });

  assert.equal(answer.answer, 'An AI engine is the runtime and model layer that powers AI features.');
  assert.deepEqual(answer.webCitations, [
    {
      url: 'https://example.com/ai-engine',
      title: 'AI Engine overview',
      snippet: '',
    },
  ]);
  assert.equal(answer.mode, 'web');
});

test('createOpenRouterSearchAnswer repairs common JSON formatting issues', async () => {
  const answer = await createOpenRouterSearchAnswer({
    apiKey: 'test-key',
    model: 'deepseek/deepseek-v4-pro',
    query: 'security audit',
    results: [
      {
        id: 'save-1',
        analysis: { title: 'SOC 2 checklist', summary: 'Security controls' },
      },
    ],
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                '```json',
                '{',
                '  "answer": "Use the SOC 2 checklist.",',
                '  "citations": [{"id":"save-1","reason":"It mentions controls.","snippet":"Security controls",}],',
                '  "suggestions": [],',
                '}',
                '```',
              ].join('\n'),
            },
          },
        ],
      }),
    }),
  });

  assert.equal(answer.answer, 'Use the SOC 2 checklist.');
  assert.equal(answer.citations[0].id, 'save-1');
});

test('createOpenRouterSearchAnswer retries without JSON mode when content is empty', async () => {
  const requests = [];
  const answer = await createOpenRouterSearchAnswer({
    apiKey: 'test-key',
    model: 'deepseek/deepseek-v4-pro',
    query: 'security audit',
    results: [
      {
        id: 'save-1',
        analysis: { title: 'SOC 2 checklist', summary: 'Security controls' },
      },
    ],
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: '' } }] }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'Use the SOC 2 checklist save for audit prep.',
              },
            },
          ],
        }),
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, 'json_object');
  assert.equal(requests[1].response_format, undefined);
  assert.equal(answer.answer, 'Use the SOC 2 checklist save for audit prep.');
  assert.equal(answer.citations[0].id, 'save-1');
});
