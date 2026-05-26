const crypto = require('crypto');
const { hashExtensionToken } = require('../services/extensionTokens');
const { isDeletionBlockingStatus, publicDeletionRequest } = require('../services/accountDeletion');

async function getUser(req, store) {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (token && typeof store.getUserFromToken === 'function') {
    return store.getUserFromToken(token);
  }
  if (store.requiresAuth) {
    const error = new Error('Sign in is required.');
    error.statusCode = 401;
    throw error;
  }
  return {
    id: req.header('x-user-id') || 'local-dev-user',
    email: req.header('x-user-email') || 'local@example.com',
  };
}

async function getExtensionUser(req, store, requiredScope = 'lens:search') {
  const token = String(req.header('x-iscraper-extension-token') || '').trim();
  if (!token || typeof store.getUserForExtensionToken !== 'function') {
    const error = new Error('Connect the IScraper extension before saving from Chrome.');
    error.statusCode = 401;
    throw error;
  }
  const user = await store.getUserForExtensionToken(hashExtensionToken(token), requiredScope);
  if (!user) {
    const error = new Error('Extension token is invalid, expired, or revoked.');
    error.statusCode = 401;
    throw error;
  }
  return user;
}

async function getAgentUser(req, store, requiredScope = 'agent:access') {
  const auth = req.header('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const token = String(req.header('x-iscraper-agent-token') || bearer || '').trim();
  if (!token || typeof store.getUserForExtensionToken !== 'function') {
    const error = new Error('Agent access token is required.');
    error.statusCode = 401;
    throw error;
  }
  const user = await store.getUserForExtensionToken(hashExtensionToken(token), requiredScope);
  if (!user) {
    const error = new Error('Agent access token is invalid, expired, revoked, or missing the required scope.');
    error.statusCode = 401;
    throw error;
  }
  return user;
}

async function assertAdmin(req, config, store) {
  const provided = req.header('x-admin-api-key') || '';
  if (config.adminApiKey && provided) {
    const expected = String(config.adminApiKey);
    const validLength = Buffer.byteLength(provided) === Buffer.byteLength(expected);
    const valid = validLength && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (valid) return { id: 'admin-api-key', email: req.header('x-admin-actor') || 'admin-api' };
  }

  const adminEmails = new Set((config.adminEmails || []).map((email) => String(email).toLowerCase()));
  const email = String(req.header('x-admin-email') || '').trim().toLowerCase();
  const password = String(req.header('x-admin-password') || '');
  if (adminEmails.size && config.adminPassword && email && password) {
    const expected = String(config.adminPassword);
    const validLength = Buffer.byteLength(password) === Buffer.byteLength(expected);
    const validPassword = validLength && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
    if (validPassword && adminEmails.has(email)) return { id: email, email };
  }

  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (adminEmails.size && token && typeof store.getUserFromToken === 'function') {
    const user = await store.getUserFromToken(token);
    if (adminEmails.has(String(user.email || '').toLowerCase())) return user;
  }

  if (!config.adminApiKey && !adminEmails.size) {
    const error = new Error('Admin API is not configured.');
    error.statusCode = 503;
    throw error;
  }

  const error = new Error('Admin access denied.');
  error.statusCode = 403;
  throw error;
}

function assertWorker(req, config) {
  const expected = config.workerApiKey;
  if (!expected) {
    const error = new Error('Worker API is not configured.');
    error.statusCode = 503;
    throw error;
  }

  const auth = req.header('authorization') || '';
  const provided = req.header('x-worker-api-key') || (auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '');
  const validLength = Buffer.byteLength(provided) === Buffer.byteLength(expected);
  const valid = validLength && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (valid) return;

  const error = new Error('Worker access denied.');
  error.statusCode = 403;
  throw error;
}

async function requireCompletedProfile(req, store) {
  if (!store.requiresAuth || typeof store.getProfile !== 'function') return;
  if (typeof store.getUserAdminState === 'function') {
    const state = await store.getUserAdminState(req.user.id);
    if (state?.status === 'blocked') {
      const error = new Error('This account is blocked. Contact support if this looks wrong.');
      error.statusCode = 403;
      throw error;
    }
  }
  const profile = await store.getProfile(req.user.id);
  if (!profile?.username) {
    const error = new Error('Create your username before importing saved posts.');
    error.statusCode = 428;
    throw error;
  }
}

async function requireAccountNotDeleting(req, store) {
  if (typeof store.getActiveDeletionRequest !== 'function') return;
  const deletion = await store.getActiveDeletionRequest(req.user.id);
  if (deletion && isDeletionBlockingStatus(deletion.status)) {
    const error = new Error('Account deletion is pending. You can export data, check deletion status, cancel while allowed, or log out.');
    error.statusCode = 423;
    error.deletion = publicDeletionRequest(deletion);
    throw error;
  }
}

module.exports = {
  assertAdmin,
  assertWorker,
  getAgentUser,
  getExtensionUser,
  getUser,
  requireAccountNotDeleting,
  requireCompletedProfile,
};
