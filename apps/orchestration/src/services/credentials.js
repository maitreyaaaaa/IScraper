const crypto = require('crypto');

function deriveKey(encryptionKey) {
  if (!encryptionKey) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is required to store encrypted secrets.');
  }
  return crypto.createHash('sha256').update(String(encryptionKey)).digest();
}

function encryptSecret(secret, encryptionKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decryptSecret(encryptedSecret, encryptionKey) {
  const [version, ivValue, tagValue, payloadValue] = String(encryptedSecret || '').split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !payloadValue) {
    throw new Error('Unsupported encrypted credential format.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(encryptionKey), Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payloadValue, 'base64')), decipher.final()]).toString('utf8');
}

function maskSecret(secret) {
  const value = String(secret || '');
  if (value.length <= 4) return value ? `${value[0]}...` : '';
  if (value.length <= 8) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

module.exports = {
  decryptSecret,
  encryptSecret,
  maskSecret,
};
