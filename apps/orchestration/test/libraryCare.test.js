const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLibraryCareSummary,
  duplicateKeyForItem,
  linkCheckCandidates,
  normalizeReminderInput,
} = require('../src/services/libraryCare');

test('library care groups possible duplicates by normalized saved URL', () => {
  const items = [
    { id: 'a', url: 'https://www.example.com/page?utm_source=x', sourceTitle: 'First', createdAt: '2026-01-01T00:00:00.000Z', collections: ['Ideas'], status: 'done' },
    { id: 'b', url: 'https://example.com/page', sourceTitle: 'Second', createdAt: '2026-01-02T00:00:00.000Z', collections: ['Ideas'], status: 'done' },
    { id: 'c', url: 'https://example.com/other', sourceTitle: 'Other', createdAt: '2026-01-03T00:00:00.000Z', collections: ['Ideas'], status: 'done' },
  ];

  const summary = buildLibraryCareSummary({ items, linkChecks: [], reminders: [] });
  assert.equal(summary.cleanup.duplicateGroupCount, 1);
  assert.equal(summary.cleanup.duplicateGroups[0].keepItemId, 'a');
  assert.equal(summary.cleanup.duplicateGroups[0].items.length, 2);
});

test('library care shows only strongly broken link checks as broken links', () => {
  const items = [
    { id: 'ok', url: 'https://example.com/ok', sourceTitle: 'OK', createdAt: '2026-01-01T00:00:00.000Z', status: 'done' },
    { id: 'gone', url: 'https://example.com/gone', sourceTitle: 'Gone', createdAt: '2026-01-01T00:00:00.000Z', status: 'done' },
    { id: 'blocked', url: 'https://example.com/blocked', sourceTitle: 'Blocked', createdAt: '2026-01-01T00:00:00.000Z', status: 'done' },
  ];
  const summary = buildLibraryCareSummary({
    items,
    linkChecks: [
      { itemId: 'ok', status: 'ok', checkedAt: '2026-05-01T00:00:00.000Z' },
      { itemId: 'gone', status: 'broken', httpStatus: 404, checkedAt: '2026-05-01T00:00:00.000Z' },
      { itemId: 'blocked', status: 'unknown', httpStatus: 403, checkedAt: '2026-05-01T00:00:00.000Z' },
    ],
    reminders: [],
  });

  assert.equal(summary.cleanup.brokenLinkCount, 1);
  assert.equal(summary.cleanup.brokenLinks[0].item.id, 'gone');
});

test('library care reminder presets normalize to future dates', () => {
  const nextWeek = normalizeReminderInput({ preset: 'week' });
  assert.equal(nextWeek.reason, 'week');
  assert.ok(new Date(nextWeek.remindAt).getTime() > Date.now());
  assert.throws(() => normalizeReminderInput({ remindAt: '2020-01-01T00:00:00.000Z' }), /future/);
});

test('library care check candidates skip fresh checks and notes', () => {
  const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date().toISOString();
  const items = [
    { id: 'a', url: 'https://example.com/a', contentType: 'unknown' },
    { id: 'b', url: 'https://example.com/b', contentType: 'unknown' },
    { id: 'note', url: 'https://iscraper.local/note', contentType: 'note', platformKey: 'iscraper-note' },
  ];
  const candidates = linkCheckCandidates(items, [
    { itemId: 'a', checkedAt: stale },
    { itemId: 'b', checkedAt: fresh },
  ], 10);

  assert.deepEqual(candidates.map((item) => item.id), ['a']);
  assert.equal(duplicateKeyForItem({ url: 'https://www.example.com/a?utm_source=x#frag' }), 'https://example.com/a');
});
