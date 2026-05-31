const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/server');
const { createLocalStore } = require('../src/stores/localStore');
const { generateSmartCollectionCandidates } = require('../src/services/smartCollections');

function savedItem(id, patch = {}) {
  return {
    id,
    url: `https://example.com/${id}`,
    contentType: 'post',
    caption: '',
    hashtags: [],
    ownerName: '',
    ownerUsername: '',
    savedAt: '',
    collections: [],
    platform: 'Web',
    platformKey: 'web',
    sourceId: id,
    sourceTitle: '',
    sourceAuthor: '',
    sourceDescription: '',
    thumbnailUrl: '',
    ...patch,
  };
}

test('smart collection generation uses fast metadata and enriched analysis', () => {
  const candidates = generateSmartCollectionCandidates([
    savedItem('fast-1', { sourceTitle: 'Figma UI dashboard inspiration', status: 'done' }),
    savedItem('fast-2', { caption: 'Landing page layout and design system reference', status: 'done' }),
    savedItem('analysis-1', {
      status: 'done',
      analysis: { tags: ['design tools'], topics: ['Design tools'], toolsMentioned: ['Figma'] },
    }),
    savedItem('analysis-2', {
      status: 'done',
      analysis: { tags: ['design tools'], topics: ['Design tools'], toolsMentioned: ['Canva'] },
    }),
  ]);

  assert.ok(candidates.find((collection) => collection.slug === 'ui-inspiration'));
  assert.ok(candidates.find((collection) => collection.slug === 'topic-design-tools'));
});

test('smart collection generation recognizes fashion and shopping saves', () => {
  const candidates = generateSmartCollectionCandidates([
    savedItem('fashion-1', { sourceTitle: 'Winter outfit with wool jacket and sneakers', status: 'done' }),
    savedItem('fashion-2', { sourceDescription: 'Wardrobe ideas for dresses, bags, and accessories', status: 'done' }),
    savedItem('product-1', { sourceTitle: 'Camera gear review and price comparison', status: 'done' }),
    savedItem('product-2', { caption: 'Shopping list for gadgets to buy later', status: 'done' }),
  ]);

  assert.ok(candidates.find((collection) => collection.slug === 'fashion-clothes'));
  assert.ok(candidates.find((collection) => collection.slug === 'products'));
});

test('smart collection generation keeps interest folders personalized to the user data', () => {
  const aiCandidates = generateSmartCollectionCandidates([
    savedItem('ai-1', {
      status: 'done',
      analysis: { tags: ['AI agents'], topics: ['AI agents'], toolsMentioned: ['Claude'] },
    }),
    savedItem('ai-2', {
      status: 'done',
      analysis: { tags: ['AI agents'], topics: ['AI agents'], toolsMentioned: ['Gemini'] },
    }),
  ]);
  assert.ok(aiCandidates.find((collection) => collection.slug === 'topic-ai-agents'));
  assert.equal(aiCandidates.find((collection) => collection.slug === 'tool-claude'), undefined);
  assert.equal(aiCandidates.find((collection) => collection.slug === 'tool-gemini'), undefined);

  const recipeCandidates = generateSmartCollectionCandidates([
    savedItem('recipe-1', { status: 'done', sourceTitle: 'Pasta dinner recipe with tomato sauce' }),
    savedItem('recipe-2', { status: 'done', caption: 'Lunch meal prep cooking guide' }),
  ]);
  assert.ok(recipeCandidates.find((collection) => collection.slug === 'recipes'));
  assert.equal(recipeCandidates.find((collection) => collection.slug === 'topic-ai-agents'), undefined);
  assert.equal(recipeCandidates.find((collection) => collection.slug === 'tool-claude'), undefined);
});

test('smart collection generation adds source and capture folders only when matching saves exist', () => {
  const candidates = generateSmartCollectionCandidates([
    savedItem('insta-1', { status: 'done', platform: 'Instagram', platformKey: 'instagram' }),
    savedItem('insta-2', { status: 'done', platform: 'Instagram', platformKey: 'instagram' }),
    savedItem('shot-1', { status: 'done', platform: 'Browser capture', platformKey: 'iscraper-extension-capture' }),
    savedItem('shot-2', { status: 'done', platform: 'Browser capture', platformKey: 'iscraper-extension-capture' }),
  ]);

  const instagram = candidates.find((collection) => collection.slug === 'platform-instagram');
  const screenshots = candidates.find((collection) => collection.slug === 'capture-screenshots');
  assert.equal(instagram?.generationMetadata.folderGroup.name, 'Sources');
  assert.equal(screenshots?.generationMetadata.folderGroup.name, 'Captures');
  assert.deepEqual(screenshots?.generationMetadata.matchSignals, ['Screenshots']);
  assert.equal(candidates.find((collection) => collection.slug === 'capture-voice-notes'), undefined);
});

test('public smart collections expose folder groups and match signals', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'iscraper-smart-public-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.ensureUser('public-user', 'public@example.com');
    store.upsertImportData({
      userId: 'public-user',
      importId: 'import-public',
      parsed: {
        collections: [],
        items: [
          savedItem('gemini-1', { status: 'done' }),
          savedItem('gemini-2', { status: 'done' }),
        ],
      },
      initialStatus: 'done',
    });
    store.saveAnalysis('public-user', 'gemini-1', { topics: ['AI agents'], tags: ['AI agents'], toolsMentioned: ['Gemini'] });
    store.saveAnalysis('public-user', 'gemini-2', { topics: ['AI agents'], tags: ['AI agents'], toolsMentioned: ['Gemini'] });

    const collections = store.refreshSmartCollections('public-user');
    const gemini = collections.find((collection) => collection.slug === 'tool-gemini');
    assert.equal(gemini.folderGroup.name, 'Tools');
    assert.ok(gemini.matchSignals.includes('Gemini'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('local smart collections persist edits and manual excludes across refresh', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'iscraper-smart-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.ensureUser('smart-user', 'smart@example.com');
    store.upsertImportData({
      userId: 'smart-user',
      importId: 'import-1',
      parsed: {
        collections: [{ name: 'Design', sourceName: 'Import' }],
        items: [
          savedItem('ui-1', { sourceTitle: 'Figma UI dashboard', collections: ['Design'] }),
          savedItem('ui-2', { caption: 'Design system and app layout inspiration', collections: ['Design'] }),
        ],
      },
      initialStatus: 'done',
    });

    let collections = store.refreshSmartCollections('smart-user');
    const ui = collections.find((collection) => collection.slug === 'ui-inspiration');
    assert.ok(ui);
    assert.equal(ui.itemCount, 2);

    const renamed = store.updateSmartCollection('smart-user', ui.id, {
      name: 'Best UI ideas',
      pinned: true,
      hidden: true,
    });
    assert.equal(renamed.name, 'Best UI ideas');
    assert.equal(renamed.pinned, true);
    assert.equal(renamed.hidden, true);

    collections = store.refreshSmartCollections('smart-user');
    assert.equal(collections.find((collection) => collection.id === ui.id), undefined);
    const hidden = store.listSmartCollections('smart-user', { includeHidden: true }).find((collection) => collection.id === ui.id);
    assert.equal(hidden.name, 'Best UI ideas');
    assert.equal(hidden.pinned, true);
    assert.equal(hidden.hidden, true);

    store.updateSmartCollection('smart-user', ui.id, { hidden: false });
    store.setSmartCollectionItemOverride('smart-user', ui.id, 'ui-1', 'exclude');
    let page = store.listSmartCollectionItems('smart-user', ui.id);
    assert.deepEqual(page.items.map((item) => item.id), ['ui-2']);
    store.refreshSmartCollections('smart-user');
    page = store.listSmartCollectionItems('smart-user', ui.id);
    assert.deepEqual(page.items.map((item) => item.id), ['ui-2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('smart collections API is user-scoped and supports refresh/update/item override', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'iscraper-smart-api-'));
  const store = createLocalStore({ dataPath: dir });
  store.ensureUser('user-a', 'a@example.com');
  store.ensureUser('user-b', 'b@example.com');
  store.saveProfile('user-a', { username: 'user_a' });
  store.saveProfile('user-b', { username: 'user_b' });
  store.upsertImportData({
    userId: 'user-a',
    importId: 'import-a',
    parsed: {
      collections: [],
      items: [
        savedItem('a-1', { sourceTitle: 'UI dashboard layout' }),
        savedItem('a-2', { sourceDescription: 'Figma component and interface pattern' }),
      ],
    },
    initialStatus: 'done',
  });
  store.upsertImportData({
    userId: 'user-b',
    importId: 'import-b',
    parsed: {
      collections: [],
      items: [
        savedItem('b-1', { sourceTitle: 'Dinner recipe pasta' }),
        savedItem('b-2', { caption: 'Cooking recipe for lunch' }),
      ],
    },
    initialStatus: 'done',
  });

  const app = createApp({ store });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    const headersA = { 'Content-Type': 'application/json', 'x-user-id': 'user-a', 'x-user-email': 'a@example.com' };
    const headersB = { 'Content-Type': 'application/json', 'x-user-id': 'user-b', 'x-user-email': 'b@example.com' };

    const refresh = await fetch(`${base}/smart-collections/refresh`, { method: 'POST', headers: headersA, body: JSON.stringify({}) });
    const refreshBody = await refresh.json();
    assert.equal(refresh.status, 200);
    const collection = refreshBody.collections.find((entry) => entry.slug === 'ui-inspiration');
    assert.ok(collection);

    const blocked = await fetch(`${base}/smart-collections/${collection.id}/items`, { headers: headersB });
    assert.equal(blocked.status, 404);

    const patched = await fetch(`${base}/smart-collections/${collection.id}`, {
      method: 'PATCH',
      headers: headersA,
      body: JSON.stringify({ name: 'UI wins', pinned: true }),
    });
    const patchedBody = await patched.json();
    assert.equal(patched.status, 200);
    assert.equal(patchedBody.collection.name, 'UI wins');
    assert.equal(patchedBody.collection.pinned, true);

    const excluded = await fetch(`${base}/smart-collections/${collection.id}/items/a-1`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ action: 'exclude' }),
    });
    assert.equal(excluded.status, 200);

    const page = await fetch(`${base}/smart-collections/${collection.id}/items`, { headers: headersA });
    const pageBody = await page.json();
    assert.equal(page.status, 200);
    assert.deepEqual(pageBody.items.map((item) => item.id), ['a-2']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
