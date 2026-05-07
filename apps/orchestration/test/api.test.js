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
