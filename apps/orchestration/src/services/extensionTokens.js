const crypto = require('crypto');

const DEFAULT_EXTENSION_SCOPES = [
  'lens:search',
  'saves:create',
  'saves:delete',
  'captures:create',
  'captures:delete',
];
const DEFAULT_AGENT_SCOPES = [
  'agent:access',
  'library:search',
  'library:read',
];

function generateExtensionToken() {
  return `isx_${crypto.randomBytes(32).toString('base64url')}`;
}

function generateAgentToken() {
  return `isa_${crypto.randomBytes(32).toString('base64url')}`;
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

function defaultAgentExpiry() {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString();
}

module.exports = {
  DEFAULT_AGENT_SCOPES,
  DEFAULT_EXTENSION_SCOPES,
  defaultAgentExpiry,
  defaultExtensionExpiry,
  generateAgentToken,
  generateExtensionToken,
  hashExtensionToken,
  publicExtensionToken,
};
