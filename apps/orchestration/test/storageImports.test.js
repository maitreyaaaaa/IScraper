const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { processStorageImport } = require('../src/services/storageImports');
const { createLocalStore } = require('../src/stores/localStore');

test('processStorageImport skips duplicate export rows without mutating existing saved items', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-'));
  const store = createLocalStore({ dataPath: dir });
  let html = `
    <main>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/reel/BG111/">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Background import reel</td></tr>
      </table></div>
    </main>`;
  const removedPaths = [];

  store.client = {
    storage: {
      from() {
        return {
          async download(storagePath) {
            assert.equal(storagePath, 'local-dev-user/imports/background.html');
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

  try {
    const firstImport = store.createImport({
      userId: 'local-dev-user',
      source: 'user-export',
      status: 'queued_storage',
      storageFiles: [{ path: 'local-dev-user/imports/background.html', name: 'saved_posts.html', type: 'text/html' }],
    });
    const first = await processStorageImport({ store, config: {}, importEntry: firstImport });
    const originalItem = store.getItem('local-dev-user', 'BG111');
    store.saveAnalysis('local-dev-user', 'BG111', { title: 'Background done' });

    html = `
      <main>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://m.instagram.com/reel/BG111/?igsh=abc">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Duplicate background reel</td></tr>
        </table></div>
        <div class="_a6-g"><table>
          <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/BG222/">x</a></div></td></tr>
          <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">New background post</td></tr>
        </table></div>
      </main>`;
    const secondImport = store.createImport({
      userId: 'local-dev-user',
      source: 'user-export',
      status: 'queued_storage',
      storageFiles: [{ path: 'local-dev-user/imports/background.html', name: 'saved_posts.html', type: 'text/html' }],
    });
    const second = await processStorageImport({ store, config: {}, importEntry: secondImport });
    const existingItem = store.getItem('local-dev-user', 'BG111');
    const jobs = store.getJobs('local-dev-user');

    assert.equal(first.status, 'imported');
    assert.equal(first.newItemCount, 1);
    assert.equal(second.status, 'imported');
    assert.equal(second.itemCount, 2);
    assert.equal(second.newItemCount, 1);
    assert.equal(second.skippedDuplicateCount, 1);
    assert.equal(second.queuedJobCount, 1);
    assert.equal(existingItem.importId, originalItem.importId);
    assert.equal(existingItem.caption, 'Background import reel');
    assert.equal(existingItem.status, 'done');
    assert.equal(store.getItems('local-dev-user').length, 2);
    assert.equal(jobs.filter((job) => job.itemId === 'BG111').length, 1);
    assert.equal(jobs.filter((job) => job.itemId === 'BG222').length, 1);
    assert.deepEqual(removedPaths, [
      'local-dev-user/imports/background.html',
      'local-dev-user/imports/background.html',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
