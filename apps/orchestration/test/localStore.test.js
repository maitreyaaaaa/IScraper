const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { createLocalStore } = require('../src/stores/localStore');

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
        ],
      },
      initialStatus: 'done',
    });

    const first = store.listItemsPage('page-user', { limit: 1, sort: 'title' });
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].id, 'alpha');
    assert.equal(first.totalCount, 2);
    assert.ok(first.nextCursor);
    assert.deepEqual(first.facets.collections, ['all', 'Ideas', 'Research']);

    const second = store.listItemsPage('page-user', { limit: 1, sort: 'title', cursor: first.nextCursor });
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].id, 'beta');
    assert.equal(second.nextCursor, null);

    const links = store.listItemsPage('page-user', { type: 'links' });
    assert.equal(links.totalCount, 1);
    assert.equal(links.items[0].id, 'beta');
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
