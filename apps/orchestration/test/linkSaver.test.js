const assert = require('node:assert/strict');
const test = require('node:test');

const { buildManualSavedItem, normalizeSavedUrl } = require('../src/services/linkSaver');

test('normalizeSavedUrl strips tracking parameters and fragments', () => {
  assert.equal(
    normalizeSavedUrl('https://www.pinterest.com/pin/123/?utm_source=feed&b=2&a=1#comments'),
    'https://pinterest.com/pin/123?a=1&b=2',
  );
});

test('normalizeSavedUrl rejects local and unsafe URLs', () => {
  assert.throws(() => normalizeSavedUrl('javascript:alert(1)'), /Only http and https/);
  assert.throws(() => normalizeSavedUrl('http://localhost/admin'), /Local or private/);
  assert.throws(() => normalizeSavedUrl('http://192.168.1.10/admin'), /Local or private/);
});

test('buildManualSavedItem creates deterministic web save item', () => {
  const first = buildManualSavedItem({ url: 'https://x.com/example/status/1?utm_source=a', title: 'Saved post' });
  const second = buildManualSavedItem({ url: 'https://x.com/example/status/1', title: 'Saved post' });

  assert.equal(first.id, second.id);
  assert.equal(first.contentType, 'unknown');
  assert.equal(first.ownerName, 'X / Twitter');
  assert.match(first.caption, /Saved post/);
  assert.match(first.caption, /Source: X \/ Twitter/);
});
