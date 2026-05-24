const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  DEFAULT_MAX_JOB_ATTEMPTS,
  createJobsForImport,
  hasActiveLease,
  isAttemptExhausted,
  isReclaimableJob,
  isRestartableJob,
  isRetryDue,
  PAUSED_JOB_STATUSES,
} = require('../services/queue');
const { searchItemsWithDetails } = require('../services/analyzer');
const { decryptSecret, encryptSecret, maskSecret, publicCredential } = require('../services/credentials');
const {
  OPENAI_COMPATIBLE_PROVIDER,
  assertMediaModelAllowed,
  assertOpenAICompatibleConfig,
  assertProviderPurpose,
  normalizeOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleDisplayName,
} = require('../services/providers');
const { DEFAULT_CREDIT_PACKAGES, FREE_ITEMS_LIMIT, normalizePackage } = require('../services/credits');
const { normalizeUsername, publicProfile } = require('../services/profiles');
const { publicExtensionToken } = require('../services/extensionTokens');
const { ACTIVE_DELETION_STATUSES, hashDeletionValue } = require('../services/accountDeletion');
const { publicNoteAsset } = require('../services/notes');

const DEFAULT_USER_ID = 'local-dev-user';

function now() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function seedFromLegacyIndex(dataPath) {
  const legacyFile = path.join(dataPath, 'index.json');
  if (!fs.existsSync(legacyFile)) {
    return emptyState();
  }

  const legacy = readJson(legacyFile, []);
  return {
    users: [{ id: DEFAULT_USER_ID, email: 'local@example.com', createdAt: now() }],
    imports: [],
    collections: [],
    jobs: [],
    providerCredentials: [],
    creditPackages: DEFAULT_CREDIT_PACKAGES,
    creditPurchases: [],
    creditTransactions: [],
    analysisUsageEvents: [],
    adminCreditAdjustments: [],
    feedback: [],
    searchEvents: [],
    searchFeedback: [],
    userAdminStates: [],
    userActivityEvents: [],
    profiles: [],
    extensionTokens: [],
    lensSearchEvents: [],
    itemAssets: [],
    accountDeletionRequests: [],
    accountDeletionSteps: [],
    accountDeletionAudit: [],
    accountDeletionTombstones: [],
    items: legacy.map((item) => ({
      ...item,
      userId: DEFAULT_USER_ID,
      importId: null,
      contentType: item.url?.includes('/reel/') ? 'reel' : 'post',
      platform: 'Instagram',
      platformKey: 'instagram',
      sourceId: item.id || '',
      sourceTitle: item.title || '',
      sourceAuthor: item.ownerUsername || item.ownerName || '',
      sourceDescription: item.caption || item.description || '',
      thumbnailUrl: '',
      status: item.error ? 'failed' : 'done',
      collections: item.collections || [],
      analysis: item.title
        ? {
            title: item.title,
            summary: item.description || item.caption || '',
            transcript: item.transcript || '',
            visualDescription: item.description || '',
            tags: item.tags || [],
            brandsMentioned: [],
            toolsMentioned: [],
            reposMentioned: [],
            peopleMentioned: [],
            topics: [],
            whyUseful: '',
          }
        : null,
      createdAt: item.processedAt || now(),
      updatedAt: now(),
    })),
  };
}

function emptyState() {
  return {
    users: [],
    imports: [],
    items: [],
    collections: [],
    jobs: [],
    providerCredentials: [],
    creditPackages: DEFAULT_CREDIT_PACKAGES,
    creditPurchases: [],
    creditTransactions: [],
    analysisUsageEvents: [],
    adminCreditAdjustments: [],
    feedback: [],
    searchEvents: [],
    searchFeedback: [],
    profiles: [],
    extensionTokens: [],
    lensSearchEvents: [],
    itemAssets: [],
    accountDeletionRequests: [],
    accountDeletionSteps: [],
    accountDeletionAudit: [],
    accountDeletionTombstones: [],
  };
}

function normalizeState(state) {
  return {
    ...emptyState(),
    ...state,
    providerCredentials: state.providerCredentials || [],
    creditPackages: (state.creditPackages?.length ? state.creditPackages : DEFAULT_CREDIT_PACKAGES).map(normalizePackage),
    creditPurchases: state.creditPurchases || [],
    creditTransactions: state.creditTransactions || [],
    analysisUsageEvents: state.analysisUsageEvents || [],
    adminCreditAdjustments: state.adminCreditAdjustments || [],
    feedback: state.feedback || [],
    searchEvents: state.searchEvents || [],
    searchFeedback: state.searchFeedback || [],
    userAdminStates: state.userAdminStates || [],
    userActivityEvents: state.userActivityEvents || [],
    jobs: (state.jobs || []).map(normalizeJob),
    profiles: state.profiles || [],
    extensionTokens: state.extensionTokens || [],
    lensSearchEvents: state.lensSearchEvents || [],
    itemAssets: state.itemAssets || [],
    accountDeletionRequests: state.accountDeletionRequests || [],
    accountDeletionSteps: state.accountDeletionSteps || [],
    accountDeletionAudit: state.accountDeletionAudit || [],
    accountDeletionTombstones: state.accountDeletionTombstones || [],
  };
}

function normalizeJob(job) {
  return {
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    claimedAt: null,
    completedAt: null,
    lastErrorAt: null,
    ...job,
  };
}

function adminUserSummary(state, user, credits) {
  const profile = state.profiles.find((entry) => entry.userId === user.id) || null;
  const adminState = state.userAdminStates.find((entry) => entry.userId === user.id) || null;
  const items = state.items.filter((entry) => entry.userId === user.id);
  const itemStats = items.reduce((stats, item) => {
    stats.total += 1;
    stats.byStatus[item.status || 'unknown'] = (stats.byStatus[item.status || 'unknown'] || 0) + 1;
    return stats;
  }, { total: 0, byStatus: {} });
  const usageStats = state.analysisUsageEvents
    .filter((entry) => entry.userId === user.id)
    .reduce((stats, entry) => {
      stats[entry.source || 'unknown'] = (stats[entry.source || 'unknown'] || 0) + 1;
      return stats;
    }, {});

  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    lastSignInAt: user.lastSignInAt || null,
    profile: profile ? publicProfile(profile) : null,
    adminState: adminState || { userId: user.id, status: 'active', blockedAt: null, blockedReason: '' },
    credits,
    itemStats: {
      ...itemStats,
      indexed: itemStats.byStatus.done || 0,
      queued: itemStats.byStatus.queued || 0,
      failed: itemStats.byStatus.failed || 0,
      needsReview: itemStats.byStatus.needs_review || 0,
    },
    usageStats,
  };
}

function localItemAssets(state, userId, itemId) {
  return (state.itemAssets || [])
    .filter((asset) => asset.userId === userId && asset.itemId === itemId)
    .map(publicNoteAsset);
}

function hydrateLocalItem(state, item) {
  if (!item) return null;
  item.assets = localItemAssets(state, item.userId, item.id);
  return item;
}

function createLocalStore({ dataPath }) {
  const file = path.join(dataPath, 'brain.local.json');
  let state = normalizeState(readJson(file, null) || seedFromLegacyIndex(dataPath));

  function save() {
    writeJson(file, state);
  }

  function ensureUser(userId, email) {
    assertUserNotDeleted(userId, email);
    if (!state.users.find((user) => user.id === userId)) {
      state.users.push({ id: userId, email, createdAt: now() });
      save();
    }
  }

  function assertUserNotDeleted(userId, email) {
    const userIdHash = hashDeletionValue(userId);
    const emailHash = hashDeletionValue(email);
    const tombstone = state.accountDeletionTombstones.find((entry) => (
      entry.userIdHash === userIdHash || (email && entry.emailHash === emailHash)
    ));
    if (tombstone) {
      const error = new Error('This account has been deleted. Contact support if this looks wrong.');
      error.statusCode = 410;
      throw error;
    }
  }

  function mapDeletionRequest(request) {
    if (!request) return null;
    const steps = state.accountDeletionSteps
      .filter((step) => step.requestId === request.id)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return { ...request, steps };
  }

  function activeDeletionRequestForUser(userId) {
    return state.accountDeletionRequests
      .filter((request) => request.userId === userId && ACTIVE_DELETION_STATUSES.has(request.status))
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))[0] || null;
  }

  function deleteFromArrayByUser(key, userId) {
    const before = state[key].length;
    state[key] = state[key].filter((entry) => entry.userId !== userId);
    return before - state[key].length;
  }

  return {
    ensureUser,
    assertUserNotDeleted,

    getActiveDeletionRequest(userId) {
      return mapDeletionRequest(activeDeletionRequestForUser(userId));
    },

    getDeletionRequestById(id) {
      return mapDeletionRequest(state.accountDeletionRequests.find((request) => request.id === id) || null);
    },

    createDeletionRequest({ userId, email, reason = '', exportConfirmed = false }) {
      const active = activeDeletionRequestForUser(userId);
      if (active) return mapDeletionRequest(active);
      const request = {
        id: `deletion-${Date.now()}-${state.accountDeletionRequests.length + 1}`,
        userId,
        userIdHash: hashDeletionValue(userId),
        emailHash: hashDeletionValue(email),
        status: 'pending_approval',
        reason: String(reason || '').trim().slice(0, 500),
        exportConfirmed: Boolean(exportConfirmed),
        requestedAt: now(),
        approvedAt: null,
        executingAt: null,
        completedAt: null,
        canceledAt: null,
        adminActor: null,
        statusMessage: 'Deletion request is waiting for admin review.',
        retentionSummary: {},
        createdAt: now(),
        updatedAt: now(),
      };
      state.accountDeletionRequests.push(request);
      save();
      return mapDeletionRequest(request);
    },

    cancelDeletionRequestForUser(userId) {
      const request = activeDeletionRequestForUser(userId);
      if (!request || !['requested', 'pending_approval'].includes(request.status)) return null;
      Object.assign(request, {
        status: 'canceled',
        canceledAt: now(),
        statusMessage: 'Deletion request canceled by user.',
        updatedAt: now(),
      });
      save();
      return mapDeletionRequest(request);
    },

    listDeletionRequests({ limit = 50 } = {}) {
      return [...state.accountDeletionRequests]
        .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
        .slice(0, Math.max(1, Math.min(Number(limit) || 50, 100)))
        .map((request) => mapDeletionRequest(request));
    },

    approveDeletionRequest({ id, adminActor }) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      if (!['requested', 'pending_approval', 'partially_failed'].includes(request.status)) return mapDeletionRequest(request);
      Object.assign(request, {
        status: 'approved',
        approvedAt: now(),
        adminActor,
        statusMessage: 'Deletion request approved. Waiting for execution.',
        updatedAt: now(),
      });
      save();
      return mapDeletionRequest(request);
    },

    cancelDeletionRequestAsAdmin({ id, adminActor, reason = '' }) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      if (['executing', 'completed'].includes(request.status)) return mapDeletionRequest(request);
      Object.assign(request, {
        status: 'canceled',
        canceledAt: now(),
        adminActor,
        statusMessage: reason || 'Deletion request canceled by admin.',
        updatedAt: now(),
      });
      save();
      return mapDeletionRequest(request);
    },

    markDeletionRequestExecuting(id) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, {
        status: 'executing',
        executingAt: request.executingAt || now(),
        statusMessage: 'Deletion is executing.',
        updatedAt: now(),
      });
      save();
      return mapDeletionRequest(request);
    },

    markDeletionRequestPartiallyFailed(id, message) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, {
        status: 'partially_failed',
        statusMessage: message || 'Deletion partially failed. Admin retry is required.',
        updatedAt: now(),
      });
      save();
      return mapDeletionRequest(request);
    },

    recordDeletionStep({ requestId, stepKey, status, error = '', metadata = {} }) {
      let step = state.accountDeletionSteps.find((entry) => entry.requestId === requestId && entry.stepKey === stepKey);
      if (!step) {
        step = {
          id: `deletion-step-${Date.now()}-${state.accountDeletionSteps.length + 1}`,
          requestId,
          stepKey,
          status: 'pending',
          attempts: 0,
          startedAt: null,
          finishedAt: null,
          redactedError: '',
          metadata: {},
          createdAt: now(),
          updatedAt: now(),
        };
        state.accountDeletionSteps.push(step);
      }
      if (status === 'running') {
        step.attempts += 1;
        step.startedAt = now();
        step.finishedAt = null;
      }
      if (['completed', 'failed', 'skipped'].includes(status)) {
        step.finishedAt = now();
      }
      Object.assign(step, {
        status,
        redactedError: error || '',
        metadata: { ...(step.metadata || {}), ...(metadata || {}) },
        updatedAt: now(),
      });
      save();
      return step;
    },

    freezeUserForDeletion(userId) {
      let revokedTokens = 0;
      state.extensionTokens.forEach((token) => {
        if (token.userId === userId && !token.revokedAt) {
          token.revokedAt = now();
          revokedTokens += 1;
        }
      });
      let disabledCredentials = 0;
      state.providerCredentials.forEach((credential) => {
        if (credential.userId === userId && credential.status !== 'disabled') {
          credential.status = 'disabled';
          credential.updatedAt = now();
          disabledCredentials += 1;
        }
      });
      let canceledJobs = 0;
      state.jobs.forEach((job) => {
        if (job.userId === userId && ['queued', 'downloading', 'analyzing', ...PAUSED_JOB_STATUSES].includes(job.status)) {
          Object.assign(job, {
            status: 'failed',
            error: 'Account deletion requested.',
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            updatedAt: now(),
          });
          canceledJobs += 1;
        }
      });
      save();
      return { revokedTokens, disabledCredentials, canceledJobs };
    },

    deleteUserStorageObjects(_userId) {
      return { deletedObjects: 0, buckets: [], skipped: true };
    },

    deleteUserContentData(userId) {
      const deleted = {
        jobs: deleteFromArrayByUser('jobs', userId),
        items: deleteFromArrayByUser('items', userId),
        collections: deleteFromArrayByUser('collections', userId),
        imports: deleteFromArrayByUser('imports', userId),
        lensSearchEvents: deleteFromArrayByUser('lensSearchEvents', userId),
        searchEvents: deleteFromArrayByUser('searchEvents', userId),
        searchFeedback: deleteFromArrayByUser('searchFeedback', userId),
      };
      save();
      return deleted;
    },

    deleteUserAccessData(userId) {
      const deleted = {
        providerCredentials: deleteFromArrayByUser('providerCredentials', userId),
        extensionTokens: deleteFromArrayByUser('extensionTokens', userId),
      };
      save();
      return deleted;
    },

    deleteUserProfileData(userId) {
      const deleted = {
        profiles: deleteFromArrayByUser('profiles', userId),
        userAdminStates: deleteFromArrayByUser('userAdminStates', userId),
        userActivityEvents: deleteFromArrayByUser('userActivityEvents', userId),
        analysisUsageEvents: deleteFromArrayByUser('analysisUsageEvents', userId),
        creditTransactions: deleteFromArrayByUser('creditTransactions', userId),
        creditPurchases: deleteFromArrayByUser('creditPurchases', userId),
        adminCreditAdjustments: deleteFromArrayByUser('adminCreditAdjustments', userId),
      };
      save();
      return deleted;
    },

    deleteAuthUser(_userId) {
      return { deleted: true, mode: 'local' };
    },

    completeDeletionRequest(id, { actor, retentionSummary }) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      state.accountDeletionAudit.push({
        id: `deletion-audit-${Date.now()}-${state.accountDeletionAudit.length + 1}`,
        requestId: request.id,
        userIdHash: request.userIdHash,
        emailHash: request.emailHash,
        status: 'completed',
        actor,
        retainedCategories: retentionSummary?.retained || [],
        summary: retentionSummary || {},
        createdAt: now(),
      });
      state.accountDeletionTombstones.push({
        userIdHash: request.userIdHash,
        emailHash: request.emailHash,
        requestId: request.id,
        createdAt: now(),
      });
      state.users = state.users.filter((user) => user.id !== request.userId);
      Object.assign(request, {
        userId: null,
        status: 'completed',
        completedAt: now(),
        statusMessage: 'Account deletion completed.',
        retentionSummary: retentionSummary || {},
        updatedAt: now(),
      });
      save();
      return mapDeletionRequest(request);
    },

    getPrivacyExport(userId) {
      return {
        exportedAt: now(),
        items: this.getItems(userId),
        imports: state.imports.filter((entry) => entry.userId === userId),
        collections: state.collections.filter((entry) => entry.userId === userId),
        credits: this.getCredits(userId),
        providerCredentials: this.listProviderCredentials(userId),
        extensionTokens: state.extensionTokens.filter((entry) => entry.userId === userId).map(publicExtensionToken),
        searchEvents: state.searchEvents.filter((entry) => entry.userId === userId),
        searchFeedback: state.searchFeedback.filter((entry) => entry.userId === userId),
        profile: this.getProfile(userId),
        deletion: mapDeletionRequest(activeDeletionRequestForUser(userId)),
      };
    },

    getUserAdminState(userId) {
      return state.userAdminStates.find((entry) => entry.userId === userId) || { userId, status: 'active' };
    },

    setUserBlocked({ userId, blocked, reason, adminActor }) {
      const user = state.users.find((entry) => entry.id === userId);
      if (!user) return null;
      let adminState = state.userAdminStates.find((entry) => entry.userId === userId);
      if (!adminState) {
        adminState = { userId, status: 'active', blockedAt: null, blockedReason: '', updatedAt: now() };
        state.userAdminStates.push(adminState);
      }
      Object.assign(adminState, {
        status: blocked ? 'blocked' : 'active',
        blockedAt: blocked ? now() : null,
        blockedReason: blocked ? reason : '',
        updatedAt: now(),
      });
      this.recordUserActivity({
        userId,
        eventType: blocked ? 'admin_blocked' : 'admin_unblocked',
        metadata: { reason, adminActor },
      });
      save();
      return this.getAdminUserDetail(userId);
    },

    getProfile(userId) {
      return publicProfile(state.profiles.find((profile) => profile.userId === userId) || null);
    },

    saveProfile(userId, { username, avatarUrl = '' }) {
      const normalizedUsername = normalizeUsername(username);
      const conflicting = state.profiles.find((profile) => profile.username === normalizedUsername && profile.userId !== userId);
      if (conflicting) {
        const error = new Error('That username is already taken.');
        error.statusCode = 409;
        throw error;
      }

      const existing = state.profiles.find((profile) => profile.userId === userId);
      if (existing) {
        existing.username = normalizedUsername;
        existing.avatarUrl = avatarUrl;
        existing.updatedAt = now();
        save();
        return publicProfile(existing);
      }

      const profile = {
        userId,
        username: normalizedUsername,
        avatarUrl,
        createdAt: now(),
        updatedAt: now(),
      };
      state.profiles.push(profile);
      save();
      return publicProfile(profile);
    },

    createExtensionToken(userId, { tokenHash, name, scopes, expiresAt }) {
      const token = {
        id: `extension-token-${Date.now()}-${state.extensionTokens.length + 1}`,
        userId,
        tokenHash,
        name: String(name || 'Browser extension').trim().slice(0, 80),
        scopes,
        createdAt: now(),
        lastUsedAt: null,
        expiresAt,
        revokedAt: null,
      };
      state.extensionTokens.push(token);
      save();
      return publicExtensionToken(token);
    },

    listExtensionTokens(userId) {
      return state.extensionTokens
        .filter((token) => token.userId === userId)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(publicExtensionToken);
    },

    revokeExtensionToken(userId, id) {
      const token = state.extensionTokens.find((entry) => entry.userId === userId && entry.id === id);
      if (!token) return false;
      token.revokedAt = now();
      save();
      return true;
    },

    getUserForExtensionToken(tokenHash, requiredScope = 'lens:search') {
      const token = state.extensionTokens.find((entry) => entry.tokenHash === tokenHash);
      const expired = token?.expiresAt && new Date(token.expiresAt).getTime() <= Date.now();
      if (!token || token.revokedAt || expired || !(token.scopes || []).includes(requiredScope)) return null;
      token.lastUsedAt = now();
      save();
      const user = state.users.find((entry) => entry.id === token.userId);
      return { id: token.userId, email: user?.email || '' };
    },

    recordLensSearchEvent({ userId, queryType, resultCount }) {
      const entry = {
        id: `lens-event-${Date.now()}-${state.lensSearchEvents.length + 1}`,
        userId,
        queryType,
        resultCount: Number(resultCount || 0),
        createdAt: now(),
      };
      state.lensSearchEvents.push(entry);
      save();
      return entry;
    },

    listPublicFeedback() {
      return [...state.feedback]
        .filter((entry) => entry.status !== 'hidden')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 50);
    },

    createPublicFeedback({ feature, message }) {
      const entry = {
        id: `feedback-${Date.now()}-${state.feedback.length + 1}`,
        feature: String(feature || 'Feature idea').trim().slice(0, 80),
        message: String(message || '').trim().replace(/\s+/g, ' ').slice(0, 500),
        displayName: 'Anonymous user',
        status: 'visible',
        createdAt: now(),
      };
      state.feedback.push(entry);
      save();
      return entry;
    },

    listAdminFeedback({ limit = 100 } = {}) {
      return [...state.feedback]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit);
    },

    setFeedbackStatus(id, status) {
      const feedback = state.feedback.find((entry) => entry.id === id);
      if (!feedback) return null;
      feedback.status = status;
      feedback.updatedAt = now();
      save();
      return feedback;
    },

    recordSearchEvent({ id, userId, query, queryLength = 0, filters = {}, resultCount = 0, includeAi = false, resultIds = [] }) {
      const event = {
        id,
        userId,
        query: String(query || '').trim().slice(0, 240),
        queryLength: Number(queryLength || 0),
        filters,
        resultCount: Number(resultCount || 0),
        includeAi: Boolean(includeAi),
        resultIds: Array.isArray(resultIds) ? resultIds.slice(0, 30) : [],
        createdAt: now(),
      };
      state.searchEvents.push(event);
      save();
      return event;
    },

    recordSearchFeedback({ userId, searchEventId, itemId, rating, reason = '' }) {
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!item) {
        const error = new Error('Saved item not found.');
        error.statusCode = 404;
        throw error;
      }
      const event = state.searchEvents.find((entry) => entry.userId === userId && entry.id === searchEventId);
      if (!event || !(event.resultIds || []).includes(itemId)) {
        const error = new Error('Search feedback must reference one of your current search results.');
        error.statusCode = 400;
        throw error;
      }
      const feedback = {
        id: `search-feedback-${Date.now()}-${state.searchFeedback.length + 1}`,
        userId,
        searchEventId,
        itemId,
        rating,
        reason: String(reason || '').trim().slice(0, 300),
        createdAt: now(),
      };
      state.searchFeedback.push(feedback);
      save();
      return feedback;
    },

    createImport({ userId, source, mode = 'export', fileNames = [], status = 'imported', storageFiles = [] }) {
      const entry = {
        id: `import-${Date.now()}`,
        userId,
        source,
        mode,
        fileNames,
        status,
        storageFiles,
        error: null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.imports.push(entry);
      this.recordUserActivity({
        userId,
        eventType: 'import_created',
        metadata: { importId: entry.id, source, fileCount: fileNames.length },
      });
      save();
      return entry;
    },

    getPendingStorageImports({ limit = 1 } = {}) {
      return state.imports
        .filter((entry) => entry.status === 'queued_storage')
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(0, Math.max(1, Math.min(Number(limit) || 1, 20)));
    },

    claimStorageImport(id) {
      const entry = state.imports.find((item) => item.id === id && item.status === 'queued_storage');
      if (!entry) return null;
      entry.status = 'processing_storage';
      entry.error = null;
      entry.updatedAt = now();
      save();
      return entry;
    },

    updateImportStatus(id, status, error = null) {
      const entry = state.imports.find((item) => item.id === id);
      if (!entry) return null;
      entry.status = status;
      entry.error = error;
      entry.updatedAt = now();
      save();
      return entry;
    },

    upsertImportData({ userId, importId, parsed, initialStatus = 'queued' }) {
      for (const collection of parsed.collections) {
        const id = `${userId}:${collection.name}`;
        if (!state.collections.find((entry) => entry.id === id)) {
          state.collections.push({ id, userId, name: collection.name, sourceName: collection.sourceName, createdAt: now() });
        }
      }

      const items = [];
      for (const item of parsed.items) {
        const existing = state.items.find((entry) => entry.userId === userId && (entry.id === item.id || entry.url === item.url));
        if (existing) {
          Object.assign(existing, {
            ...item,
            userId,
            importId,
            collections: [...new Set([...(existing.collections || []), ...(item.collections || [])])],
            updatedAt: now(),
          });
          continue;
        }

        const created = {
          ...item,
          userId,
          importId,
          status: initialStatus,
          analysis: null,
          createdAt: now(),
          updatedAt: now(),
        };
        state.items.push(created);
        items.push(created);
      }

      save();
      return items;
    },

    updateSavedItem(userId, id, patch = {}) {
      const item = this.getItem(userId, id);
      if (!item) return null;
      const rawItem = state.items.find((entry) => entry.userId === userId && entry.id === id);
      const allowed = [
        'importId',
        'caption',
        'collections',
        'sourceTitle',
        'sourceAuthor',
        'sourceDescription',
        'thumbnailUrl',
        'platform',
        'platformKey',
        'sourceId',
        'status',
        'error',
      ];
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) rawItem[key] = patch[key];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'note')) rawItem.note = patch.note;
      rawItem.updatedAt = now();
      save();
      return hydrateLocalItem(state, rawItem);
    },

    createNoteItem(userId, item) {
      const created = {
        ...item,
        userId,
        createdAt: item.createdAt || now(),
        updatedAt: item.updatedAt || now(),
        analysis: null,
      };
      state.items.push(created);
      save();
      return hydrateLocalItem(state, created);
    },

    addItemAsset(userId, itemId, asset) {
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!item) return null;
      const created = {
        id: asset.id || `asset-${crypto.randomUUID()}`,
        userId,
        itemId,
        assetType: asset.assetType || 'image',
        storagePath: asset.storagePath,
        mimeType: asset.mimeType || '',
        url: asset.url || asset.storagePath || '',
        createdAt: asset.createdAt || now(),
      };
      state.itemAssets.push(created);
      save();
      return publicNoteAsset(created);
    },

    listItemAssets(userId, itemId) {
      return localItemAssets(state, userId, itemId);
    },

    removeItemAssets(userId, itemId, assetIds = []) {
      const ids = new Set(assetIds);
      const removed = [];
      state.itemAssets = state.itemAssets.filter((asset) => {
        const match = asset.userId === userId && asset.itemId === itemId && (!ids.size || ids.has(asset.id));
        if (match) removed.push(publicNoteAsset(asset));
        return !match;
      });
      if (removed.length) save();
      return removed;
    },

    deleteSavedItem(userId, id) {
      const index = state.items.findIndex((entry) => entry.userId === userId && entry.id === id);
      if (index === -1) return null;
      const [removed] = state.items.splice(index, 1);
      state.jobs = state.jobs.filter((job) => !(job.userId === userId && job.itemId === id));
      state.searchFeedback = state.searchFeedback.filter((entry) => !(entry.userId === userId && entry.itemId === id));
      state.itemAssets = state.itemAssets.filter((asset) => !(asset.userId === userId && asset.itemId === id));
      save();
      return hydrateLocalItem(state, removed);
    },

    createJobs({ userId, importId, items }) {
      const existingJobs = state.jobs.filter((job) => job.userId === userId && job.importId === importId);
      const jobs = createJobsForImport({ importId, items, existingJobs }).map((job) => ({ ...job, userId }));
      state.jobs.push(...jobs);
      save();
      return jobs;
    },

    getItems(userId) {
      return state.items.filter((item) => item.userId === userId).map((item) => hydrateLocalItem(state, item));
    },

    getItem(userId, id) {
      return hydrateLocalItem(state, state.items.find((item) => item.userId === userId && item.id === id) || null);
    },

    getJobs(userId, importId = null) {
      return state.jobs.filter((job) => job.userId === userId && (!importId || job.importId === importId));
    },

    getProcessableJobScopes({ limit = 10, perUserConcurrency = 1, maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS } = {}) {
      const scopes = [];
      const seen = new Set();
      const currentTime = new Date();
      const processableJobs = state.jobs
        .filter((job) => isReclaimableJob(job, currentTime, { maxAttempts }))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      for (const job of processableJobs) {
        const activeForUser = state.jobs.filter((entry) => entry.userId === job.userId && hasActiveLease(entry, currentTime)).length;
        if (activeForUser >= perUserConcurrency) continue;
        const key = `${job.userId}:${job.importId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        scopes.push({ userId: job.userId, importId: job.importId });
        if (scopes.length >= limit) break;
      }
      return scopes;
    },

    getJob(userId, id) {
      return state.jobs.find((job) => job.userId === userId && job.id === id) || null;
    },

    claimNextJobs({
      userId,
      importId = null,
      limit = 5,
      leaseOwner = 'local-worker',
      leaseMs = 15 * 60 * 1000,
      perUserConcurrency = 1,
      maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS,
    } = {}) {
      const currentTime = new Date();
      const activeForUser = state.jobs.filter((job) => job.userId === userId && hasActiveLease(job, currentTime)).length;
      const availableSlots = activeForUser >= (Number(perUserConcurrency) || 1)
        ? 0
        : Math.max(1, Math.min(Number(limit) || 1, 100));
      if (!availableSlots) return [];

      const leaseExpiresAt = new Date(currentTime.getTime() + leaseMs).toISOString();
      const claimed = state.jobs
        .filter((job) => job.userId === userId && (!importId || job.importId === importId) && isReclaimableJob(job, currentTime, { maxAttempts }))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(0, availableSlots);

      for (const job of claimed) {
        const leaseToken = crypto.randomUUID();
        Object.assign(job, {
          status: 'downloading',
          attempts: (job.attempts || 0) + 1,
          error: null,
          leaseOwner,
          leaseToken,
          leaseExpiresAt,
          nextAttemptAt: null,
          claimedAt: currentTime.toISOString(),
          lastErrorAt: null,
          updatedAt: now(),
        });
      }
      save();
      return claimed;
    },

    updateJob(userId, id, patch) {
      const job = this.getJob(userId, id);
      if (!job) return null;
      Object.assign(job, patch, { updatedAt: now() });
      save();
      return job;
    },

    updateClaimedJob(userId, id, leaseToken, patch) {
      const job = this.getJob(userId, id);
      if (!job || !leaseToken || job.leaseToken !== leaseToken) return null;
      Object.assign(job, patch, { updatedAt: now() });
      save();
      return job;
    },

    claimJob(userId, id, patch) {
      const job = this.getJob(userId, id);
      if (!job || job.status !== 'queued') return null;
      Object.assign(job, patch, { updatedAt: now() });
      save();
      return job;
    },

    restartJobs(userId, importId = null) {
      const jobs = state.jobs.filter((job) => job.userId === userId && (!importId || job.importId === importId) && isRestartableJob(job));
      for (const job of jobs) {
        Object.assign(job, {
          status: 'queued',
          attempts: 0,
          error: null,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          claimedAt: null,
          completedAt: null,
          lastErrorAt: null,
          updatedAt: now(),
        });
        const item = state.items.find((entry) => entry.userId === userId && entry.id === job.itemId);
        if (item && item.status !== 'done') {
          item.status = 'queued';
          item.error = null;
          item.updatedAt = now();
        }
      }
      save();
      return jobs.length;
    },

    getIndexingSummary(userId) {
      const currentTime = new Date();
      const jobs = state.jobs.filter((job) => job.userId === userId);
      const items = state.items.filter((item) => item.userId === userId);
      const byStatus = jobs.reduce((stats, job) => {
        const status = staleActiveJobStatus(job, currentTime);
        stats[status] = (stats[status] || 0) + 1;
        return stats;
      }, {});
      const retrying = jobs.filter((job) => job.status === 'queued' && !isRetryDue(job, currentTime)).length;
      const exhausted = jobs.filter((job) => job.status === 'failed' && isAttemptExhausted(job)).length;
      const retryableFailed = jobs.filter((job) => job.status === 'failed' && !isAttemptExhausted(job)).length;
      const needsReview = items.filter((item) => item.status === 'needs_review').length;
      const paused = PAUSED_JOB_STATUSES.reduce((total, status) => total + (byStatus[status] || 0), 0);
      return {
        totalJobs: jobs.length,
        needsReview,
        waiting: Math.max((byStatus.queued || 0) - retrying, 0),
        queued: Math.max((byStatus.queued || 0) - retrying, 0),
        retrying,
        processing: (byStatus.downloading || 0) + (byStatus.analyzing || 0),
        downloading: byStatus.downloading || 0,
        analyzing: byStatus.analyzing || 0,
        done: byStatus.done || 0,
        failed: byStatus.failed || 0,
        retryableFailed,
        exhausted,
        paused,
        pausedMissingProvider: byStatus.paused_missing_provider || 0,
        pausedNeedsBilling: byStatus.paused_needs_billing || 0,
        pausedApiLimit: byStatus.paused_api_limit || 0,
        byStatus,
      };
    },

    saveAnalysis(userId, itemId, analysis) {
      const item = this.getItem(userId, itemId);
      if (!item) return null;
      item.analysis = analysis;
      item.status = 'done';
      item.updatedAt = now();
      save();
      return item;
    },

    markItemFailed(userId, itemId, error) {
      const item = this.getItem(userId, itemId);
      if (!item) return null;
      item.status = 'failed';
      item.error = error;
      item.updatedAt = now();
      save();
      return item;
    },

    setItemStatus(userId, itemId, status, error = null) {
      const item = this.getItem(userId, itemId);
      if (!item) return null;
      item.status = status;
      item.error = error;
      item.updatedAt = now();
      save();
      return item;
    },

    search(userId, query, filters = {}) {
      return searchItemsWithDetails(this.getItems(userId), query, filters);
    },

    listCreditPackages() {
      return state.creditPackages
        .map(normalizePackage)
        .filter((entry) => entry.active);
    },

    getCreditPackage(packageId) {
      return state.creditPackages
        .map(normalizePackage)
        .find((entry) => entry.id === packageId && entry.active) || null;
    },

    createCreditPurchase({ userId, packageEntry }) {
      const purchase = {
        id: `purchase-${Date.now()}-${state.creditPurchases.length + 1}`,
        userId,
        packageId: packageEntry.id,
        credits: packageEntry.credits,
        amountCents: packageEntry.amountCents,
        currency: packageEntry.currency,
        status: 'pending',
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.creditPurchases.push(purchase);
      save();
      return purchase;
    },

    updateCreditPurchaseSession({ purchaseId, checkoutSessionId }) {
      const purchase = state.creditPurchases.find((entry) => entry.id === purchaseId);
      if (!purchase) return null;
      purchase.stripeCheckoutSessionId = checkoutSessionId;
      purchase.updatedAt = now();
      save();
      return purchase;
    },

    completeCreditPurchase({ purchaseId, checkoutSessionId, paymentIntentId }) {
      const purchase = state.creditPurchases.find((entry) => (
        (purchaseId && entry.id === purchaseId) || (checkoutSessionId && entry.stripeCheckoutSessionId === checkoutSessionId)
      ));
      if (!purchase) return null;
      if (purchase.status === 'completed') return purchase;

      purchase.status = 'completed';
      purchase.stripeCheckoutSessionId = checkoutSessionId || purchase.stripeCheckoutSessionId;
      purchase.stripePaymentIntentId = paymentIntentId || purchase.stripePaymentIntentId;
      purchase.completedAt = now();
      purchase.updatedAt = now();
      this.addCreditTransaction({
        userId: purchase.userId,
        amount: purchase.credits,
        reason: 'credit_purchase',
        metadata: { purchaseId: purchase.id, checkoutSessionId: purchase.stripeCheckoutSessionId },
      });
      save();
      return purchase;
    },

    getCredits(userId) {
      const freeItemsUsed = new Set(
        state.analysisUsageEvents
          .filter((event) => event.userId === userId && event.source === 'free')
          .map((event) => event.itemId),
      ).size;
      const paidCredits = state.creditTransactions
        .filter((entry) => entry.userId === userId)
        .reduce((total, entry) => total + Number(entry.amount || 0), 0);

      return {
        userId,
        freeItemsLimit: FREE_ITEMS_LIMIT,
        freeItemsUsed,
        freeItemsRemaining: Math.max(FREE_ITEMS_LIMIT - freeItemsUsed, 0),
        paidCredits,
        itemCreditCost: 1,
        totalAvailableCredits: Math.max(FREE_ITEMS_LIMIT - freeItemsUsed, 0) + paidCredits,
      };
    },

    recordUsage({ userId, itemId, source, provider, model }) {
      const existing = state.analysisUsageEvents.find(
        (event) => event.userId === userId && event.itemId === itemId && event.source === source,
      );
      if (existing) return existing;

      const event = {
        id: `usage-${Date.now()}-${state.analysisUsageEvents.length + 1}`,
        userId,
        itemId,
        source,
        provider,
        model,
        createdAt: now(),
      };
      state.analysisUsageEvents.push(event);
      this.recordUserActivity({
        userId,
        eventType: 'analysis_used',
        metadata: { itemId, source, provider, model },
      });
      if (source === 'paid') {
        this.addCreditTransaction({ userId, amount: -1, reason: 'item_analysis', itemId });
      }
      save();
      return event;
    },

    recordUserActivity({ userId, eventType, metadata = {} }) {
      const event = {
        id: `activity-${Date.now()}-${state.userActivityEvents.length + 1}`,
        userId,
        eventType,
        metadata,
        createdAt: now(),
      };
      state.userActivityEvents.push(event);
      save();
      return event;
    },

    addCreditTransaction({ userId, amount, reason = 'manual', itemId = null, metadata = {} }) {
      const numericAmount = Number(amount || 0);
      if (!Number.isInteger(numericAmount) || numericAmount === 0) {
        throw new Error('Credit amount must be a non-zero whole number.');
      }
      const nextPaidCredits = this.getCredits(userId).paidCredits + numericAmount;
      if (nextPaidCredits < 0) throw new Error('Not enough paid credits.');

      const transaction = {
        id: `credit-${Date.now()}-${state.creditTransactions.length + 1}`,
        userId,
        amount: numericAmount,
        reason,
        itemId,
        metadata,
        createdAt: now(),
      };
      state.creditTransactions.push(transaction);
      save();
      return transaction;
    },

    addAdminCreditAdjustment({ userId, amount, reason, adminActor }) {
      const transaction = this.addCreditTransaction({
        userId,
        amount,
        reason: 'admin_adjustment',
        metadata: { reason },
      });
      const adjustment = {
        id: `admin-credit-${Date.now()}-${state.adminCreditAdjustments.length + 1}`,
        userId,
        amount: transaction.amount,
        reason,
        adminActor,
        transactionId: transaction.id,
        createdAt: now(),
      };
      state.adminCreditAdjustments.push(adjustment);
      save();
      return { adjustment, transaction, credits: this.getCredits(userId) };
    },

    getAdminSummary() {
      const today = Date.now() - 24 * 60 * 60 * 1000;
      const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const itemStatuses = state.items.reduce((stats, item) => {
        stats[item.status || 'unknown'] = (stats[item.status || 'unknown'] || 0) + 1;
        return stats;
      }, {});
      const usageBySource = state.analysisUsageEvents.reduce((stats, event) => {
        stats[event.source || 'unknown'] = (stats[event.source || 'unknown'] || 0) + 1;
        return stats;
      }, {});
      const completedPurchases = state.creditPurchases.filter((purchase) => purchase.status === 'completed');

      return {
        users: {
          total: state.users.length,
          newToday: state.users.filter((user) => new Date(user.createdAt || 0).getTime() >= today).length,
          newThisWeek: state.users.filter((user) => new Date(user.createdAt || 0).getTime() >= week).length,
        },
        items: {
          total: state.items.length,
          indexed: itemStatuses.done || 0,
          queued: itemStatuses.queued || 0,
          failed: itemStatuses.failed || 0,
          needsReview: itemStatuses.needs_review || 0,
          byStatus: itemStatuses,
        },
        credits: {
          freeUsed: usageBySource.free || 0,
          paidUsed: usageBySource.paid || 0,
          byokUsed: usageBySource.byok || 0,
          paidCreditsAvailable: state.creditTransactions.reduce((total, entry) => total + Number(entry.amount || 0), 0),
        },
        purchases: {
          completed: completedPurchases.length,
          revenueCents: completedPurchases.reduce((total, purchase) => total + Number(purchase.amountCents || 0), 0),
        },
        feedback: {
          total: state.feedback.length,
          visible: state.feedback.filter((entry) => entry.status !== 'hidden').length,
        },
      };
    },

    listAdminUsers({ query = '', limit = 50, offset = 0 } = {}) {
      const needle = String(query || '').trim().toLowerCase();
      const rows = state.users
        .map((user) => adminUserSummary(state, user, this.getCredits(user.id)))
        .filter((user) => !needle || [user.email, user.profile?.username].some((value) => String(value || '').toLowerCase().includes(needle)))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

      return {
        users: rows.slice(offset, offset + limit),
        total: rows.length,
        limit,
        offset,
      };
    },

    getAdminUserDetail(userId) {
      const user = state.users.find((entry) => entry.id === userId);
      if (!user) return null;
      return {
        ...adminUserSummary(state, user, this.getCredits(user.id)),
        creditTransactions: state.creditTransactions
          .filter((entry) => entry.userId === user.id)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 100),
        purchases: state.creditPurchases
          .filter((entry) => entry.userId === user.id)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 50),
        adminAdjustments: state.adminCreditAdjustments
          .filter((entry) => entry.userId === user.id)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 50),
      };
    },

    listAdminImports({ limit = 50 } = {}) {
      return [...state.imports]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit)
        .map((entry) => ({
          ...entry,
          user: state.users.find((user) => user.id === entry.userId) || null,
          itemCount: state.items.filter((item) => item.importId === entry.id).length,
          jobStats: state.jobs
            .filter((job) => job.importId === entry.id)
            .reduce((stats, job) => {
              stats[job.status || 'unknown'] = (stats[job.status || 'unknown'] || 0) + 1;
              return stats;
            }, {}),
        }));
    },

    listAdminActivity({ limit = 100 } = {}) {
      return [...state.userActivityEvents]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit)
        .map((entry) => ({
          ...entry,
          user: state.users.find((user) => user.id === entry.userId) || null,
        }));
    },

    listProviderCredentials(userId) {
      return state.providerCredentials
        .filter((credential) => credential.userId === userId)
        .map(publicCredential);
    },

    saveProviderCredential(userId, { provider, purpose, model, apiKey, encryptionKey, status = 'active', isPreferred = true, baseUrl = '', displayName = '' }) {
      assertProviderPurpose(provider, purpose);
      if (purpose === 'media' && provider === 'openrouter') assertMediaModelAllowed(model);
      assertOpenAICompatibleConfig({ provider, purpose, model, baseUrl });
      if (!apiKey) throw new Error('API key is required.');
      const normalizedBaseUrl = provider === OPENAI_COMPATIBLE_PROVIDER ? normalizeOpenAICompatibleBaseUrl(baseUrl) : null;
      const normalizedDisplayName = provider === OPENAI_COMPATIBLE_PROVIDER ? normalizeOpenAICompatibleDisplayName(displayName) : null;

      if (isPreferred) {
        state.providerCredentials
          .filter((credential) => credential.userId === userId && credential.purpose === purpose)
          .forEach((credential) => {
            credential.isPreferred = false;
            credential.updatedAt = now();
          });
      }

      const existing = state.providerCredentials.find(
        (credential) => credential.userId === userId && credential.provider === provider && credential.purpose === purpose,
      );
      const row = existing || {
        id: `credential-${Date.now()}-${state.providerCredentials.length + 1}`,
        userId,
        provider,
        purpose,
        createdAt: now(),
      };
      Object.assign(row, {
        model,
        baseUrl: normalizedBaseUrl,
        displayName: normalizedDisplayName,
        encryptedKey: encryptSecret(apiKey, encryptionKey),
        keyHint: maskSecret(apiKey),
        status,
        isPreferred,
        updatedAt: now(),
      });
      if (!existing) state.providerCredentials.push(row);
      save();
      return publicCredential(row);
    },

    getPreferredProviderCredential(userId, purpose, encryptionKey) {
      const credential = state.providerCredentials
        .filter((entry) => entry.userId === userId && entry.purpose === purpose && entry.status === 'active')
        .sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      if (!credential) return null;
      return {
        ...publicCredential(credential),
        apiKey: decryptSecret(credential.encryptedKey, encryptionKey),
      };
    },

    getProviderCredential(userId, id, encryptionKey) {
      const credential = state.providerCredentials.find((entry) => entry.userId === userId && entry.id === id);
      if (!credential) return null;
      return {
        ...publicCredential(credential),
        apiKey: decryptSecret(credential.encryptedKey, encryptionKey),
      };
    },

    deleteProviderCredential(userId, id) {
      const before = state.providerCredentials.length;
      state.providerCredentials = state.providerCredentials.filter((credential) => !(credential.userId === userId && credential.id === id));
      save();
      return state.providerCredentials.length !== before;
    },

    dump() {
      return state;
    },
  };
}

function staleActiveJobStatus(job, currentTime = new Date()) {
  if (['downloading', 'analyzing'].includes(job.status) && !hasActiveLease(job, currentTime)) {
    return 'queued';
  }
  return job.status || 'unknown';
}

module.exports = {
  createLocalStore,
  DEFAULT_USER_ID,
};
