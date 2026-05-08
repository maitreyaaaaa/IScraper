const crypto = require('crypto');

const DEFAULT_EXTENSION_SCOPES = ['lens:search'];

function generateExtensionToken() {
  return `isx_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashExtensionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function publicExtensionToken(row) {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes || [],
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
    expiresAt: row.expiresAt || null,
    revokedAt: row.revokedAt || null,
  };
}

function defaultExtensionExpiry() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
}

module.exports = {
  DEFAULT_EXTENSION_SCOPES,
  defaultExtensionExpiry,
  generateExtensionToken,
  hashExtensionToken,
  publicExtensionToken,
};
