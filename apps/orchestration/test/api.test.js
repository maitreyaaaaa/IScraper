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
    assert.equal(body.jobCount, 2);
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
