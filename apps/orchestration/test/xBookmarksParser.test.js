const assert = require('node:assert/strict');
const test = require('node:test');
const JSZip = require('jszip');

const {
  extractXItemsFromText,
  normalizeXUrl,
  parseCsv,
  parseXBookmarksExport,
} = require('../src/services/xBookmarksParser');

test('normalizeXUrl canonicalizes twitter and x status URLs', () => {
  assert.equal(
    normalizeXUrl('https://twitter.com/jack/status/20?s=20'),
    'https://x.com/jack/status/20',
  );
  assert.equal(
    normalizeXUrl('https://x.com/i/status/1234567890'),
    'https://x.com/i/status/1234567890',
  );
  assert.equal(normalizeXUrl('https://example.com/jack/status/20'), '');
});

test('extractXItemsFromText parses official archive-style bookmark js', () => {
  const items = extractXItemsFromText(`
    window.YTD.bookmark.part0 = [
      {
        "bookmark": {
          "tweet": {
            "id": "1777000000000000001",
            "full_text": "Useful creator workflow #design",
            "created_at": "Mon May 20 10:00:00 +0000 2026",
            "screen_name": "creator",
            "name": "Creator Person",
            "entities": {
              "media": [{ "media_url_https": "https://pbs.twimg.com/media/example.jpg" }]
            }
          }
        }
      }
    ];
  `, 'data/bookmark.js');

  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://x.com/creator/status/1777000000000000001');
  assert.equal(items[0].platformKey, 'x-twitter');
  assert.equal(items[0].sourceAuthor, '@creator');
  assert.deepEqual(items[0].hashtags, ['design']);
  assert.equal(items[0].thumbnailUrl, 'https://pbs.twimg.com/media/example.jpg');
});

test('parseXBookmarksExport parses CSV and text URL exports', async () => {
  const parsed = await parseXBookmarksExport([
    {
      originalname: 'bookmarks.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('tweet_url,text,username,created_at\nhttps://x.com/team/status/1777000000000000002,"Launch thread #saas",team,"Mon May 20 10:00:00 +0000 2026"\n'),
    },
    {
      originalname: 'x-links.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('https://twitter.com/design/status/1777000000000000003\n'),
    },
  ]);

  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.collections[0].name, 'X bookmarks');
  assert.equal(parsed.items[0].savedAt, '2026-05-20T10:00:00.000Z');
  assert.equal(parsed.items[0].sourceTitle, 'Launch thread #saas');
  assert.equal(parsed.items[1].url, 'https://x.com/design/status/1777000000000000003');
});

test('parseXBookmarksExport reads bookmark files inside ZIP exports', async () => {
  const zip = new JSZip();
  zip.file('data/bookmark.js', 'window.YTD.bookmark.part0 = [{"bookmark":{"tweet":{"id":"1777000000000000004","full_text":"Saved product idea","screen_name":"builder"}}}];');
  zip.file('data/profile.js', 'https://x.com/not/status/1777000000000000005');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  const parsed = await parseXBookmarksExport([{
    originalname: 'twitter-archive.zip',
    mimetype: 'application/zip',
    buffer,
  }]);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].url, 'https://x.com/builder/status/1777000000000000004');
});

test('parseCsv returns objects for common bookmark export headers', () => {
  const rows = parseCsv('Tweet URL,Text,Author\n"https://x.com/a/status/1777000000000000006","hello, world","A"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tweet_url, 'https://x.com/a/status/1777000000000000006');
  assert.equal(rows[0].text, 'hello, world');
});
