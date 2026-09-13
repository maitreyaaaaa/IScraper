const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createLocalStore } = require('../src/stores/localStore');

test('localStore keeps analysis processing level internal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const [created] = store.upsertImportData({
      userId: 'local-dev-user',
      importId: 'first-import',
      parsed: {
        collections: [],
        items: [{
          id: 'internal-depth',
          url: 'https://instagram.com/p/internal-depth',
          contentType: 'post',
          caption: 'Internal processing level test',
          hashtags: [],
          collections: [],
        }],
      },
    });

    store.saveAnalysis('local-dev-user', created.id, {
      title: 'Indexed internally',
      summary: 'Visible summary',
      _processingLevel: 'ml',
      _sourceContentHash: 'source-hash',
      _embeddingContentHash: 'embedding-hash',
      _visualEmbedding: [0.1, 0.2],
      _visualEmbeddingModel: 'clip-vit-base',
    });
    store.saveVisualEmbedding('local-dev-user', created.id, {
      embedding: [0.1, 0.2],
      contentHash: 'source-hash',
      model: 'clip-vit-base',
    });

    const item = store.getItem('local-dev-user', created.id);
    const rawState = JSON.parse(readFileSync(path.join(dir, 'brain.local.json'), 'utf8'));
    const rawItem = rawState.items.find((entry) => entry.id === created.id);

    assert.equal(item.analysis.title, 'Indexed internally');
    assert.equal(item.analysis._processingLevel, undefined);
    assert.equal(item.analysis._sourceContentHash, undefined);
    assert.equal(item.analysis._embeddingContentHash, undefined);
    assert.equal(item.analysis.processingLevel, undefined);
    assert.equal(item.analysis.sourceContentHash, undefined);
    assert.equal(item.analysis.embeddingContentHash, undefined);
    assert.equal(item.analysis._visualEmbedding, undefined);
    assert.equal(item.analysis.visualEmbedding, undefined);
    assert.equal(item.analysisMetadata, undefined);
    assert.equal(rawItem.analysisMetadata.processingLevel, 'ml');
    assert.equal(rawItem.analysisMetadata.sourceContentHash, 'source-hash');
    assert.equal(rawItem.analysisMetadata.embeddingContentHash, 'embedding-hash');
    assert.deepEqual(store.getAnalysisMetadata('local-dev-user', created.id), {
      processingLevel: 'ml',
      sourceContentHash: 'source-hash',
      embeddingContentHash: 'embedding-hash',
    });
    assert.deepEqual(store.getVisualEmbeddingMetadata('local-dev-user', created.id), {
      contentHash: 'source-hash',
      model: 'clip-vit-base',
      dimensions: 2,
    });
    assert.deepEqual(store.listVisualEmbeddings('local-dev-user').map((entry) => entry.itemId), [created.id]);
    store.deleteSavedItem('local-dev-user', created.id);
    assert.deepEqual(store.listVisualEmbeddings('local-dev-user'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localStore skipExisting duplicate mode does not mutate existing export items', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const [created] = store.upsertImportData({
      userId: 'local-dev-user',
      importId: 'first-import',
      parsed: {
        collections: [],
        items: [{
          id: 'AAA111',
          url: 'https://instagram.com/reel/AAA111',
          contentType: 'reel',
          caption: 'Original caption',
          hashtags: ['original'],
          collections: ['Original collection'],
        }],
      },
      duplicateMode: 'skipExisting',
    });
    store.saveAnalysis('local-dev-user', created.id, { title: 'Original analysis' });
    const before = { ...store.getItem('local-dev-user', created.id) };

    const inserted = store.upsertImportData({
      userId: 'local-dev-user',
      importId: 'second-import',
      parsed: {
        collections: [],
        items: [{
          id: 'AAA111',
          url: 'https://instagram.com/reel/AAA111',
          contentType: 'reel',
          caption: 'Duplicate caption',
          hashtags: ['duplicate'],
          collections: ['Duplicate collection'],
        }],
      },
      duplicateMode: 'skipExisting',
    });
    const after = store.getItem('local-dev-user', created.id);

    assert.deepEqual(inserted, []);
    assert.equal(after.importId, before.importId);
    assert.equal(after.caption, before.caption);
    assert.deepEqual(after.hashtags, before.hashtags);
    assert.deepEqual(after.collections, before.collections);
    assert.equal(after.status, before.status);
    assert.deepEqual(after.analysis, before.analysis);
    assert.equal(store.getItems('local-dev-user').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localStore listItemsPage applies filters and stable cursors', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.upsertImportData({
      userId: 'page-user',
      importId: 'page-import',
      parsed: {
        collections: [],
        items: [
          {
            id: 'alpha',
            url: 'https://instagram.com/p/alpha',
            contentType: 'post',
            caption: 'Alpha caption',
            collections: ['Ideas'],
            platform: 'Instagram',
            platformKey: 'instagram',
            sourceTitle: 'Alpha',
          },
          {
            id: 'beta',
            url: 'https://example.com/beta',
            contentType: 'link',
            caption: 'Beta caption',
            collections: ['Research'],
            platform: 'Web',
            platformKey: 'web',
            sourceTitle: 'Beta',
          },
          {
            id: 'capture',
            url: 'https://example.com/capture',
            contentType: 'note',
            caption: 'Captured screenshot',
            collections: ['Browser captures'],
            platform: 'IScraper Extension',
            platformKey: 'iscraper-extension-capture',
            sourceTitle: 'Capture',
          },
          {
            id: 'note',
            url: 'https://iscraper.local/note',
            contentType: 'note',
            caption: 'Private note',
            collections: ['Notes'],
            platform: 'IScraper Notes',
            platformKey: 'iscraper-note',
            sourceTitle: 'Note',
          },
          {
            id: 'voice',
            url: 'https://iscraper.local/voice',
            contentType: 'voice_note',
            caption: 'Voice memo',
            collections: ['Voice notes'],
            platform: 'IScraper Extension',
            platformKey: 'iscraper-voice-note',
            sourceTitle: 'Voice',
          },
        ],
      },
      initialStatus: 'done',
    });

    const first = store.listItemsPage('page-user', { limit: 1, sort: 'title' });
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].id, 'alpha');
    assert.equal(first.totalCount, 5);
    assert.ok(first.nextCursor);
    assert.deepEqual(first.facets.collections, ['all', 'Browser captures', 'Ideas', 'Notes', 'Research', 'Voice notes']);
    assert.deepEqual(first.facets.platforms, ['all', 'Instagram', 'IScraper Extension', 'Web']);

    const second = store.listItemsPage('page-user', { limit: 1, sort: 'title', cursor: first.nextCursor });
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].id, 'beta');

    const links = store.listItemsPage('page-user', { type: 'links' });
    assert.equal(links.totalCount, 1);
    assert.equal(links.items[0].id, 'beta');

    const screenshots = store.listItemsPage('page-user', { type: 'screenshots' });
    assert.equal(screenshots.totalCount, 1);
    assert.equal(screenshots.items[0].id, 'capture');

    const notes = store.listItemsPage('page-user', { type: 'notes' });
    assert.equal(notes.totalCount, 1);
    assert.equal(notes.items[0].id, 'note');

    const voiceNotes = store.listItemsPage('page-user', { type: 'voice_notes' });
    assert.equal(voiceNotes.totalCount, 1);
    assert.equal(voiceNotes.items[0].id, 'voice');

    const uploaded = store.listItemsPage('page-user', { type: 'uploaded' });
    assert.equal(uploaded.totalCount, 1);
    assert.equal(uploaded.items[0].id, 'alpha');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localStore uses source saved dates for newest and oldest import ordering', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.upsertImportData({
      userId: 'date-user',
      importId: 'date-import',
      parsed: {
        collections: [],
        items: [
          {
            id: 'older',
            url: 'https://instagram.com/p/older',
            contentType: 'post',
            caption: 'Older save',
            collections: ['Ideas'],
            savedAt: '2026-05-01T10:00:00.000Z',
          },
          {
            id: 'newer',
            url: 'https://instagram.com/p/newer',
            contentType: 'post',
            caption: 'Newer save',
            collections: ['Ideas'],
            savedAt: '2026-05-20T10:00:00.000Z',
          },
        ],
      },
      initialStatus: 'done',
    });

    const newest = store.listItemsPage('date-user', { sort: 'newest' });
    assert.deepEqual(newest.items.map((item) => item.id), ['newer', 'older']);
    assert.equal(newest.items[0].createdAt, '2026-05-20T10:00:00.000Z');

    const oldest = store.listItemsPage('date-user', { sort: 'oldest' });
    assert.deepEqual(oldest.items.map((item) => item.id), ['older', 'newer']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localStore gives date-less imports deterministic newest-first timestamps', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    store.upsertImportData({
      userId: 'date-less-user',
      importId: 'date-less-import',
      parsed: {
        collections: [],
        items: [
          {
            id: 'newest-first',
            url: 'https://instagram.com/p/newest-first',
            contentType: 'post',
            caption: 'Newest after parser reversal',
            collections: ['Ideas'],
            savedAt: '',
          },
          {
            id: 'oldest-last',
            url: 'https://instagram.com/p/oldest-last',
            contentType: 'post',
            caption: 'Oldest after parser reversal',
            collections: ['Ideas'],
            savedAt: '',
          },
        ],
      },
      initialStatus: 'done',
    });

    const newest = store.listItemsPage('date-less-user', { sort: 'newest' });
    const oldest = store.listItemsPage('date-less-user', { sort: 'oldest' });
    assert.deepEqual(newest.items.map((item) => item.id), ['newest-first', 'oldest-last']);
    assert.deepEqual(oldest.items.map((item) => item.id), ['oldest-last', 'newest-first']);
    assert.ok(Date.parse(newest.items[0].createdAt) > Date.parse(newest.items[1].createdAt));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localStore stores item archives and removes them with saved items', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const [created] = store.upsertImportData({
      userId: 'archive-user',
      importId: 'archive-import',
      parsed: {
        collections: [],
        items: [{
          id: 'web-archive',
          url: 'https://example.com/archive',
          contentType: 'unknown',
          caption: 'Archive me',
          collections: ['Research'],
          platform: 'Web',
          platformKey: 'web',
          sourceTitle: 'Archive me',
        }],
      },
      initialStatus: 'done',
    });

    const archive = store.upsertItemArchive('archive-user', created.id, {
      status: 'ready',
      sourceUrl: created.url,
      finalUrl: created.url,
      title: 'Saved copy',
      contentText: 'Readable article text',
      contentHtml: '<p>Readable article text</p>',
      textLength: 21,
      byteSize: 48,
      contentHash: 'hash',
      capturedAt: new Date().toISOString(),
    });

    assert.equal(archive.status, 'ready');
    assert.equal(store.getItems('archive-user')[0].archive.contentText, undefined);
    assert.equal(store.getItem('archive-user', created.id).archive.contentText, 'Readable article text');
    assert.equal(store.getPrivacyExport('archive-user').itemArchives.length, 1);

    store.deleteSavedItem('archive-user', created.id);
    assert.equal(store.getItemArchive('archive-user', created.id), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localStore stores link checks and idempotent reminders', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const [created] = store.upsertImportData({
      userId: 'care-user',
      importId: 'care-import',
      parsed: {
        collections: [],
        items: [{
          id: 'care-link',
          url: 'https://example.com/care',
          contentType: 'unknown',
          caption: 'Care link',
          collections: ['Research'],
          platform: 'Web',
          platformKey: 'web',
          sourceTitle: 'Care link',
        }],
      },
      initialStatus: 'done',
    });

    const check = store.upsertLinkHealthCheck('care-user', created.id, {
      status: 'broken',
      sourceUrl: created.url,
      httpStatus: 404,
      errorCode: 'http_status',
      checkedAt: '2026-05-25T00:00:00.000Z',
    });
    assert.equal(check.status, 'broken');
    assert.equal(store.listLinkHealthChecks('care-user').length, 1);

    const remindAt = '2026-06-01T00:00:00.000Z';
    const first = store.createItemReminder('care-user', created.id, { remindAt, reason: 'week', note: '' });
    const second = store.createItemReminder('care-user', created.id, { remindAt, reason: 'week', note: '' });
    assert.equal(first.id, second.id);
    assert.equal(store.listItemReminders('care-user', { status: 'pending' }).length, 1);

    store.deleteSavedItem('care-user', created.id);
    assert.equal(store.listLinkHealthChecks('care-user').length, 0);
    assert.equal(store.listItemReminders('care-user').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
