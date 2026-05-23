const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { analyzeMediaWithCredential } = require('./providerClients');

const MAX_LENS_CROP_BYTES = 750 * 1024;
const LENS_IMAGE_TYPES = {
  png: { mimeType: 'image/png', extension: '.png' },
  jpeg: { mimeType: 'image/jpeg', extension: '.jpg' },
  jpg: { mimeType: 'image/jpeg', extension: '.jpg' },
  webp: { mimeType: 'image/webp', extension: '.webp' },
};

function cleanLensText(value, maxLength = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseLensCrop(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error('Lens image search needs a PNG, JPEG, or WebP crop.');
    error.statusCode = 400;
    throw error;
  }

  const type = LENS_IMAGE_TYPES[match[1].toLowerCase()];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_LENS_CROP_BYTES) {
    const error = new Error('Lens crop is too large. Select a smaller area.');
    error.statusCode = 413;
    throw error;
  }

  return { ...type, buffer };
}

function lensQueryFromAnalysis(analysis = {}) {
  return [
    analysis.title,
    analysis.ocrText,
    analysis.visualDescription,
    analysis.summary,
    ...(analysis.brandsMentioned || []),
    ...(analysis.toolsMentioned || []),
    ...(analysis.topics || []),
    ...(analysis.tags || []),
  ].map((part) => cleanLensText(part, 120)).filter(Boolean).join(' ').slice(0, 500);
}

async function describeLensCrop({ dataUrl, credential, fetchImpl = fetch }) {
  const parsed = parseLensCrop(dataUrl);
  if (!credential?.apiKey) {
    const error = new Error('Connect a media AI key before using Lens image search.');
    error.statusCode = 428;
    throw error;
  }

  const tempPath = path.join(os.tmpdir(), `iscraper-lens-${crypto.randomUUID()}${parsed.extension}`);
  await fs.writeFile(tempPath, parsed.buffer);
  try {
    const analysis = await analyzeMediaWithCredential({
      credential,
      mediaPaths: [tempPath],
      item: {
        id: 'lens-crop',
        url: '',
        caption: 'User-selected Lens crop for private library search.',
      },
      fetchImpl,
    });
    const query = lensQueryFromAnalysis(analysis);
    if (!query) {
      const error = new Error('The crop could not be understood. Try selecting a clearer area.');
      error.statusCode = 422;
      throw error;
    }
    return { analysis, query };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

module.exports = {
  MAX_LENS_CROP_BYTES,
  cleanLensText,
  describeLensCrop,
  lensQueryFromAnalysis,
  parseLensCrop,
};
