const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');

const { createApp } = require('../src/server');
const { createLocalStore } = require('../src/stores/localStore');

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

test('POST /api/imports adds uploaded export files to library without indexing jobs', async () => {
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
    assert.equal(body.queuedJobCount, 0);
    assert.equal(body.jobCount, 0);
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
    assert.equal(body.queuedJobCount, 0);
    assert.equal(items[0].status, 'needs_review');
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
    assert.equal(body.queuedJobCount, 0);
    assert.equal(items[0].status, 'needs_review');
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
    assert.equal(secondBody.queuedJobCount, 0);
    assert.equal(secondBody.jobCount, 0);
    assert.equal(allJobs.length, 0);
    assert.equal(allJobs.filter((job) => job.itemId === 'AAA111').length, 0);
    assert.equal(existingItem.status, 'done');
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
  const html = `
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
    assert.deepEqual(removedPaths, ['local-dev-user/imports/saved_posts.html']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/imports/storage imports chunked upload parts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const html = `
    <main>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/CHUNK111/">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Chunked upload reel</td></tr>
      </table></div>
    </main>`;
  const partA = Buffer.from(html.slice(0, Math.floor(html.length / 2)));
  const partB = Buffer.from(html.slice(Math.floor(html.length / 2)));
  const removedPaths = [];
  store.client = {
    storage: {
      from() {
        return {
          async download(storagePath) {
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
    assert.deepEqual(removedPaths, [
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
    assert.equal(first.queuedJobCount, 0);
    assert.equal(first.item.status, 'needs_review');
    assert.equal(second.newItemCount, 0);
    assert.equal(second.skippedDuplicateCount, 1);
    assert.equal(store.getItems('local-dev-user').length, 1);
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
    assert.equal(approved.queuedJobCount, 1);
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

test('POST /api/worker/process requires a worker key and processes queued scopes', async () => {
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
    const allowed = await fetch(`http://127.0.0.1:${port}/api/worker/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-api-key': 'worker-secret' },
      body: JSON.stringify({ maxJobs: 1, download: false }),
    });
    const body = await allowed.json();
    const job = store.getJobs('local-dev-user', importEntry.id)[0];

    assert.equal(denied.status, 403);
    assert.equal(allowed.status, 200);
    assert.equal(body.scopeCount, 1);
    assert.equal(job.status, 'paused_missing_provider');
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

test('Lens image search rejects invalid crop payloads', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  const app = createApp({ store, config: { credentialEncryptionKey: 'dev-encryption-key' } });
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
    form.append('exportFiles', new Blob(['not html'], { type: 'text/plain' }), 'notes.txt');

    const response = await fetch(`http://127.0.0.1:${port}/api/imports`, { method: 'POST', body: form });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /Instagram ZIP\/HTML\/JSON/);
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
    const revealResponse = await fetch(`http://127.0.0.1:${port}/api/provider-credentials/${created.credential.id}/reveal`, {
      method: 'POST',
    });
    const revealed = await revealResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(created.credential.keyHint, 'sk-...cret');
    assert.doesNotMatch(JSON.stringify(created), /sk-or-test-secret/);
    assert.equal(listed.credentials.length, 1);
    assert.doesNotMatch(JSON.stringify(listed), /sk-or-test-secret/);
    assert.equal(revealResponse.status, 200);
    assert.equal(revealed.apiKey, 'sk-or-test-secret');
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
    await store.upsertImportData({
      userId: 'user-1',
      importId: 'import-1',
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
    const importsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/imports`, {
      headers: { 'x-admin-api-key': 'test-admin-key' },
    });
    const hideResponse = await fetch(`http://127.0.0.1:${port}/api/admin/feedback/${feedbackBody.feedback.id}/hide`, {
      method: 'POST',
      headers: { 'x-admin-api-key': 'test-admin-key' },
    });
    const publicFeedbackResponse = await fetch(`http://127.0.0.1:${port}/api/feedback`);
    const activity = await activityResponse.json();
    const imports = await importsResponse.json();
    const publicFeedback = await publicFeedbackResponse.json();

    assert.equal(feedbackResponse.status, 201);
    assert.equal(activityResponse.status, 200);
    assert.equal(activity.activity.some((entry) => entry.eventType === 'sign_in'), true);
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
