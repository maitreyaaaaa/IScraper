const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/server');
const { createLocalStore } = require('../src/stores/localStore');

test('POST /api/imports imports all uploaded export files and creates processing jobs', async () => {
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
    await store.saveAnalysis('local-dev-user', 'AAA111', { title: 'Done item' });

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
    assert.equal(existingItem.status, 'done');
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
    assert.equal(second.newItemCount, 0);
    assert.equal(second.skippedDuplicateCount, 1);
    assert.equal(store.getItems('local-dev-user').length, 1);
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

test('POST /api/imports rejects non-HTML uploads', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const form = new FormData();
    form.append('exportFiles', new Blob(['not html'], { type: 'text/plain' }), 'notes.txt');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /HTML export/);
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
  const app = createApp({ store, config: { credentialEncryptionKey: 'dev-encryption-key' } });
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

    assert.equal(createResponse.status, 200);
    assert.equal(created.credential.keyHint, 'sk-...cret');
    assert.doesNotMatch(JSON.stringify(created), /sk-or-test-secret/);
    assert.equal(listed.credentials.length, 1);
    assert.doesNotMatch(JSON.stringify(listed), /sk-or-test-secret/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/credits returns free item allowance', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/credits`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.credits.freeItemsLimit, 200);
    assert.equal(body.credits.freeItemsRemaining, 200);
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
