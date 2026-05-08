const assert = require('node:assert/strict');
const test = require('node:test');

const { parseInstagramExport } = require('../src/services/instagramParser');

test('parseInstagramExport extracts every saved post with owner, hashtags, and date', () => {
  const savedPostsHtml = `
    <main>
      <div class="_a6-g">
        <table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/AAA111/">https://www.instagram.com/reel/AAA111/</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Claude and GitHub repo walkthrough #ai #github</td></tr>
          <tr><td class="_a6_q">Name</td><td class="_2piu _a6_r">Tech Builder</td></tr>
          <tr><td class="_a6_q">Username</td><td class="_2piu _a6_r">tech.builder</td></tr>
        </table>
        <div class="_3-94 _a6-o">May 05, 2026 3:07 am</div>
      </div>
      <div class="_a6-g">
        <table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/BBB222/">https://www.instagram.com/p/BBB222/</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Carousel about Gemini prompts #gemini</td></tr>
          <tr><td class="_a6_q">Username</td><td class="_2piu _a6_r">prompt.person</td></tr>
        </table>
        <div class="_3-94 _a6-o">May 04, 2026 8:00 pm</div>
      </div>
    </main>`;

  const result = parseInstagramExport([{ originalname: 'saved_posts.html', buffer: Buffer.from(savedPostsHtml) }]);

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, 'AAA111');
  assert.equal(result.items[0].contentType, 'reel');
  assert.match(result.items[0].caption, /Claude/);
  assert.deepEqual(result.items[0].hashtags, ['ai', 'github']);
  assert.equal(result.items[0].ownerUsername, 'tech.builder');
  assert.equal(result.items[0].platform, 'Instagram');
  assert.equal(result.items[0].platformKey, 'instagram');
  assert.equal(result.items[0].sourceId, 'AAA111');
  assert.equal(result.items[0].sourceAuthor, 'tech.builder');
  assert.equal(result.items[1].contentType, 'post');
});

test('parseInstagramExport links collection names to saved items', () => {
  const collectionsHtml = `
    <main>
      <div class="_a6-g">
        <table>
          <tr><td class="_a6_q">Name</td><td class="_2piu _a6_r">AI Tools</td></tr>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/AAA111/">https://www.instagram.com/reel/AAA111/</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Claude tool demo</td></tr>
        </table>
      </div>
    </main>`;

  const result = parseInstagramExport([{ originalname: 'saved_collections.html', buffer: Buffer.from(collectionsHtml) }]);

  assert.equal(result.collections.length, 1);
  assert.equal(result.collections[0].name, 'AI Tools');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].collections, ['AI Tools']);
});

test('parseInstagramExport canonicalizes Instagram URLs before deduping', () => {
  const html = `
    <main>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/AAA111/?utm_source=ig_web_copy_link">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">First caption #one</td></tr>
      </table></div>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://m.instagram.com/reel/AAA111">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Duplicate caption #two</td></tr>
      </table></div>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/BBB222/?igsh=abc">x</a></div></td></tr>
      </table></div>
    </main>`;

  const result = parseInstagramExport([{ originalname: 'saved_posts.html', buffer: Buffer.from(html) }]);

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].url, 'https://instagram.com/reel/AAA111');
  assert.equal(result.items[0].id, 'AAA111');
  assert.equal(result.items[1].url, 'https://instagram.com/p/BBB222');
});
