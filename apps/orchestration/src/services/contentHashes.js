const crypto = require('node:crypto');
const path = require('node:path');

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(compact).filter(Boolean))].sort();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function buildAnalysisInputHash(item = {}, mediaPaths = []) {
  return sha256(JSON.stringify({
    url: compact(item.url),
    platformKey: compact(item.platformKey),
    sourceId: compact(item.sourceId || item.id),
    sourceTitle: compact(item.sourceTitle),
    sourceDescription: compact(item.sourceDescription),
    contentType: compact(item.contentType),
    caption: compact(item.caption),
    hashtags: stableArray(item.hashtags),
    collections: stableArray(item.collections),
    mediaRefs: stableArray(mediaPaths.map((entry) => path.basename(String(entry || '')))),
  }));
}

function buildEmbeddingContentHash(content = '') {
  return sha256(compact(content));
}

module.exports = {
  buildAnalysisInputHash,
  buildEmbeddingContentHash,
};
