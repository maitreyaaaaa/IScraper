const {
  MAX_NOTE_IMAGES,
  MAX_NOTE_IMAGE_BYTES,
  NOTE_ASSET_BUCKET,
  assertNoteImageFile,
  noteAssetStoragePath,
} = require('../services/notes');
const { ensureNoteAssetBucket } = require('../http/uploads');

function createNoteAssetWorkflow({ store, config }) {
  async function persistNoteImages({ userId, itemId, files = [] }) {
    if (!files.length) return [];
    if (files.length > MAX_NOTE_IMAGES) {
      const error = new Error(`Notes support up to ${MAX_NOTE_IMAGES} images.`);
      error.statusCode = 400;
      throw error;
    }

    const assets = [];
    for (const file of files) assertNoteImageFile(file);

    if (store.client?.storage) {
      const bucket = await ensureNoteAssetBucket(store, config);
      for (const file of files) {
        const storagePath = noteAssetStoragePath({ userId, itemId, file });
        const { error } = await store.client.storage.from(bucket).upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
        if (error) throw error;
        assets.push(await store.addItemAsset(userId, itemId, {
          assetType: 'image',
          storagePath,
          mimeType: file.mimetype,
        }));
      }
      return assets.filter(Boolean);
    }

    for (const file of files) {
      assets.push(await store.addItemAsset(userId, itemId, {
        assetType: 'image',
        storagePath: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
        mimeType: file.mimetype,
      }));
    }
    return assets.filter(Boolean);
  }

  async function removeNoteAssetObjects({ assets = [] }) {
    const storagePaths = assets
      .map((asset) => asset.storagePath)
      .filter((storagePath) => storagePath && !String(storagePath).startsWith('data:'));
    if (!storagePaths.length || !store.client?.storage) return;
    const bucket = config.noteAssetBucket || NOTE_ASSET_BUCKET;
    await store.client.storage.from(bucket).remove(storagePaths).catch((error) => {
      console.warn(`Could not remove note image files: ${error.message}`);
    });
  }

  return {
    removeNoteAssetObjects,
    persistNoteImages,
  };
}

module.exports = {
  MAX_NOTE_IMAGE_BYTES,
  createNoteAssetWorkflow,
};
