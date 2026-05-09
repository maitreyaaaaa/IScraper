const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { parseImportExport } = require('../src/services/exportParser');

test('parseImportExport reads Instagram saved files from nested ZIP path only', async () => {
  const zip = new JSZip();
  zip.file('instagram-user-date-code/start_here.html', '<a href="https://www.instagram.com/reel/START111/">ignore</a>');
  zip.file('instagram-user-date-code/your_instagram_activity/saved/saved_music.html', '<a href="https://www.instagram.com/reel/MUSIC111/">ignore</a>');
  zip.file('instagram-user-date-code/your_instagram_activity/saved/saved_posts.html', `
    <main>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/POST111/">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Saved post</td></tr>
      </table></div>
    </main>`);
  zip.file('instagram-user-date-code/your_instagram_activity/saved/saved_collections.html', `
    <main>
      <div class="_a6-g">
        <table>
          <tr><td class="_a6_q">Name</td><td class="_2piu _a6_r">Ideas</td></tr>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/POST111/">x</a></div></td></tr>
        </table>
      </div>
    </main>`);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const parsed = await parseImportExport([{
    originalname: 'instagram-user-date-code.zip',
    mimetype: 'application/zip',
    size: buffer.length,
    buffer,
  }]);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, 'POST111');
  assert.deepEqual(parsed.items[0].collections, ['Instagram saved posts', 'Ideas']);
});
