const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');

const { createApp } = require('../src/server');
const { createLocalStore } = require('../src/stores/localStore');
const {
  EXCLUDED_USER_DATA_TABLES,
  SECRET_LIFECYCLE_RULES,
  TABLE_DATA_CLASSIFICATIONS,
  USER_DATA_CATEGORIES,
} = require('../src/services/userDataRegistry');

async function waitForDataExportReady({ base, headers, id, attempts = 20 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(`${base}/data-exports/${id}`, { headers });
    const body = await response.json();
    if (body.export?.status === 'ready') return body.export;
    if (body.export?.status === 'failed') throw new Error(body.export.errorMessage || 'Data export failed.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Data export did not become ready.');
}

test('user data registry covers known user-owned data tables', () => {
  const represented = new Set(USER_DATA_CATEGORIES.flatMap((category) => category.tables));
  const excluded = new Set(EXCLUDED_USER_DATA_TABLES.map((entry) => entry.table));
  [
    'users',
    'user_profiles',
    'user_onboarding_preferences',
    'saved_items',
    'imports',
    'item_assets',
    'search_events',
    'user_activity_events',
    'analysis_usage_events',
    'user_provider_credentials',
    'extension_tokens',
    'capture_connections',
    'credit_transactions',
    'account_deletion_requests',
    'user_data_export_requests',
  ].forEach((table) => {
    assert.ok(represented.has(table) || excluded.has(table), `${table} must be represented or explicitly excluded`);
    assert.ok(TABLE_DATA_CLASSIFICATIONS[table], `${table} must have a data classification`);
  });

  const allowed = new Set(['public', 'account', 'private_content', 'credential', 'billing', 'audit', 'operational']);
  USER_DATA_CATEGORIES.forEach((category) => {
    assert.ok(allowed.has(category.classification), `${category.key} has invalid classification`);
    assert.ok(category.purpose, `${category.key} must define why the data exists`);
    assert.ok(category.retentionPeriod || category.retention, `${category.key} must define retention`);
    assert.ok(category.minimization, `${category.key} must define minimization`);
    assert.ok(category.redaction, `${category.key} must define redaction`);
  });

  ['user_provider_credentials', 'extension_tokens', 'capture_connections', 'user_ai_keys'].forEach((table) => {
    assert.equal(TABLE_DATA_CLASSIFICATIONS[table], 'credential');
  });

  SECRET_LIFECYCLE_RULES.forEach((rule) => {
    assert.equal(rule.classification, 'credential');
    assert.match(`${rule.storage} ${rule.exposure} ${rule.lifecycle} ${rule.exportRule}`, /hash|encrypt|shown once|revok/i);
    assert.match(rule.exportRule, /Never export|metadata only/i);
  });
});

test('API responses include a restrictive content security policy', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/credit-packages`);
    const csp = response.headers.get('content-security-policy') || '';

    assert.equal(response.status, 200);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co https:\/\/us\.i\.posthog\.com https:\/\/eu\.i\.posthog\.com/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('health endpoint returns aggregate runtime status only', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-request-id') || '', /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,127}$/);
    assert.deepEqual(Object.keys(body).sort(), ['runtime', 'status', 'timestamp']);
    assert.equal(body.status, 'ok');
    assert.deepEqual(Object.keys(body.runtime).sort(), ['coldStart', 'processUptimeMs']);
    assert.equal(typeof body.runtime.coldStart, 'boolean');
    assert.equal(typeof body.runtime.processUptimeMs, 'number');
    assert.equal(typeof body.timestamp, 'string');
    assert.equal(JSON.stringify(body).includes('SUPABASE'), false);
    assert.equal(JSON.stringify(body).includes('TOKEN'), false);
    assert.equal(JSON.stringify(body).includes('phase6'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API request and correlation IDs propagate through manual save jobs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const headers = {
      'Content-Type': 'application/json',
      'X-Request-ID': 'req-test-1234',
      'X-Correlation-ID': 'corr-test-1234',
    };
    const response = await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'https://example.com/article', title: 'Example article' }),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-request-id'), 'req-test-1234');
    assert.equal(response.headers.get('x-correlation-id'), 'corr-test-1234');
    assert.equal(body.requestId, 'req-test-1234');
    assert.equal(body.correlationId, 'corr-test-1234');
    assert.equal(body.import.requestId, 'req-test-1234');
    assert.equal(body.import.correlationId, 'corr-test-1234');
    assert.equal(body.indexing.requestId, 'req-test-1234');
    assert.equal(body.indexing.correlationId, 'corr-test-1234');

    const jobs = store.getJobs('local-dev-user', body.import.id);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].requestId, 'req-test-1234');
    assert.equal(jobs[0].correlationId, 'corr-test-1234');
    assert.equal(jobs[0].sourceAction, 'manual-link');
    assert.ok(jobs[0].referenceId);

    const jobResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/${jobs[0].id}`, { headers });
    const jobBody = await jobResponse.json();
    assert.equal(jobResponse.status, 200);
    assert.equal(jobBody.job.correlationId, 'corr-test-1234');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid request IDs are replaced and safe error responses include references', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/jobs/missing-job`, {
      method: 'GET',
      headers: {
        'X-Request-ID': 'bad',
        'X-Correlation-ID': 'also bad',
      },
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.match(response.headers.get('x-request-id') || '', /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,127}$/);
    assert.equal(response.headers.get('x-correlation-id'), response.headers.get('x-request-id'));
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(body.correlationId, response.headers.get('x-request-id'));
    assert.equal(JSON.stringify(body).includes('secret'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authenticated middleware caches user setup while preserving deletion safety checks', async () => {
  let authCalls = 0;
  let safetyCalls = 0;
  let setupCalls = 0;
  const store = {
    requiresAuth: true,
    async getUserFromToken(token) {
      authCalls += 1;
      assert.equal(token, 'session-token');
      return { id: 'auth-cache-user', email: 'cache@example.com' };
    },
    async assertUserNotDeleted(userId, email) {
      safetyCalls += 1;
      assert.equal(userId, 'auth-cache-user');
      assert.equal(email, 'cache@example.com');
    },
    async ensureUserRecord(userId, email) {
      setupCalls += 1;
      assert.equal(userId, 'auth-cache-user');
      assert.equal(email, 'cache@example.com');
    },
    async getProfile() {
      return { username: 'cache_user' };
    },
  };
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const headers = { Authorization: 'Bearer session-token' };
    const first = await fetch(`http://127.0.0.1:${port}/api/profile`, { headers });
    const second = await fetch(`http://127.0.0.1:${port}/api/profile`, { headers });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(authCalls, 1);
    assert.equal(setupCalls, 1);
    assert.equal(safetyCalls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('no-AI search uses lean keyword path without semantic provider lookup', async () => {
  let leanCalls = 0;
  let fullSearchCalls = 0;
  let providerLookups = 0;
  let searchEvents = 0;
  const store = {
    supportsSemanticSearch: true,
    ensureUserRecord() {},
    async getPreferredProviderCredential() {
      providerLookups += 1;
      return null;
    },
    async search() {
      fullSearchCalls += 1;
      return [];
    },
    async searchLean(userId, query, filters) {
      leanCalls += 1;
      assert.equal(userId, 'local-dev-user');
      assert.equal(query, 'SOC 2');
      assert.deepEqual(filters, {});
      return [{
        id: 'lean-1',
        sourceTitle: 'SOC 2 checklist',
        searchMatch: { matchedFields: [{ label: 'Title' }], matchTypes: ['keyword'] },
      }];
    },
    async recordSearchEvent({ resultIds, includeAi }) {
      searchEvents += 1;
      assert.deepEqual(resultIds, ['lean-1']);
      assert.equal(includeAi, false);
    },
  };
  const app = createApp({ store, config: { credentialEncryptionKey: 'test-key' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SOC 2', includeAi: false }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.results.length, 1);
    assert.equal(leanCalls, 1);
    assert.equal(fullSearchCalls, 0);
    assert.equal(providerLookups, 0);
    assert.equal(searchEvents, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('AI search returns inline grounded answer with saved citations', async () => {
  let searchEvents = 0;
  const store = {
    supportsSemanticSearch: false,
    ensureUserRecord() {},
    async searchLean() {
      return [{
        id: 'save-1',
        url: 'https://example.com/soc2',
        sourceTitle: 'SOC 2 checklist',
        sourceDescription: 'Security controls and audit readiness notes.',
        platform: 'Web',
        analysis: {
          title: 'SOC 2 checklist',
          summary: 'Security controls and audit readiness notes.',
          topics: ['security'],
        },
      }];
    },
    async search() {
      return [];
    },
    async recordSearchEvent({ resultIds, includeAi }) {
      searchEvents += 1;
      assert.deepEqual(resultIds, ['save-1']);
      assert.equal(includeAi, true);
    },
  };
  const app = createApp({
    store,
    config: {
      openAiApiKey: 'test-openai-key',
      aiSearchModel: 'test-model',
      aiSearchTimeoutMs: 1000,
    },
  });
  const server = app.listen(0);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.openai.com/')) {
      const request = JSON.parse(options.body);
      assert.match(request.messages[0].content, /best matching saved item/);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              answer: 'Use the SOC 2 checklist save for audit prep because it directly covers security controls and readiness notes.',
              citations: [{ id: 'save-1', reason: 'It directly covers audit controls.', snippet: 'Security controls and audit readiness notes.' }],
              resultReasons: [{ id: 'save-1', reason: 'Best match for audit prep.' }],
              suggestions: ['Ask what to do next'],
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(url, options);
  };

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SOC 2 audit', includeAi: true }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.results.length, 1);
    assert.equal(body.ai.answer, 'Use the SOC 2 checklist save for audit prep because it directly covers security controls and readiness notes.');
    assert.equal(body.ai.citations[0].id, 'save-1');
    assert.equal(body.ai.citations[0].url, 'https://example.com/soc2');
    assert.equal(searchEvents, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CORS does not allow arbitrary origins when allowlist is empty', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { corsOrigins: [] } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/credit-packages`, {
      headers: { Origin: 'https://evil.example' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CORS allows explicitly configured origins', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { corsOrigins: ['https://app.example'] } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/credit-packages`, {
      headers: { Origin: 'https://app.example' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('account deletion request is user-scoped, deduplicated, and blocks risky activity', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const headers = { 'Content-Type': 'application/json', 'x-user-id': 'delete-user', 'x-user-email': 'delete@example.com' };

    const first = await fetch(`${base}/account/deletion`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'testing', exportConfirmed: true }),
    });
    const firstBody = await first.json();
    assert.equal(first.status, 201);
    assert.equal(firstBody.deletion.request.status, 'pending_approval');

    const second = await fetch(`${base}/account/deletion`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'testing again', exportConfirmed: true }),
    });
    const secondBody = await second.json();
    assert.equal(second.status, 201);
    assert.equal(secondBody.deletion.request.id, firstBody.deletion.request.id);

    const blocked = await fetch(`${base}/saves/link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'https://example.com/post', title: 'Blocked save' }),
    });
    assert.equal(blocked.status, 423);

    const exportResponse = await fetch(`${base}/privacy-export`, { headers });
    const exportBody = await exportResponse.json();
    assert.equal(exportResponse.status, 200);
    assert.ok(Array.isArray(exportBody.export.items));

    const cancel = await fetch(`${base}/account/deletion/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const cancelBody = await cancel.json();
    assert.equal(cancel.status, 200);
    assert.equal(cancelBody.deletion.request.status, 'canceled');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queued data export creates a redacted downloadable zip and enforces ownership', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { workerApiKey: 'worker-secret' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const headers = { 'Content-Type': 'application/json', 'x-user-id': 'export-user', 'x-user-email': 'export@example.com' };
    const otherHeaders = { 'Content-Type': 'application/json', 'x-user-id': 'other-user', 'x-user-email': 'other@example.com' };

    const tokenResponse = await fetch(`${base}/extension-tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Browser test token', scopes: ['saves:create'] }),
    });
    const tokenBody = await tokenResponse.json();
    assert.equal(tokenResponse.status, 201);
    assert.ok(tokenBody.secret);

    const saveResponse = await fetch(`${base}/saves/link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'https://example.com/exported', title: 'Exported save', review: true }),
    });
    assert.equal(saveResponse.status, 201);

    const onboardingResponse = await fetch(`${base}/onboarding`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contentTypes: ['instagram', 'notes'], referralSource: 'youtube' }),
    });
    assert.equal(onboardingResponse.status, 200);

    const mapResponse = await fetch(`${base}/user-data-map`, { headers });
    const mapBody = await mapResponse.json();
    assert.equal(mapResponse.status, 200);
    const accessCategory = mapBody.dataMap.categories.find((category) => category.key === 'access');
    assert.ok(accessCategory);
    assert.equal(accessCategory.classification, 'credential');
    assert.match(accessCategory.purpose, /connect/i);
    assert.match(accessCategory.retentionPeriod, /revoked|expired|deleted/i);
    assert.match(accessCategory.minimization, /metadata/i);
    assert.equal(mapBody.dataMap.classifications.extension_tokens, 'credential');
    assert.ok(mapBody.dataMap.secretLifecycle.find((rule) => rule.key === 'extension_and_agent_tokens'));

    const accountResponse = await fetch(`${base}/account/summary`, { headers });
    const accountBody = await accountResponse.json();
    assert.equal(accountResponse.status, 200);
    assert.match(accountBody.account.publicRef, /^usr_/);

    const createResponse = await fetch(`${base}/data-exports`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const createBody = await createResponse.json();
    assert.equal(createResponse.status, 202);
    assert.ok(['requested', 'building', 'ready'].includes(createBody.export.status));
    assert.equal(createBody.export.storageBucket, undefined);
    assert.equal(createBody.export.storagePath, undefined);

    const otherStatus = await fetch(`${base}/data-exports/${createBody.export.id}`, { headers: otherHeaders });
    assert.equal(otherStatus.status, 404);

    await fetch(`${base}/worker/process-one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-api-key': 'worker-secret' },
      body: JSON.stringify({}),
    });
    const readyExport = await waitForDataExportReady({ base, headers, id: createBody.export.id });
    assert.equal(readyExport.status, 'ready');
    assert.ok(readyExport.steps.length >= 5);
    assert.equal(readyExport.storagePath, undefined);

    const downloadResponse = await fetch(`${base}/data-exports/${createBody.export.id}/download`, { headers });
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get('content-type'), 'application/zip');

    const zip = await JSZip.loadAsync(Buffer.from(await downloadResponse.arrayBuffer()));
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const accountFile = JSON.parse(await zip.file('account/profile.json').async('string'));
    const extensionTokens = JSON.parse(await zip.file('access/extension-tokens.json').async('string'));
    const zipText = (await Promise.all(Object.values(zip.files).filter((file) => !file.dir).map((file) => file.async('string')))).join('\n');

    assert.equal(manifest.format, 'zip');
    assert.equal(manifest.categories.find((category) => category.key === 'access').classification, 'credential');
    assert.deepEqual(accountFile.onboarding.contentTypes, ['instagram', 'notes']);
    assert.equal(accountFile.onboarding.referralSource, 'youtube');
    assert.equal(extensionTokens.length, 1);
    assert.equal(extensionTokens[0].tokenHash, undefined);
    assert.equal(zipText.includes(tokenBody.secret), false);
    assert.equal(/token_hash|encrypted_key|service_role/i.test(zipText), false);

    const securityResponse = await fetch(`${base}/account/security-activity`, { headers });
    const securityBody = await securityResponse.json();
    assert.equal(securityResponse.status, 200);
    assert.equal(securityBody.activity.some((entry) => entry.eventType === 'data_export_requested'), true);
    assert.equal(JSON.stringify(securityBody.activity).includes(tokenBody.secret), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data export includes uploaded files only when explicitly requested', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { workerApiKey: 'worker-secret' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const headers = { 'Content-Type': 'application/json', 'x-user-id': 'media-export-user', 'x-user-email': 'media@example.com' };
    store.ensureUser('media-export-user', 'media@example.com');
    const item = store.createNoteItem('media-export-user', {
      id: 'media-item',
      url: 'note:media-item',
      contentType: 'note',
      caption: 'Media item',
      hashtags: [],
      collections: [],
      status: 'done',
    });
    store.addItemAsset('media-export-user', item.id, {
      id: 'media-asset',
      storagePath: 'data:text/plain;base64,aGVsbG8=',
      mimeType: 'text/plain',
    });

    const metadataOnly = await fetch(`${base}/data-exports`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const metadataOnlyBody = await metadataOnly.json();
    assert.equal(metadataOnly.status, 202);
    await fetch(`${base}/worker/process-one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-api-key': 'worker-secret' },
      body: JSON.stringify({}),
    });
    await waitForDataExportReady({ base, headers, id: metadataOnlyBody.export.id });
    const metadataZipResponse = await fetch(`${base}/data-exports/${metadataOnlyBody.export.id}/download`, { headers });
    const metadataZip = await JSZip.loadAsync(Buffer.from(await metadataZipResponse.arrayBuffer()));
    assert.equal(Boolean(metadataZip.file('media-manifest.json')), false);

    const withFiles = await fetch(`${base}/data-exports`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ includeFiles: true }),
    });
    const withFilesBody = await withFiles.json();
    assert.equal(withFiles.status, 202);
    await fetch(`${base}/worker/process-one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-api-key': 'worker-secret' },
      body: JSON.stringify({}),
    });
    await waitForDataExportReady({ base, headers, id: withFilesBody.export.id });
    const withFilesZipResponse = await fetch(`${base}/data-exports/${withFilesBody.export.id}/download`, { headers });
    const withFilesZip = await JSZip.loadAsync(Buffer.from(await withFilesZipResponse.arrayBuffer()));
    const mediaManifest = JSON.parse(await withFilesZip.file('media-manifest.json').async('string'));

    assert.equal(mediaManifest.files.length, 1);
    assert.equal(await withFilesZip.file(mediaManifest.files[0].zipPath).async('string'), 'hello');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('search logs no-result queries and validates per-result feedback scope', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.ensureUser('search-user', 'search@example.com');
  store.upsertImportData({
    userId: 'search-user',
    importId: null,
    parsed: {
      collections: [],
      items: [
        {
          id: 'save-1',
          url: 'https://example.com/soc2',
          contentType: 'post',
          caption: 'SOC 2 compliance checklist',
          hashtags: [],
          ownerName: '',
          ownerUsername: '',
          savedAt: '',
          collections: [],
          platform: 'Instagram',
          platformKey: 'instagram',
          sourceId: 'save-1',
          sourceTitle: 'SOC 2 checklist',
          sourceAuthor: 'security-team',
          sourceDescription: 'Security controls and audit evidence',
          thumbnailUrl: '',
        },
      ],
    },
    initialStatus: 'done',
  });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const headers = { 'Content-Type': 'application/json', 'x-user-id': 'search-user', 'x-user-email': 'search@example.com' };

    const empty = await fetch(`${base}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'kubernetes recipes' }),
    });
    const emptyBody = await empty.json();
    assert.equal(empty.status, 200);
    assert.equal(emptyBody.results.length, 0);

    const matched = await fetch(`${base}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'SOC 2' }),
    });
    const matchedBody = await matched.json();
    assert.equal(matched.status, 200);
    assert.equal(matchedBody.results.length, 1);
    assert.equal(matchedBody.results[0].searchMatch.matchedFields[0].label, 'Title');

    const feedback = await fetch(`${base}/search/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        searchEventId: matchedBody.searchEventId,
        itemId: 'save-1',
        rating: 'helpful',
      }),
    });
    assert.equal(feedback.status, 201);

    const invalidFeedback = await fetch(`${base}/search/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        searchEventId: matchedBody.searchEventId,
        itemId: 'missing-save',
        rating: 'helpful',
      }),
    });
    assert.equal(invalidFeedback.status, 404);

    const privacy = store.getPrivacyExport('search-user');
    assert.equal(privacy.searchEvents.length, 2);
    assert.equal(privacy.searchEvents.find((event) => event.resultCount === 0).query, 'kubernetes recipes');
    assert.equal(privacy.searchEvents.find((event) => event.resultCount === 1).query, '');
    assert.equal(privacy.searchFeedback.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('library chat returns a grounded no-results answer without calling AI', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.ensureUser('chat-user', 'chat@example.com');
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/library-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'chat-user', 'x-user-email': 'chat@example.com' },
      body: JSON.stringify({ question: 'unmatched library chat question', messages: [] }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.results.length, 0);
    assert.equal(body.ai.citations.length, 0);
    assert.match(body.ai.answer, /could not find enough matching saves/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('items API keeps full-list compatibility and supports paginated library queries', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.ensureUser('page-user', 'page@example.com');
  store.upsertImportData({
    userId: 'page-user',
    importId: 'page-import',
    parsed: {
      collections: [],
      items: [
        {
          id: 'post-a',
          url: 'https://instagram.com/p/a',
          contentType: 'post',
          caption: 'Post A',
          collections: ['Ideas'],
          platform: 'Instagram',
          platformKey: 'instagram',
          sourceTitle: 'A post',
        },
        {
          id: 'web-b',
          url: 'https://example.com/b',
          contentType: 'link',
          caption: 'Web B',
          collections: ['Research'],
          platform: 'Web',
          platformKey: 'web',
          sourceTitle: 'B link',
        },
      ],
    },
    initialStatus: 'done',
  });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const headers = { 'x-user-id': 'page-user', 'x-user-email': 'page@example.com' };
    const full = await fetch(`http://127.0.0.1:${port}/api/items`, { headers });
    const fullBody = await full.json();
    assert.equal(full.status, 200);
    assert.equal(fullBody.items.length, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(fullBody, 'nextCursor'), false);

    const page = await fetch(`http://127.0.0.1:${port}/api/items?limit=1&sort=title&type=links`, { headers });
    const pageBody = await page.json();
    assert.equal(page.status, 200);
    assert.equal(pageBody.items.length, 1);
    assert.equal(pageBody.items[0].id, 'web-b');
    assert.equal(pageBody.totalCount, 1);
    assert.equal(pageBody.nextCursor, null);
    assert.deepEqual(pageBody.facets.platforms, ['all', 'Instagram', 'Web']);
    assert.ok(pageBody.serverTime);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('similar visuals endpoint returns user-scoped visual matches', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.ensureUser('visual-user', 'visual@example.com');
  store.ensureUser('other-user', 'other@example.com');
  store.upsertImportData({
    userId: 'visual-user',
    importId: 'visual-import',
    parsed: {
      collections: [],
      items: [
        {
          id: 'source-kitchen',
          url: 'https://instagram.com/p/source-kitchen',
          contentType: 'post',
          caption: 'Kitchen inspiration',
          collections: ['Home'],
          platform: 'Instagram',
          platformKey: 'instagram',
          sourceTitle: 'Kitchen moodboard',
          thumbnailUrl: 'https://example.com/source.jpg',
        },
        {
          id: 'related-kitchen',
          url: 'https://pinterest.com/pin/related-kitchen',
          contentType: 'pin',
          caption: 'Green cabinets and brass hardware',
          collections: ['Home'],
          platform: 'Pinterest',
          platformKey: 'pinterest',
          sourceTitle: 'Green cabinet idea',
          thumbnailUrl: 'https://example.com/related.jpg',
        },
        {
          id: 'unrelated-fitness',
          url: 'https://instagram.com/p/unrelated-fitness',
          contentType: 'post',
          caption: 'Workout routine',
          collections: ['Fitness'],
          platform: 'Instagram',
          platformKey: 'instagram',
          sourceTitle: 'Workout routine',
          thumbnailUrl: 'https://example.com/fitness.jpg',
        },
      ],
    },
    initialStatus: 'done',
  });
  store.upsertImportData({
    userId: 'other-user',
    importId: 'other-import',
    parsed: {
      collections: [],
      items: [
        {
          id: 'other-kitchen',
          url: 'https://instagram.com/p/other-kitchen',
          contentType: 'post',
          caption: 'Other user kitchen',
          collections: ['Home'],
          platform: 'Instagram',
          platformKey: 'instagram',
          sourceTitle: 'Other kitchen',
          thumbnailUrl: 'https://example.com/other.jpg',
        },
      ],
    },
    initialStatus: 'done',
  });
  store.saveAnalysis('visual-user', 'source-kitchen', {
    title: 'Kitchen moodboard',
    summary: 'A warm home kitchen reference.',
    visualDescription: 'Warm kitchen shelves, brass hardware, marble island, green cabinets.',
    topics: ['interior design', 'kitchen'],
    tags: ['home', 'brass'],
  });
  store.saveAnalysis('visual-user', 'related-kitchen', {
    title: 'Green cabinet idea',
    summary: 'Another kitchen image.',
    visualDescription: 'Green cabinets with brass pulls beside a marble kitchen counter.',
    topics: ['kitchen', 'interior design'],
    tags: ['brass'],
  });
  store.saveAnalysis('visual-user', 'unrelated-fitness', {
    title: 'Workout routine',
    summary: 'Exercise setup.',
    visualDescription: 'Gym bench, dumbbells, running shoes, and a timer.',
    topics: ['fitness'],
    tags: ['training'],
  });
  store.saveAnalysis('other-user', 'other-kitchen', {
    title: 'Other kitchen',
    visualDescription: 'Green cabinets with brass hardware.',
    topics: ['kitchen'],
    tags: ['brass'],
  });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const headers = { 'x-user-id': 'visual-user', 'x-user-email': 'visual@example.com' };
    const response = await fetch(`http://127.0.0.1:${port}/api/items/source-kitchen/similar-visuals`, { headers });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.item.id, 'source-kitchen');
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].item.id, 'related-kitchen');
    assert.ok(body.results[0].similarity.score > 0);
    assert.equal(body.results.some((entry) => entry.item.id === 'other-kitchen'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin approval and deletion processing are idempotent and prevent account recreation', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { adminApiKey: 'admin-secret' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const userHeaders = { 'Content-Type': 'application/json', 'x-user-id': 'delete-user', 'x-user-email': 'delete@example.com' };
    const adminHeaders = { 'Content-Type': 'application/json', 'x-admin-api-key': 'admin-secret', 'x-admin-actor': 'security-admin' };

    const created = await fetch(`${base}/account/deletion`, {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({ exportConfirmed: true }),
    });
    const createdBody = await created.json();
    const requestId = createdBody.deletion.request.id;

    const approve = await fetch(`${base}/admin/deletion-requests/${requestId}/approve`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    const approveBody = await approve.json();
    assert.equal(approve.status, 200);
    assert.equal(approveBody.deletion.request.status, 'approved');

    const process = await fetch(`${base}/admin/deletion-requests/${requestId}/process`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ maxSteps: 7 }),
    });
    const processBody = await process.json();
    assert.equal(process.status, 200);
    assert.equal(processBody.complete, true);
    assert.equal(processBody.request.status, 'logged');
    assert.ok(processBody.request.loggedAt);

    const repeat = await fetch(`${base}/admin/deletion-requests/${requestId}/process`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ maxSteps: 7 }),
    });
    const repeatBody = await repeat.json();
    assert.equal(repeat.status, 200);
    assert.equal(repeatBody.complete, true);
    assert.equal(repeatBody.executed.length, 0);

    const recreation = await fetch(`${base}/account/deletion`, { headers: userHeaders });
    assert.equal(recreation.status, 410);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports adds uploaded export files and queues indexing jobs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const form = new FormData();
    const html = `
      <main>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/AAA111/">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Claude reel</td></tr>
        </table></div>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/BBB222/">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Gemini post</td></tr>
        </table></div>
      </main>`;
    form.append('exportFiles', new Blob([html], { type: 'text/html' }), 'saved_posts.html');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.itemCount, 2);
    assert.equal(body.totalItemCount, 2);
    assert.equal(body.newItemCount, 2);
    assert.equal(body.skippedDuplicateCount, 0);
    assert.equal(body.queuedJobCount, 2);
    assert.equal(body.jobCount, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports accepts Instagram saved-post JSON files', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const form = new FormData();
    const json = {
      saved_saved_media: [
        {
          string_map_data: {
            'Saved on': { href: 'https://www.instagram.com/reel/APIJSON111/', timestamp: 1778256000 },
            Caption: { value: 'JSON reel import #systems' },
            Username: { value: 'json.creator' },
          },
        },
      ],
    };
    form.append('exportFiles', new Blob([JSON.stringify(json)], { type: 'application/json' }), 'saved_posts.json');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();
    const items = store.getItems('local-dev-user');

    assert.equal(response.status, 200);
    assert.equal(body.itemCount, 1);
    assert.equal(body.newItemCount, 1);
    assert.equal(body.queuedJobCount, 1);
    assert.equal(items[0].status, 'queued');
    assert.equal(items[0].platform, 'Instagram');
    assert.equal(items[0].url, 'https://instagram.com/reel/APIJSON111');
    assert.equal(items[0].caption, 'JSON reel import #systems');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports accepts Instagram zip files containing HTML exports', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const zip = new JSZip();
    zip.file('your_instagram_activity/saved/saved_posts.html', `
      <main>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/ZIPHTML111/">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Zipped Instagram HTML reel</td></tr>
          <tr><td class="_a6_q">Username</td><td class="_2piu _a6_r">zip.creator</td></tr>
        </table></div>
      </main>`);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const form = new FormData();
    form.append('exportFiles', new Blob([buffer], { type: 'application/zip' }), 'instagram-export.zip');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();
    const items = store.getItems('local-dev-user');

    assert.equal(response.status, 200);
    assert.equal(body.itemCount, 1);
    assert.equal(body.newItemCount, 1);
    assert.equal(body.queuedJobCount, 1);
    assert.equal(items[0].status, 'queued');
    assert.equal(items[0].platform, 'Instagram');
    assert.equal(items[0].url, 'https://instagram.com/reel/ZIPHTML111');
    assert.equal(items[0].caption, 'Zipped Instagram HTML reel');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports reads the official nested Instagram saved_post HTML path', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const zip = new JSZip();
    zip.file('your_instagram_activity/saved/saved_post.html', `
      <main>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/NESTED111/">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Nested official Instagram saved post</td></tr>
        </table></div>
      </main>`);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const form = new FormData();
    form.append('exportFiles', new Blob([buffer], { type: 'application/zip' }), 'instagram-maitreya_iguess-2026-05-09-0WPnfek7.zip');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();
    const items = store.getItems('local-dev-user');

    assert.equal(response.status, 200);
    assert.equal(body.itemCount, 1);
    assert.equal(items[0].url, 'https://instagram.com/p/NESTED111');
    assert.equal(items[0].sourceName, 'your_instagram_activity/saved/saved_post.html');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports skips already imported canonical duplicate URLs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const firstForm = new FormData();
    firstForm.append('exportFiles', new Blob([`
      <main>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/AAA111/?utm_source=first">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Original reel</td></tr>
        </table></div>
      </main>`], { type: 'text/html' }), 'saved_posts.html');

    const firstResponse = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: firstForm });
    const firstBody = await firstResponse.json();
    const originalItem = await store.getItem('local-dev-user', 'AAA111');
    const originalImportId = originalItem.importId;
    await store.saveAnalysis('local-dev-user', 'AAA111', { title: 'Done item' });
    const analyzedItem = await store.getItem('local-dev-user', 'AAA111');

    const secondForm = new FormData();
    secondForm.append('exportFiles', new Blob([`
      <main>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://m.instagram.com/reel/AAA111/">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Same reel later</td></tr>
        </table></div>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/BBB222/?igsh=abc">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">New post</td></tr>
        </table></div>
      </main>`], { type: 'text/html' }), 'saved_posts.html');

    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: secondForm });
    const secondBody = await secondResponse.json();
    const allJobs = await store.getJobs('local-dev-user');
    const existingItem = await store.getItem('local-dev-user', 'AAA111');

    assert.equal(firstResponse.status, 200);
    assert.equal(firstBody.newItemCount, 1);
    assert.equal(secondResponse.status, 200);
    assert.equal(secondBody.itemCount, 2);
    assert.equal(secondBody.totalItemCount, 2);
    assert.equal(secondBody.newItemCount, 1);
    assert.equal(secondBody.skippedDuplicateCount, 1);
    assert.equal(secondBody.queuedJobCount, 1);
    assert.equal(secondBody.jobCount, 1);
    assert.equal(allJobs.length, 2);
    assert.equal(allJobs.filter((job) => job.itemId === 'AAA111').length, 1);
    assert.equal(existingItem.importId, originalImportId);
    assert.equal(existingItem.caption, 'Original reel');
    assert.equal(existingItem.status, 'done');
    assert.deepEqual(existingItem.analysis, analyzedItem.analysis);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports accepts Pinterest export zip files', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const zip = new JSZip();
    zip.file('pins.json', JSON.stringify([{ url: 'https://www.pinterest.com/pin/1234567890/' }]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const form = new FormData();
    form.append('exportFiles', new Blob([buffer], { type: 'application/zip' }), 'pinterest.zip');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();
    const items = store.getItems('local-dev-user');

    assert.equal(response.status, 200);
    assert.equal(body.itemCount, 1);
    assert.equal(body.import.source, 'pinterest-export');
    assert.equal(items[0].platform, 'Pinterest');
    assert.equal(items[0].url, 'https://pinterest.com/pin/1234567890');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports reads Pinterest pins, boards, and boards_followed folders', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const zip = new JSZip();
    zip.file('pins/pins.json', JSON.stringify([
      { url: 'https://www.pinterest.com/pin/1111111111/' },
      { url: 'https://www.pinterest.com/pin/2222222222/' },
    ]));
    zip.file('boards/board.csv', 'url\nhttps://www.pinterest.com/pin/2222222222/\nhttps://www.pinterest.com/pin/3333333333/');
    zip.file('boards_followed/followed.txt', 'https://www.pinterest.com/pin/4444444444/');
    zip.file('profile/profile.json', JSON.stringify({ url: 'https://www.pinterest.com/pin/9999999999/' }));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const form = new FormData();
    form.append('exportFiles', new Blob([buffer], { type: 'application/zip' }), 'pinterest.zip');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();
    const urls = store.getItems('local-dev-user').map((item) => item.url).sort();

    assert.equal(response.status, 200);
    assert.equal(body.itemCount, 4);
    assert.deepEqual(urls, [
      'https://pinterest.com/pin/1111111111',
      'https://pinterest.com/pin/2222222222',
      'https://pinterest.com/pin/3333333333',
      'https://pinterest.com/pin/4444444444',
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports/storage imports files uploaded through storage', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  let html = `
    <main>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/STORED111/">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Stored upload reel</td></tr>
      </table></div>
    </main>`;
  const removedPaths = [];
  store.client = {
    storage: {
      from() {
        return {
          async download(storagePath) {
            assert.equal(storagePath, 'local-dev-user/imports/saved_posts.html');
            return { data: new Blob([html], { type: 'text/html' }), error: null };
          },
          async remove(paths) {
            removedPaths.push(...paths);
            return { data: paths, error: null };
          },
        };
      },
    },
  };
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/imports/storage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{
          path: 'local-dev-user/imports/saved_posts.html',
          name: 'saved_posts.html',
          type: 'text/html',
        }],
      }),
    });
    const body = await response.json();
    const items = store.getItems('local-dev-user');

    assert.equal(response.status, 200);
    assert.equal(body.itemCount, 1);
    assert.equal(body.newItemCount, 1);
    assert.equal(items[0].id, 'STORED111');
    const originalItem = await store.getItem('local-dev-user', 'STORED111');
    await store.saveAnalysis('local-dev-user', 'STORED111', { title: 'Stored done' });
    html = `
      <main>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://m.instagram.com/reel/STORED111/?igsh=abc">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Duplicate stored upload reel</td></tr>
        </table></div>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/STORED222/">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">New stored upload post</td></tr>
        </table></div>
      </main>`;
    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/imports/storage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{
          path: 'local-dev-user/imports/saved_posts.html',
          name: 'saved_posts.html',
          type: 'text/html',
        }],
      }),
    });
    const secondBody = await secondResponse.json();
    const existingItem = await store.getItem('local-dev-user', 'STORED111');
    const allJobs = await store.getJobs('local-dev-user');

    assert.equal(secondResponse.status, 200);
    assert.equal(secondBody.itemCount, 2);
    assert.equal(secondBody.newItemCount, 1);
    assert.equal(secondBody.skippedDuplicateCount, 1);
    assert.equal(secondBody.queuedJobCount, 1);
    assert.equal(existingItem.importId, originalItem.importId);
    assert.equal(existingItem.caption, 'Stored upload reel');
    assert.equal(existingItem.status, 'done');
    assert.equal(store.getItems('local-dev-user').length, 2);
    assert.equal(allJobs.filter((job) => job.itemId === 'STORED111').length, 1);
    assert.equal(allJobs.filter((job) => job.itemId === 'STORED222').length, 1);
    assert.deepEqual(removedPaths, [
      'local-dev-user/imports/saved_posts.html',
      'local-dev-user/imports/saved_posts.html',
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports/storage imports chunked upload parts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  let html = `
    <main>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/CHUNK111/">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Chunked upload reel</td></tr>
      </table></div>
    </main>`;
  const chunkParts = () => [
    Buffer.from(html.slice(0, Math.floor(html.length / 2))),
    Buffer.from(html.slice(Math.floor(html.length / 2))),
  ];
  const removedPaths = [];
  store.client = {
    storage: {
      from() {
        return {
          async download(storagePath) {
            const [partA, partB] = chunkParts();
            if (storagePath.endsWith('/00000')) return { data: new Blob([partA], { type: 'application/octet-stream' }), error: null };
            if (storagePath.endsWith('/00001')) return { data: new Blob([partB], { type: 'application/octet-stream' }), error: null };
            return { data: null, error: new Error(`Unexpected path ${storagePath}`) };
          },
          async remove(paths) {
            removedPaths.push(...paths);
            return { data: paths, error: null };
          },
        };
      },
    },
  };
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/imports/storage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{
          path: 'local-dev-user/imports/chunked.html',
          name: 'saved_posts.html',
          type: 'text/html',
          chunked: true,
          totalChunks: 2,
        }],
      }),
    });
    const body = await response.json();
    const items = store.getItems('local-dev-user');

    assert.equal(response.status, 200);
    assert.equal(body.itemCount, 1);
    assert.equal(items[0].id, 'CHUNK111');
    html = `
      <main>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/CHUNK111/?utm_source=old">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Duplicate chunked upload reel</td></tr>
        </table></div>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/CHUNK222/">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">New chunked upload post</td></tr>
        </table></div>
      </main>`;
    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/imports/storage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{
          path: 'local-dev-user/imports/chunked.html',
          name: 'saved_posts.html',
          type: 'text/html',
          chunked: true,
          totalChunks: 2,
        }],
      }),
    });
    const secondBody = await secondResponse.json();

    assert.equal(secondResponse.status, 200);
    assert.equal(secondBody.itemCount, 2);
    assert.equal(secondBody.newItemCount, 1);
    assert.equal(secondBody.skippedDuplicateCount, 1);
    assert.equal(secondBody.queuedJobCount, 1);
    assert.equal(store.getItems('local-dev-user').length, 2);
    assert.deepEqual(removedPaths, [
      'local-dev-user/imports/chunked.html.parts/00000',
      'local-dev-user/imports/chunked.html.parts/00001',
      'local-dev-user/imports/chunked.html.parts/00000',
      'local-dev-user/imports/chunked.html.parts/00001',
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports/upload-urls creates short chunk upload paths', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.client = {
    storage: {
      async getBucket(bucket) {
        assert.equal(bucket, 'import-uploads');
        return { data: { id: bucket }, error: null };
      },
      from(bucket) {
        assert.equal(bucket, 'import-uploads');
        throw new Error('signed upload URLs should not be created');
      },
    },
  };
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/imports/upload-urls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{
          name: 'instagram-maitreya_iguess-2026-05-09-0WPnfek7-with-a-very-long-original-export-name.zip',
          type: 'application/zip',
          size: 1024,
        }],
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.bucket, 'import-uploads');
    assert.equal(body.uploads.length, 1);
    assert.match(body.uploads[0].path, /^local-dev-user\/\d+-[a-f0-9-]+\.zip$/);
    assert.ok(body.uploads[0].path.length < 100);
    assert.equal(body.uploads[0].token, undefined);
    assert.equal(body.uploads[0].signedUrl, undefined);
    assert.equal(body.uploads[0].name, 'instagram-maitreya_iguess-2026-05-09-0WPnfek7-with-a-very-long-original-export-name.zip');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports/upload-chunk stores chunks through the backend service client', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const uploaded = new Map();
  store.client = {
    storage: {
      async getBucket(bucket) {
        assert.equal(bucket, 'import-uploads');
        return { data: { id: bucket }, error: null };
      },
      from(bucket) {
        assert.equal(bucket, 'import-uploads');
        return {
          async upload(storagePath, buffer, options) {
            uploaded.set(storagePath, { buffer: Buffer.from(buffer), options });
            return { data: { path: storagePath }, error: null };
          },
        };
      },
    },
  };
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const form = new FormData();
    form.append('path', 'local-dev-user/123-import.zip');
    form.append('index', '0');
    form.append('totalChunks', '2');
    form.append('chunk', new Blob(['chunk-data']), 'chunk-0');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports/upload-chunk`, { method: 'POST', body: form });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.partPath, 'local-dev-user/123-import.zip.parts/00000');
    assert.equal(uploaded.get(body.partPath).buffer.toString(), 'chunk-data');
    assert.equal(uploaded.get(body.partPath).options.upsert, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/saves/link stores one deduped web save', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const payload = {
      url: 'https://www.pinterest.com/pin/123/?utm_source=feed',
      title: 'Kitchen shelf idea',
      description: 'A saved Pinterest pin',
      startProcessing: false,
    };
    const firstResponse = await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const first = await firstResponse.json();
    const second = await secondResponse.json();

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    assert.equal(first.newItemCount, 1);
    assert.equal(first.queuedJobCount, 1);
    assert.equal(first.item.status, 'queued');
    assert.deepEqual(first.item.collections, ['Random saves']);
    assert.equal(second.newItemCount, 0);
    assert.equal(second.skippedDuplicateCount, 1);
    assert.equal(store.getItems('local-dev-user').length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/notes creates a searchable note without queueing enrichment jobs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const form = new FormData();
    form.append('title', 'Investor follow-up');
    form.append('body', 'Remember the alpha deck note and https://example.com/deck');
    form.append('images', new Blob([Buffer.from('png-data')], { type: 'image/png' }), 'deck.png');

    const response = await fetch(`${base}/notes`, {
      method: 'POST',
      headers: { 'x-user-id': 'notes-user' },
      body: form,
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.item.contentType, 'note');
    assert.equal(body.item.platformKey, 'iscraper-note');
    assert.equal(body.item.status, 'done');
    assert.match(body.item.url, /^iscraper:\/\/note\/note-/);
    assert.equal(body.item.assets.length, 1);
    assert.match(body.item.assets[0].storagePath, /^data:image\/png;base64,/);

    const jobs = store.getJobs('notes-user');
    assert.equal(jobs.length, 0);

    const search = await fetch(`${base}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'notes-user' },
      body: JSON.stringify({ query: 'alpha deck note' }),
    });
    const searchBody = await search.json();
    assert.equal(search.status, 200);
    assert.equal(searchBody.results.some((item) => item.id === body.item.id), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('note image upload rejects videos', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const form = new FormData();
    form.append('title', 'Video note');
    form.append('body', 'This should not upload video.');
    form.append('images', new Blob([Buffer.from('video-data')], { type: 'video/mp4' }), 'clip.mp4');

    const response = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      method: 'POST',
      headers: { 'x-user-id': 'notes-user' },
      body: form,
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /Video notes are not supported yet/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('notes can be updated and deleted with local asset cleanup', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const createForm = new FormData();
    createForm.append('title', 'Draft note');
    createForm.append('body', 'Original note body.');
    createForm.append('images', new Blob([Buffer.from('image-data')], { type: 'image/png' }), 'note.png');
    const createdResponse = await fetch(`${base}/notes`, { method: 'POST', headers: { 'x-user-id': 'notes-user' }, body: createForm });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);

    const updateForm = new FormData();
    updateForm.append('title', 'Updated note');
    updateForm.append('body', 'Updated body has launch checklist.');
    updateForm.append('removeAssetIds', created.item.assets[0].id);
    const updatedResponse = await fetch(`${base}/notes/${created.item.id}`, { method: 'PATCH', headers: { 'x-user-id': 'notes-user' }, body: updateForm });
    const updated = await updatedResponse.json();
    assert.equal(updatedResponse.status, 200);
    assert.equal(updated.item.sourceTitle, 'Updated note');
    assert.equal(updated.item.assets.length, 0);

    const deleteResponse = await fetch(`${base}/notes/${created.item.id}`, { method: 'DELETE', headers: { 'x-user-id': 'notes-user' } });
    assert.equal(deleteResponse.status, 200);
    assert.equal(store.getItem('notes-user', created.item.id), null);
    assert.equal(store.listItemAssets('notes-user', created.item.id).length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/items/:id/approve queues a reviewed web save', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const saveResponse = await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://x.com/example/status/100',
        title: 'Draft title',
        description: 'Original description',
      }),
    });
    const saved = await saveResponse.json();

    const approveResponse = await fetch(`http://127.0.0.1:${port}/api/items/${saved.item.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceTitle: 'Clean title',
        sourceDescription: 'Clean description',
        collections: ['Research'],
        startProcessing: false,
      }),
    });
    const approved = await approveResponse.json();
    const jobs = await store.getJobs('local-dev-user');

    assert.equal(saveResponse.status, 201);
    assert.equal(approveResponse.status, 200);
    assert.equal(approved.item.status, 'queued');
    assert.equal(approved.item.sourceTitle, 'Clean title');
    assert.deepEqual(approved.item.collections, ['Research']);
    assert.equal(approved.queuedJobCount, 0);
    assert.equal(jobs.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/indexing/start approves waiting saves in one request', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const importEntry = await store.createImport({
      userId: 'local-dev-user',
      source: 'user-export',
      fileNames: ['saved_posts.html'],
    });
    await store.upsertImportData({
      userId: 'local-dev-user',
      importId: importEntry.id,
      initialStatus: 'needs_review',
      parsed: {
        collections: [],
        items: [
          { id: 'bulk-a', url: 'https://example.com/a', contentType: 'unknown', caption: 'A', hashtags: [], collections: [] },
          { id: 'bulk-b', url: 'https://example.com/b', contentType: 'unknown', caption: 'B', hashtags: [], collections: [] },
        ],
      },
    });

    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/indexing/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startProcessing: false }),
    });
    const body = await response.json();
    const jobs = await store.getJobs('local-dev-user', importEntry.id);
    const items = store.getItems('local-dev-user');

    assert.equal(response.status, 200);
    assert.equal(body.approvedCount, 2);
    assert.equal(body.queuedJobCount, 2);
    assert.equal(jobs.length, 2);
    assert.equal(items.every((item) => item.status === 'queued'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/indexing/start queues VM worker indexing without inline processing when disabled', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({
    store,
    config: {
      inlineIndexingEnabled: false,
      credentialEncryptionKey: 'dev-encryption-key',
      videoDir: path.join(dir, 'videos'),
    },
  });
  const server = app.listen(0);

  try {
    const importEntry = await store.createImport({
      userId: 'local-dev-user',
      source: 'user-export',
      fileNames: ['saved_posts.html'],
    });
    await store.upsertImportData({
      userId: 'local-dev-user',
      importId: importEntry.id,
      initialStatus: 'needs_review',
      parsed: {
        collections: [],
        items: [
          { id: 'durable-a', url: 'https://example.com/durable-a', contentType: 'unknown', caption: 'A', hashtags: [], collections: [] },
        ],
      },
    });

    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/indexing/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startProcessing: true }),
    });
    const body = await response.json();
    const job = store.getJobs('local-dev-user', importEntry.id)[0];

    assert.equal(response.status, 200);
    assert.equal(body.message, 'Saves queued for batch indexing.');
    assert.equal(body.indexing.mode, 'vm-worker');
    assert.equal(body.indexing.queued, true);
    assert.equal(job.status, 'queued');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/indexing/summary returns aggregate indexing counts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const importEntry = await store.createImport({
      userId: 'local-dev-user',
      source: 'user-export',
      fileNames: ['saved_posts.html'],
    });
    const items = await store.upsertImportData({
      userId: 'local-dev-user',
      importId: importEntry.id,
      initialStatus: 'queued',
      parsed: {
        collections: [],
        items: [
          { id: 'summary-a', url: 'https://example.com/summary-a', contentType: 'unknown', caption: 'A', hashtags: [], collections: [] },
          { id: 'summary-b', url: 'https://example.com/summary-b', contentType: 'unknown', caption: 'B', hashtags: [], collections: [] },
        ],
      },
    });
    const jobs = await store.createJobs({ userId: 'local-dev-user', importId: importEntry.id, items });
    await store.updateJob('local-dev-user', jobs[0].id, { status: 'analyzing' });
    await store.updateJob('local-dev-user', jobs[1].id, { status: 'paused_missing_provider', error: 'Connect a key.' });

    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/indexing/summary`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.summary.processing, 1);
    assert.equal(body.summary.paused, 1);
    assert.equal(body.summary.pausedMissingProvider, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('worker process endpoints require a worker key and process bounded queued scopes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({
    store,
    config: {
      workerApiKey: 'worker-secret',
      credentialEncryptionKey: 'dev-encryption-key',
      videoDir: path.join(dir, 'videos'),
    },
  });
  const server = app.listen(0);

  try {
    const importEntry = await store.createImport({
      userId: 'local-dev-user',
      source: 'manual-link',
      fileNames: ['https://example.com/queued'],
    });
    const items = await store.upsertImportData({
      userId: 'local-dev-user',
      importId: importEntry.id,
      initialStatus: 'queued',
      parsed: {
        collections: [],
        items: [
          { id: 'worker-a', url: 'https://example.com/queued', contentType: 'unknown', caption: 'Queued', hashtags: [], collections: [] },
          { id: 'worker-b', url: 'https://example.com/queued-b', contentType: 'unknown', caption: 'Queued B', hashtags: [], collections: [] },
        ],
      },
    });
    await store.createJobs({ userId: 'local-dev-user', importId: importEntry.id, items });

    const port = server.address().port;
    const denied = await fetch(`http://127.0.0.1:${port}/api/worker/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxJobs: 1 }),
    });
    const allowed = await fetch(`http://127.0.0.1:${port}/api/worker/process-one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-api-key': 'worker-secret' },
      body: JSON.stringify({ maxJobs: 5, download: false }),
    });
    const body = await allowed.json();
    const jobs = store.getJobs('local-dev-user', importEntry.id);

    assert.equal(denied.status, 403);
    assert.equal(allowed.status, 200);
    assert.equal(body.scopeCount, 1);
    assert.equal(body.processedCount, 0);
    assert.equal(jobs.filter((job) => job.status === 'paused_missing_provider').length, 1);
    assert.equal(jobs.filter((job) => job.status === 'queued').length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin worker status requires admin auth and returns safe aggregate queue data', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({
    store,
    config: {
      adminApiKey: 'admin-secret',
      videoDir: path.join(dir, 'videos'),
      workerBatchSize: 5,
      workerScanLimit: 20,
      workerGlobalConcurrency: 1,
      workerPerUserConcurrency: 1,
      workerMaxAttempts: 3,
      workerLeaseMs: 900000,
    },
  });
  const server = app.listen(0);

  try {
    const importEntry = await store.createImport({
      userId: 'local-dev-user',
      source: 'manual-link',
      fileNames: ['https://example.com/private-url'],
    });
    const items = await store.upsertImportData({
      userId: 'local-dev-user',
      importId: importEntry.id,
      initialStatus: 'queued',
      parsed: {
        collections: [],
        items: [
          { id: 'admin-worker-a', url: 'https://example.com/private-url', contentType: 'unknown', caption: 'Private caption', hashtags: [], collections: [] },
        ],
      },
    });
    await store.createJobs({ userId: 'local-dev-user', importId: importEntry.id, items });

    const port = server.address().port;
    const denied = await fetch(`http://127.0.0.1:${port}/api/admin/worker/status`);
    const allowed = await fetch(`http://127.0.0.1:${port}/api/admin/worker/status`, {
      headers: { 'x-admin-api-key': 'admin-secret' },
    });
    const body = await allowed.json();
    const serialized = JSON.stringify(body);

    assert.equal(denied.status, 403);
    assert.equal(allowed.status, 200);
    assert.equal(body.status.queue.totalJobs, 1);
    assert.equal(body.status.queue.queued, 1);
    assert.equal(body.status.worker.batchSize, 5);
    assert.equal(serialized.includes('Private caption'), false);
    assert.equal(serialized.includes('private-url'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extension token can search Lens text and stops after revoke', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/security-guide',
        title: 'SOC 2 compliance checklist',
        description: 'Security controls and audit readiness',
      }),
    });
    const tokenResponse = await fetch(`http://127.0.0.1:${port}/api/extension-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test extension' }),
    });
    const tokenBody = await tokenResponse.json();

    const searchResponse = await fetch(`http://127.0.0.1:${port}/api/lens/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IScraper-Extension-Token': tokenBody.secret,
      },
      body: JSON.stringify({ type: 'text', query: 'SOC 2 security' }),
    });
    const searchBody = await searchResponse.json();
    await fetch(`http://127.0.0.1:${port}/api/extension-tokens/${tokenBody.token.id}`, { method: 'DELETE' });
    const revokedResponse = await fetch(`http://127.0.0.1:${port}/api/lens/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IScraper-Extension-Token': tokenBody.secret,
      },
      body: JSON.stringify({ type: 'text', query: 'security' }),
    });

    assert.equal(tokenResponse.status, 201);
    assert.match(tokenBody.secret, /^isx_/);
    assert.equal(searchResponse.status, 200);
    assert.equal(searchBody.results.length, 1);
    assert.equal(searchBody.results[0].sourceTitle, 'SOC 2 compliance checklist');
    assert.equal(revokedResponse.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent access token can query library, call MCP tools, and stops after revoke', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.ensureUser('agent-user', 'agent@example.com');
  store.upsertImportData({
    userId: 'agent-user',
    importId: 'agent-import',
    parsed: {
      collections: [],
      items: [
        {
          id: 'agent-save-1',
          url: 'https://example.com/soc2',
          contentType: 'post',
          caption: 'SOC 2 compliance checklist',
          collections: ['Security'],
          platform: 'Instagram',
          platformKey: 'instagram',
          sourceTitle: 'SOC 2 checklist',
          sourceAuthor: 'security-team',
          sourceDescription: 'Security controls and audit evidence',
          thumbnailUrl: '',
        },
      ],
    },
    initialStatus: 'done',
  });
  store.saveAnalysis('agent-user', 'agent-save-1', {
    title: 'SOC 2 checklist',
    summary: 'Security controls and audit evidence checklist.',
    visualDescription: 'A laptop screen showing audit controls.',
    topics: ['security', 'compliance'],
    tags: ['soc2'],
  });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const userHeaders = { 'Content-Type': 'application/json', 'x-user-id': 'agent-user', 'x-user-email': 'agent@example.com' };

    const createResponse = await fetch(`${base}/agent-access/tokens`, {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({ name: 'Codex local' }),
    });
    const createBody = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.match(createBody.secret, /^isa_/);
    assert.deepEqual(createBody.token.scopes, ['agent:access', 'library:search', 'library:read']);

    const listResponse = await fetch(`${base}/agent-access/tokens`, { headers: userHeaders });
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.tokens.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(listBody.tokens[0], 'secret'), false);

    const agentHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${createBody.secret}`,
      'x-agent-client': 'node-test',
    };
    const queryResponse = await fetch(`${base}/agent-access/query`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ question: 'SOC 2 audit evidence', limit: 5 }),
    });
    const queryBody = await queryResponse.json();
    assert.equal(queryResponse.status, 200);
    assert.equal(queryBody.resultCount, 1);
    assert.equal(queryBody.items[0].id, 'agent-save-1');
    assert.match(queryBody.guidance, /Cite save ids/);

    const mcpResponse = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'ask_iscraper_library',
          arguments: { question: 'security controls' },
        },
      }),
    });
    const mcpBody = await mcpResponse.json();
    assert.equal(mcpResponse.status, 200);
    assert.equal(mcpBody.result.content[0].type, 'text');
    assert.match(mcpBody.result.content[0].text, /agent-save-1/);

    const revokeResponse = await fetch(`${base}/agent-access/tokens/${createBody.token.id}`, {
      method: 'DELETE',
      headers: userHeaders,
    });
    assert.equal(revokeResponse.status, 200);

    const blockedResponse = await fetch(`${base}/agent-access/query`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ question: 'SOC 2' }),
    });
    assert.equal(blockedResponse.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extension session can capture URL without opening the web app', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const tokenResponse = await fetch(`http://127.0.0.1:${port}/api/extension-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Chrome extension' }),
    });
    const tokenBody = await tokenResponse.json();

    const response = await fetch(`http://127.0.0.1:${port}/api/extension/saves/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IScraper-Extension-Token': tokenBody.secret,
      },
      body: JSON.stringify({
        url: 'https://example.com/background-save',
        title: 'Background extension save',
        description: 'Saved without opening IScraper',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.item.sourceTitle, 'Background extension save');
    assert.equal(body.queuedJobCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Telegram webhook connects a chat and saves forwarded links', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { telegramWebhookSecret: 'telegram-secret' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const tokenResponse = await fetch(`http://127.0.0.1:${port}/api/extension-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Telegram save bot' }),
    });
    const tokenBody = await tokenResponse.json();

    const connectResponse = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'telegram-secret',
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 12345, type: 'private' },
          from: { first_name: 'Creator', username: 'creator' },
          text: `/connect ${tokenBody.secret}`,
        },
      }),
    });
    const connectBody = await connectResponse.json();

    const saveResponse = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'telegram-secret',
      },
      body: JSON.stringify({
        update_id: 2,
        message: {
          message_id: 11,
          chat: { id: 12345, type: 'private' },
          from: { first_name: 'Creator', username: 'creator' },
          text: 'Save this UI reference https://example.com/share-target',
        },
      }),
    });
    const saveBody = await saveResponse.json();
    const items = store.getItems('local-dev-user');

    assert.equal(tokenResponse.status, 201);
    assert.equal(connectResponse.status, 200);
    assert.match(connectBody.text, /Connected/i);
    assert.equal(saveResponse.status, 201);
    assert.match(saveBody.text, /Saved/i);
    assert.equal(saveBody.item.sourceTitle, 'Save this UI reference');
    assert.equal(items.some((item) => item.url === 'https://example.com/share-target'), true);
    assert.equal(items.find((item) => item.url === 'https://example.com/share-target')?.collections[0], 'Telegram saves');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Telegram webhook requires the configured secret token', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { telegramWebhookSecret: 'telegram-secret' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 1, message: { chat: { id: 1 }, text: 'https://example.com' } }),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.match(body.error, /secret/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extension session can undo a URL capture it created', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const tokenResponse = await fetch(`http://127.0.0.1:${port}/api/extension-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Chrome extension' }),
    });
    const tokenBody = await tokenResponse.json();

    const capture = await fetch(`http://127.0.0.1:${port}/api/extension/saves/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IScraper-Extension-Token': tokenBody.secret,
      },
      body: JSON.stringify({
        url: 'https://example.com/undoable-extension-save',
        title: 'Undoable extension save',
      }),
    });
    const captureBody = await capture.json();

    const undo = await fetch(`http://127.0.0.1:${port}/api/extension/saves/${captureBody.item.id}`, {
      method: 'DELETE',
      headers: {
        'X-IScraper-Extension-Token': tokenBody.secret,
      },
    });
    const undoBody = await undo.json();
    const items = store.getItems('local-dev-user');

    assert.equal(capture.status, 201);
    assert.equal(undo.status, 200);
    assert.equal(undoBody.itemId, captureBody.item.id);
    assert.equal(items.find((item) => item.id === captureBody.item.id), undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extension session can save screenshot capture and undo it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const tokenResponse = await fetch(`http://127.0.0.1:${port}/api/extension-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Chrome extension' }),
    });
    const tokenBody = await tokenResponse.json();
    const form = new FormData();
    form.append('title', 'Screen capture - Example');
    form.append('sourceTitle', 'Example Page');
    form.append('sourceUrl', 'https://example.com/capture');
    form.append('image', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'capture.png');

    const response = await fetch(`http://127.0.0.1:${port}/api/extension/captures/screenshot`, {
      method: 'POST',
      headers: {
        'X-IScraper-Extension-Token': tokenBody.secret,
      },
      body: form,
    });
    const body = await response.json();
    const itemId = body.item?.id;

    const undo = await fetch(`http://127.0.0.1:${port}/api/extension/captures/${itemId}`, {
      method: 'DELETE',
      headers: {
        'X-IScraper-Extension-Token': tokenBody.secret,
      },
    });
    const undoBody = await undo.json();
    const items = store.getItems('local-dev-user');

    assert.equal(response.status, 201);
    assert.equal(body.item.platformKey, 'iscraper-extension-capture');
    assert.equal(body.item.assets.length, 1);
    assert.equal(undo.status, 200);
    assert.equal(undoBody.itemId, itemId);
    assert.equal(items.find((item) => item.id === itemId), undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Lens image search rejects invalid crop payloads', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { adminApiKey: 'admin-key', credentialEncryptionKey: 'dev-encryption-key' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const tokenResponse = await fetch(`http://127.0.0.1:${port}/api/extension-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test extension' }),
    });
    const tokenBody = await tokenResponse.json();

    const response = await fetch(`http://127.0.0.1:${port}/api/lens/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IScraper-Extension-Token': tokenBody.secret,
      },
      body: JSON.stringify({ type: 'image', imageDataUrl: 'not-an-image' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /PNG, JPEG, or WebP/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/saves/link rejects unsafe URLs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1/admin', title: 'Bad link' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /Local or private/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports rejects unsupported uploads', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const form = new FormData();
    form.append('exportFiles', new Blob(['not html'], { type: 'text/plain' }), 'notes.exe');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /Instagram, Pinterest, or X/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/search is rate limited', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({
    store,
    config: {
      rateLimitMax: 50,
      searchRateLimitMax: 1,
    },
  });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const request = () => fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'security' }),
    });

    const first = await request();
    const second = await request();
    const body = await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.match(body.error, /Too many requests/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('profile API enforces unique usernames', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const first = await fetch(`http://127.0.0.1:${port}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-a' },
      body: JSON.stringify({ username: 'saved_brain' }),
    });
    const duplicate = await fetch(`http://127.0.0.1:${port}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-b' },
      body: JSON.stringify({ username: 'saved_brain' }),
    });
    const body = await duplicate.json();

    assert.equal(first.status, 200);
    assert.equal(duplicate.status, 409);
    assert.match(body.error, /already taken/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('onboarding API saves, updates, skips, and validates preferences', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const headers = { 'Content-Type': 'application/json', 'x-user-id': 'onboarding-user' };
    const create = await fetch(`http://127.0.0.1:${port}/api/onboarding`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contentTypes: ['instagram', 'notes', 'instagram'], referralSource: 'whatsapp_friend' }),
    });
    const created = await create.json();
    assert.equal(create.status, 200);
    assert.deepEqual(created.onboarding.contentTypes, ['instagram', 'notes']);
    assert.equal(created.onboarding.referralSource, 'whatsapp_friend');
    assert.ok(created.onboarding.completedAt);
    assert.equal(created.onboarding.skippedAt, null);

    const invalid = await fetch(`http://127.0.0.1:${port}/api/onboarding`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contentTypes: ['bad_option'] }),
    });
    assert.equal(invalid.status, 400);

    const skip = await fetch(`http://127.0.0.1:${port}/api/onboarding`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ skipped: true }),
    });
    const skipped = await skip.json();
    assert.equal(skip.status, 200);
    assert.deepEqual(skipped.onboarding.contentTypes, []);
    assert.equal(skipped.onboarding.completedAt, null);
    assert.ok(skipped.onboarding.skippedAt);

    const get = await fetch(`http://127.0.0.1:${port}/api/onboarding`, { headers });
    const current = await get.json();
    assert.equal(get.status, 200);
    assert.equal(current.onboarding.skippedAt, skipped.onboarding.skippedAt);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authenticated imports require profile setup first', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.requiresAuth = true;
  store.getUserFromToken = async () => ({ id: 'auth-user', email: 'auth@example.com' });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const html = '<main><a href="https://www.instagram.com/reel/AUTH111/">x</a></main>';
    const requestImport = () => {
      const form = new FormData();
      form.append('exportFiles', new Blob([html], { type: 'text/html' }), 'saved_posts.html');
      return fetch(`http://127.0.0.1:${port}/api/imports`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
        body: form,
      });
    };

    const blocked = await requestImport();
    await fetch(`http://127.0.0.1:${port}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ username: 'auth_user' }),
    });
    const allowed = await requestImport();

    assert.equal(blocked.status, 428);
    assert.equal(allowed.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider credential API stores keys without returning secrets', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { adminApiKey: 'admin-key', credentialEncryptionKey: 'dev-encryption-key' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/provider-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter',
        purpose: 'text',
        model: 'deepseek/deepseek-v4-pro',
        apiKey: 'sk-or-test-secret',
      }),
    });
    const created = await createResponse.json();
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/provider-credentials`);
    const listed = await listResponse.json();
    const revealResponse = await fetch(`http://127.0.0.1:${port}/api/provider-credentials/${created.credential.id}/reveal`, {
      method: 'POST',
    });
    const revealed = await revealResponse.json();
    const auditResponse = await fetch(`http://127.0.0.1:${port}/api/admin/audit-events?eventType=provider_key_revealed`, {
      headers: { 'x-admin-api-key': 'admin-key' },
    });
    const audit = await auditResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(created.credential.keyHint, 'sk-...cret');
    assert.doesNotMatch(JSON.stringify(created), /sk-or-test-secret/);
    assert.equal(listed.credentials.length, 1);
    assert.doesNotMatch(JSON.stringify(listed), /sk-or-test-secret/);
    assert.equal(revealResponse.status, 200);
    assert.equal(revealed.apiKey, 'sk-or-test-secret');
    assert.equal(auditResponse.status, 200);
    assert.equal(audit.auditEvents.some((entry) => entry.eventType === 'provider_key_revealed'), true);
    assert.equal(audit.auditEvents.find((entry) => entry.eventType === 'provider_key_revealed')?.metadata?.credentialId, created.credential.id);
    assert.doesNotMatch(JSON.stringify(audit), /sk-or-test-secret/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/credits returns paid credit availability', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/credits`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.credits.freeItemsLimit, 0);
    assert.equal(body.credits.freeItemsRemaining, 0);
    assert.equal(body.credits.totalAvailableCredits, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/graph returns indexed item and concept nodes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    await store.ensureUser('local-dev-user', 'local@example.com');
    await store.upsertImportData({
      userId: 'local-dev-user',
      importId: 'import-graph',
      parsed: {
        collections: [],
        items: [{ id: 'AAA111', url: 'https://instagram.com/reel/AAA111', contentType: 'reel', caption: 'SOC 2', hashtags: [], collections: ['Security'] }],
      },
    });
    await store.saveAnalysis('local-dev-user', 'AAA111', {
      title: 'SOC 2 checklist',
      summary: 'Security compliance save',
      topics: ['security compliance'],
      tags: ['SOC 2'],
      brandsMentioned: ['Vanta'],
    });

    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/graph`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.graph.stats.indexedItems, 1);
    assert.equal(body.graph.nodes.some((node) => node.id === 'item:AAA111'), true);
    assert.equal(body.graph.nodes.some((node) => node.id === 'topic:security-compliance'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('credit package API lists packages and checkout fails closed without Stripe config', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const packageResponse = await fetch(`http://127.0.0.1:${port}/api/credit-packages`);
    const packages = await packageResponse.json();
    const checkoutResponse = await fetch(`http://127.0.0.1:${port}/api/credits/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: 'starter_100' }),
    });
    const checkout = await checkoutResponse.json();

    assert.equal(packageResponse.status, 200);
    assert.equal(packages.packages.length, 3);
    assert.equal(packages.packages[0].credits, 100);
    assert.equal(checkoutResponse.status, 503);
    assert.equal(packages.checkoutEnabled, false);
    assert.match(checkout.error, /coming soon/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin credit adjustment requires API key and updates paid credits', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { adminApiKey: 'test-admin-key' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    await store.ensureUser('user-1', 'user@example.com');

    const deniedResponse = await fetch(`http://127.0.0.1:${port}/api/admin/credits/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', amount: 10, reason: 'test' }),
    });

    const adjustResponse = await fetch(`http://127.0.0.1:${port}/api/admin/credits/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-api-key': 'test-admin-key' },
      body: JSON.stringify({ userId: 'user-1', amount: 10, reason: 'manual test credit' }),
    });
    const body = await adjustResponse.json();

    assert.equal(deniedResponse.status, 403);
    assert.equal(adjustResponse.status, 201);
    assert.equal(body.credits.paidCredits, 10);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin endpoints allow listed Google admin emails and block other signed-in users', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.getUserFromToken = async (token) => (
    token === 'admin-token'
      ? { id: 'admin-user', email: 'owner@example.com' }
      : { id: 'regular-user', email: 'user@example.com' }
  );
  const app = createApp({ store, config: { adminEmails: ['owner@example.com'] } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    await store.ensureUser('user-1', 'user@example.com');
    await store.saveProfile('user-1', { username: 'user_one' });
    await store.recordUsage({ userId: 'user-1', itemId: 'item-1', source: 'free' });

    const denied = await fetch(`http://127.0.0.1:${port}/api/admin/summary`, {
      headers: { Authorization: 'Bearer regular-token' },
    });
    const summaryResponse = await fetch(`http://127.0.0.1:${port}/api/admin/summary`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    const usersResponse = await fetch(`http://127.0.0.1:${port}/api/admin/users?q=user_one`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    const summary = await summaryResponse.json();
    const users = await usersResponse.json();

    assert.equal(denied.status, 403);
    assert.equal(summaryResponse.status, 200);
    assert.equal(summary.summary.users.total, 1);
    assert.equal(summary.summary.credits.freeUsed, 1);
    assert.equal(usersResponse.status, 200);
    assert.equal(users.total, 1);
    assert.equal(users.users[0].profile.username, 'user_one');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin password login allows email/password admin requests', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({
    store,
    config: {
      adminEmails: ['owner@example.com'],
      adminPassword: 'correct-password',
    },
  });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    await store.ensureUser('user-1', 'user@example.com');

    const badLogin = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'wrong' }),
    });
    const goodLogin = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct-password' }),
    });
    const summary = await fetch(`http://127.0.0.1:${port}/api/admin/summary`, {
      headers: {
        'x-admin-email': 'owner@example.com',
        'x-admin-password': 'correct-password',
      },
    });

    assert.equal(badLogin.status, 403);
    assert.equal(goodLogin.status, 200);
    assert.equal(summary.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin user detail returns credits, item stats, and credit history', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { adminApiKey: 'test-admin-key' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    await store.ensureUser('user-1', 'user@example.com');
    await store.saveProfile('user-1', { username: 'user_one' });
    const importEntry = await store.createImport({ userId: 'user-1', source: 'instagram', fileNames: ['saved.json'] });
    await store.upsertImportData({
      userId: 'user-1',
      importId: importEntry.id,
      parsed: {
        collections: [],
        items: [{ id: 'item-1', url: 'https://example.com/1', contentType: 'post', caption: '', hashtags: [], collections: [] }],
      },
    });
    await store.saveAnalysis('user-1', 'item-1', { title: 'Indexed item' });
    await fetch(`http://127.0.0.1:${port}/api/admin/credits/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-api-key': 'test-admin-key' },
      body: JSON.stringify({ userId: 'user-1', amount: 25, reason: 'launch bonus' }),
    });

    const detailResponse = await fetch(`http://127.0.0.1:${port}/api/admin/users/user-1`, {
      headers: { 'x-admin-api-key': 'test-admin-key' },
    });
    const detail = await detailResponse.json();

    assert.equal(detailResponse.status, 200);
    assert.equal(detail.user.email, 'user@example.com');
    assert.equal(detail.user.credits.paidCredits, 25);
    assert.equal(detail.user.itemStats.indexed, 1);
    assert.equal(detail.user.counts.imports, 1);
    assert.equal(detail.user.counts.saves, 1);
    assert.equal(typeof detail.user.jobStats, 'object');
    assert.equal(detail.user.deletion, null);
    assert.equal(detail.user.items, undefined);
    assert.equal(detail.user.creditTransactions[0].metadata.reason, 'launch bonus');
    assert.equal(detail.user.adminAdjustments[0].reason, 'launch bonus');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin can block users and blocked users cannot create private saves', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  store.requiresAuth = true;
  store.getUserFromToken = async (token) => (
    token === 'admin-token'
      ? { id: 'admin-user', email: 'owner@example.com' }
      : { id: 'user-1', email: 'user@example.com' }
  );
  const app = createApp({ store, config: { adminEmails: ['owner@example.com'] } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    await store.ensureUser('user-1', 'user@example.com');
    await store.saveProfile('user-1', { username: 'user_one' });

    const blockResponse = await fetch(`http://127.0.0.1:${port}/api/admin/users/user-1/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ reason: 'test block' }),
    });
    const blockedSave = await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
      body: JSON.stringify({ url: 'https://example.com/blocked', title: 'Blocked' }),
    });
    const unblockResponse = await fetch(`http://127.0.0.1:${port}/api/admin/users/user-1/unblock`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const allowedSave = await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
      body: JSON.stringify({ url: 'https://example.com/allowed', title: 'Allowed' }),
    });

    assert.equal(blockResponse.status, 200);
    assert.equal(blockedSave.status, 403);
    assert.equal(unblockResponse.status, 200);
    assert.equal(allowedSave.status, 201);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin can list activity, imports, and moderate feedback', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { adminApiKey: 'test-admin-key' } });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    await store.ensureUser('local-dev-user', 'local@example.com');
    await store.saveProfile('local-dev-user', { username: 'local_user' });

    await fetch(`http://127.0.0.1:${port}/api/activity/sign-in`, { method: 'POST' });
    await fetch(`http://127.0.0.1:${port}/api/saves/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/admin-list', title: 'Admin list' }),
    });
    const feedbackResponse = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature: 'Search', message: 'Please improve this' }),
    });
    const feedbackBody = await feedbackResponse.json();

    const activityResponse = await fetch(`http://127.0.0.1:${port}/api/admin/activity`, {
      headers: { 'x-admin-api-key': 'test-admin-key' },
    });
    const timelineResponse = await fetch(`http://127.0.0.1:${port}/api/admin/users/local-dev-user/timeline`, {
      headers: { 'x-admin-api-key': 'test-admin-key' },
    });
    const auditResponse = await fetch(`http://127.0.0.1:${port}/api/admin/audit-events?eventType=admin_user_timeline_viewed`, {
      headers: { 'x-admin-api-key': 'test-admin-key' },
    });
    const importsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/imports`, {
      headers: { 'x-admin-api-key': 'test-admin-key' },
    });
    const hideResponse = await fetch(`http://127.0.0.1:${port}/api/admin/feedback/${feedbackBody.feedback.id}/hide`, {
      method: 'POST',
      headers: { 'x-admin-api-key': 'test-admin-key' },
    });
    const publicFeedbackResponse = await fetch(`http://127.0.0.1:${port}/api/feedback`);
    const activity = await activityResponse.json();
    const timeline = await timelineResponse.json();
    const audit = await auditResponse.json();
    const imports = await importsResponse.json();
    const publicFeedback = await publicFeedbackResponse.json();

    assert.equal(feedbackResponse.status, 201);
    assert.equal(activityResponse.status, 200);
    assert.equal(activity.activity.some((entry) => entry.eventType === 'sign_in'), true);
    assert.equal(JSON.stringify(activity.activity.find((entry) => entry.eventType === 'sign_in')?.metadata || {}).includes('local@example.com'), false);
    assert.equal(timelineResponse.status, 200);
    assert.equal(timeline.timeline.some((entry) => entry.eventType === 'sign_in'), true);
    assert.equal(auditResponse.status, 200);
    assert.equal(audit.auditEvents.some((entry) => entry.eventType === 'admin_user_timeline_viewed'), true);
    assert.equal(importsResponse.status, 200);
    assert.equal(imports.imports.length, 1);
    assert.equal(hideResponse.status, 200);
    assert.equal(publicFeedback.feedback.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/jobs/restart requeues paused and stuck jobs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { videoDir: path.join(dir, 'media') } });
  const server = app.listen(0);

  try {
    await store.ensureUser('local-dev-user', 'local@example.com');
    const parsed = {
      collections: [],
      items: [
        { id: 'a', url: 'https://www.instagram.com/reel/A/', contentType: 'reel', caption: '', hashtags: [], collections: [] },
        { id: 'b', url: 'https://www.instagram.com/reel/B/', contentType: 'reel', caption: '', hashtags: [], collections: [] },
      ],
    };
    await store.upsertImportData({ userId: 'local-dev-user', importId: 'import-1', parsed });
    await store.createJobs({ userId: 'local-dev-user', importId: 'import-1', items: parsed.items });
    await store.updateJob('local-dev-user', 'import-1:a', { status: 'paused_needs_billing', error: 'credits over' });
    await store.updateJob('local-dev-user', 'import-1:b', { status: 'analyzing', error: null });

    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/jobs/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: false }),
    });
    const body = await response.json();
    const jobs = await store.getJobs('local-dev-user');

    assert.equal(response.status, 200);
    assert.equal(body.resetCount, 2);
    assert.equal(jobs.every((job) => job.status === 'queued'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
