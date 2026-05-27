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
  summarizeJobQueue,
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
const { listItemsPageFromItems } = require('../services/itemList');
const {
  DEFAULT_VISIBLE_COLLECTIONS_LIMIT,
  generateSmartCollectionCandidates,
  publicSmartCollection,
  sortSmartCollections,
} = require('../services/smartCollections');
const { publicArchive } = require('../services/pageArchive');
const { publicLinkHealth, publicReminder } = require('../services/libraryCare');
const { sanitizeAuditMetadata } = require('../services/auditLog');

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
    captureConnections: [],
    lensSearchEvents: [],
    itemAssets: [],
    itemArchives: [],
    linkHealthChecks: [],
    itemReminders: [],
    smartCollections: [],
    smartCollectionItems: [],
    accountDeletionRequests: [],
    accountDeletionSteps: [],
    accountDeletionAudit: [],
    accountDeletionTombstones: [],
    dataExportRequests: [],
    dataExportSteps: [],
    dataExportArtifacts: [],
    securityAuditEvents: [],
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
    captureConnections: [],
    lensSearchEvents: [],
    itemAssets: [],
    itemArchives: [],
    linkHealthChecks: [],
    itemReminders: [],
    smartCollections: [],
    smartCollectionItems: [],
    accountDeletionRequests: [],
    accountDeletionSteps: [],
    accountDeletionAudit: [],
    accountDeletionTombstones: [],
    dataExportRequests: [],
    dataExportSteps: [],
    dataExportArtifacts: [],
    securityAuditEvents: [],
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
    captureConnections: state.captureConnections || [],
    lensSearchEvents: state.lensSearchEvents || [],
    itemAssets: state.itemAssets || [],
    itemArchives: state.itemArchives || [],
    linkHealthChecks: state.linkHealthChecks || [],
    itemReminders: state.itemReminders || [],
    smartCollections: state.smartCollections || [],
    smartCollectionItems: state.smartCollectionItems || [],
    accountDeletionRequests: state.accountDeletionRequests || [],
    accountDeletionSteps: state.accountDeletionSteps || [],
    accountDeletionAudit: state.accountDeletionAudit || [],
    accountDeletionTombstones: state.accountDeletionTombstones || [],
    dataExportRequests: state.dataExportRequests || [],
    dataExportSteps: state.dataExportSteps || [],
    dataExportArtifacts: state.dataExportArtifacts || [],
    securityAuditEvents: state.securityAuditEvents || [],
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
    publicRef: user.publicRef || publicRefForUser(user.id),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt || user.createdAt,
    lastSeenAt: user.lastSeenAt || user.lastSignInAt || null,
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

function localItemArchive(state, userId, itemId, { includeContent = false } = {}) {
  const archive = (state.itemArchives || []).find((entry) => entry.userId === userId && entry.itemId === itemId);
  return publicArchive(archive, { includeContent });
}

function hydrateLocalItem(state, item, { includeArchiveContent = false } = {}) {
  if (!item) return null;
  return {
    ...item,
    assets: localItemAssets(state, item.userId, item.id),
    archive: localItemArchive(state, item.userId, item.id, { includeContent: includeArchiveContent }),
  };
}

function publicRefForUser(userId) {
  return `usr_${crypto.createHash('sha1').update(String(userId || '')).digest('hex').slice(0, 12)}`;
}

function publicDataExportRequest(state, request) {
  if (!request) return null;
  return {
    id: request.id,
    userId: request.userId,
    status: request.status,
    format: request.format || 'zip',
    requestedAt: request.requestedAt,
    startedAt: request.startedAt || null,
    completedAt: request.completedAt || null,
    expiresAt: request.expiresAt || null,
    errorMessage: request.errorMessage || '',
    metadata: request.metadata || {},
    steps: (state.dataExportSteps || [])
      .filter((step) => step.requestId === request.id)
      .sort((a, b) => String(a.category).localeCompare(String(b.category))),
  };
}

function publicCaptureConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    username: row.username || '',
    displayName: row.displayName || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt || null,
    revokedAt: row.revokedAt || null,
  };
}

function createLocalStore({ dataPath }) {
  const file = path.join(dataPath, 'brain.local.json');
  let state = normalizeState(readJson(file, null) || seedFromLegacyIndex(dataPath));

  function save() {
    writeJson(file, state);
  }

  function ensureUser(userId, email) {
    assertUserNotDeleted(userId, email);
    ensureUserRecord(userId, email);
  }

  function ensureUserRecord(userId, email) {
    const existing = state.users.find((user) => user.id === userId);
    if (!existing) {
      state.users.push({
        id: userId,
        email,
        publicRef: publicRefForUser(userId),
        createdAt: now(),
        updatedAt: now(),
        lastSeenAt: now(),
      });
      save();
      return;
    }
    const nextRef = existing.publicRef || publicRefForUser(userId);
    if (existing.email !== email || existing.publicRef !== nextRef || !existing.updatedAt || !existing.lastSeenAt) {
      Object.assign(existing, {
        email,
        publicRef: nextRef,
        updatedAt: now(),
        lastSeenAt: now(),
      });
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

  function smartCollectionItemMap(userId) {
    return new Map(state.items
      .filter((item) => item.userId === userId)
      .map((item) => [item.id, hydrateLocalItem(state, item)]));
  }

  function publicLocalSmartCollection(collection) {
    const memberships = state.smartCollectionItems.filter((entry) => (
      entry.userId === collection.userId && entry.collectionId === collection.id
    ));
    return publicSmartCollection(collection, memberships, smartCollectionItemMap(collection.userId));
  }

  function activeSmartCollectionItemIds(userId, collectionId) {
    const active = new Set();
    const excluded = new Set();
    for (const entry of state.smartCollectionItems) {
      if (entry.userId !== userId || entry.collectionId !== collectionId) continue;
      if (entry.source === 'manual_exclude') excluded.add(entry.itemId);
      else active.add(entry.itemId);
    }
    for (const itemId of excluded) active.delete(itemId);
    return active;
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
    ensureUserRecord,
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
        status: 'requested',
        reason: String(reason || '').trim().slice(0, 500),
        exportConfirmed: Boolean(exportConfirmed),
        requestedAt: now(),
        approvedAt: null,
        executingAt: null,
        completedAt: null,
        loggedAt: null,
        canceledAt: null,
        adminActor: null,
        statusMessage: 'Deletion request received.',
        retentionSummary: {},
        createdAt: now(),
        updatedAt: now(),
      };
      state.accountDeletionRequests.push(request);
      this.recordUserActivity({ userId, eventType: 'deletion_requested', metadata: { requestId: request.id } });
      save();
      return mapDeletionRequest(request);
    },

    cancelDeletionRequestForUser(userId) {
      const request = activeDeletionRequestForUser(userId);
      if (!request || !['requested', 'frozen', 'pending_approval'].includes(request.status)) return null;
      Object.assign(request, {
        status: 'canceled',
        canceledAt: now(),
        statusMessage: 'Deletion request canceled by user.',
        updatedAt: now(),
      });
      save();
      return mapDeletionRequest(request);
    },

    markDeletionRequestFrozen(id) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, {
        status: 'frozen',
        statusMessage: 'Risky account access is frozen. Waiting for review.',
        updatedAt: now(),
      });
      this.recordUserActivity({ userId: request.userId, eventType: 'deletion_frozen', metadata: { requestId: request.id } });
      save();
      return mapDeletionRequest(request);
    },

    markDeletionRequestPendingReview(id) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, {
        status: 'pending_approval',
        statusMessage: 'Deletion request is waiting for admin review.',
        updatedAt: now(),
      });
      this.recordUserActivity({ userId: request.userId, eventType: 'deletion_pending_review', metadata: { requestId: request.id } });
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
      if (!['requested', 'frozen', 'pending_approval', 'failed', 'partially_failed'].includes(request.status)) return mapDeletionRequest(request);
      Object.assign(request, {
        status: 'approved',
        approvedAt: now(),
        adminActor,
        statusMessage: 'Deletion request approved. Waiting for execution.',
        updatedAt: now(),
      });
      this.recordUserActivity({ userId: request.userId, eventType: 'deletion_approved', metadata: { requestId: request.id } });
      save();
      return mapDeletionRequest(request);
    },

    cancelDeletionRequestAsAdmin({ id, adminActor, reason = '' }) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      if (['executing', 'completed', 'logged'].includes(request.status)) return mapDeletionRequest(request);
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
      this.recordUserActivity({ userId: request.userId, eventType: 'deletion_executing', metadata: { requestId: request.id } });
      save();
      return mapDeletionRequest(request);
    },

    markDeletionRequestPartiallyFailed(id, message) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, {
        status: 'failed',
        statusMessage: message || 'Deletion failed. Admin retry is required.',
        updatedAt: now(),
      });
      this.recordUserActivity({ userId: request.userId, eventType: 'deletion_failed', metadata: { requestId: request.id, error: message } });
      save();
      return mapDeletionRequest(request);
    },

    markDeletionRequestLogged(id) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, {
        status: 'logged',
        loggedAt: now(),
        statusMessage: 'Deletion is complete and logged.',
        updatedAt: now(),
      });
      save();
      return mapDeletionRequest(request);
    },

    recordDeletionStep({ requestId, stepKey, status, error = '', metadata = {} }) {
      const request = state.accountDeletionRequests.find((entry) => entry.id === requestId);
      let step = state.accountDeletionSteps.find((entry) => entry.requestId === requestId && entry.stepKey === stepKey);
      if (!step) {
        step = {
          id: `deletion-step-${Date.now()}-${state.accountDeletionSteps.length + 1}`,
          requestId,
          userId: request?.userId || null,
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
        smartCollections: deleteFromArrayByUser('smartCollections', userId),
        smartCollectionItems: deleteFromArrayByUser('smartCollectionItems', userId),
        linkHealthChecks: deleteFromArrayByUser('linkHealthChecks', userId),
        itemReminders: deleteFromArrayByUser('itemReminders', userId),
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
        captureConnections: deleteFromArrayByUser('captureConnections', userId),
      };
      save();
      return deleted;
    },

    deleteUserProfileData(userId) {
      const exportRequestIds = new Set(state.dataExportRequests.filter((entry) => entry.userId === userId).map((entry) => entry.id));
      const deleted = {
        profiles: deleteFromArrayByUser('profiles', userId),
        userAdminStates: deleteFromArrayByUser('userAdminStates', userId),
        userActivityEvents: deleteFromArrayByUser('userActivityEvents', userId),
        analysisUsageEvents: deleteFromArrayByUser('analysisUsageEvents', userId),
        creditTransactions: deleteFromArrayByUser('creditTransactions', userId),
        creditPurchases: deleteFromArrayByUser('creditPurchases', userId),
        adminCreditAdjustments: deleteFromArrayByUser('adminCreditAdjustments', userId),
        dataExportRequests: deleteFromArrayByUser('dataExportRequests', userId),
        dataExportArtifacts: deleteFromArrayByUser('dataExportArtifacts', userId),
      };
      const stepCount = state.dataExportSteps.length;
      state.dataExportSteps = state.dataExportSteps.filter((step) => !exportRequestIds.has(step.requestId));
      deleted.dataExportSteps = stepCount - state.dataExportSteps.length;
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
        itemArchives: state.itemArchives
          .filter((entry) => entry.userId === userId)
          .map((entry) => publicArchive(entry, { includeContent: true })),
        linkHealthChecks: state.linkHealthChecks
          .filter((entry) => entry.userId === userId)
          .map(publicLinkHealth),
        itemReminders: state.itemReminders
          .filter((entry) => entry.userId === userId)
          .map(publicReminder),
        imports: state.imports.filter((entry) => entry.userId === userId),
        collections: state.collections.filter((entry) => entry.userId === userId),
        smartCollections: state.smartCollections.filter((entry) => entry.userId === userId),
        smartCollectionItems: state.smartCollectionItems.filter((entry) => entry.userId === userId),
        credits: this.getCredits(userId),
        providerCredentials: this.listProviderCredentials(userId),
        legacyAiKeys: [],
        extensionTokens: state.extensionTokens.filter((entry) => entry.userId === userId).map(publicExtensionToken),
        captureConnections: this.listCaptureConnections(userId),
        searchEvents: state.searchEvents.filter((entry) => entry.userId === userId),
        searchFeedback: state.searchFeedback.filter((entry) => entry.userId === userId),
        userActivity: state.userActivityEvents.filter((entry) => entry.userId === userId),
        analysisUsage: state.analysisUsageEvents.filter((entry) => entry.userId === userId),
        profile: this.getProfile(userId),
        deletion: mapDeletionRequest(activeDeletionRequestForUser(userId)),
      };
    },

    getAccountSummary(userId) {
      const user = state.users.find((entry) => entry.id === userId);
      if (!user) return null;
      const summary = adminUserSummary(state, user, this.getCredits(userId));
      const lastActivity = state.userActivityEvents
        .filter((entry) => entry.userId === userId)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
      const lastExport = state.dataExportRequests
        .filter((entry) => entry.userId === userId)
        .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))[0] || null;
      return {
        ...summary,
        counts: {
          imports: state.imports.filter((entry) => entry.userId === userId).length,
          saves: state.items.filter((entry) => entry.userId === userId).length,
          providerCredentials: state.providerCredentials.filter((entry) => entry.userId === userId).length,
          extensionTokens: state.extensionTokens.filter((entry) => entry.userId === userId && !entry.revokedAt).length,
          captureConnections: state.captureConnections.filter((entry) => entry.userId === userId).length,
        },
        deletion: mapDeletionRequest(activeDeletionRequestForUser(userId)),
        lastActivity,
        lastExport: lastExport ? publicDataExportRequest(state, lastExport) : null,
      };
    },

    getDataExportPayload(userId) {
      const privacy = this.getPrivacyExport(userId);
      return {
        savedItems: privacy.items,
        imports: privacy.imports,
        collections: privacy.collections,
        smartCollections: privacy.smartCollections,
        smartCollectionItems: privacy.smartCollectionItems,
        itemAssets: state.itemAssets.filter((entry) => entry.userId === userId).map(publicNoteAsset),
        itemArchives: privacy.itemArchives,
        linkHealthChecks: privacy.linkHealthChecks,
        itemReminders: privacy.itemReminders,
        providerCredentials: privacy.providerCredentials,
        legacyAiKeys: privacy.legacyAiKeys || [],
        extensionTokens: privacy.extensionTokens,
        captureConnections: privacy.captureConnections,
        searchEvents: privacy.searchEvents,
        searchFeedback: privacy.searchFeedback,
        userActivity: privacy.userActivity,
        analysisUsage: privacy.analysisUsage,
        billing: {
          credits: privacy.credits,
          creditTransactions: state.creditTransactions.filter((entry) => entry.userId === userId),
          creditPurchases: state.creditPurchases.filter((entry) => entry.userId === userId),
          adminCreditAdjustments: state.adminCreditAdjustments.filter((entry) => entry.userId === userId),
        },
        exportRequests: state.dataExportRequests
          .filter((entry) => entry.userId === userId)
          .map((entry) => publicDataExportRequest(state, entry)),
      };
    },

    createDataExportRequest(userId, { includeFiles = false } = {}) {
      const request = {
        id: `data-export-${Date.now()}-${state.dataExportRequests.length + 1}`,
        userId,
        status: 'requested',
        format: 'zip',
        requestedAt: now(),
        startedAt: null,
        completedAt: null,
        expiresAt: null,
        storageBucket: '',
        storagePath: '',
        errorMessage: '',
        metadata: { includeFiles: Boolean(includeFiles) },
      };
      state.dataExportRequests.push(request);
      this.recordUserActivity({ userId, eventType: 'data_export_requested', metadata: { requestId: request.id } });
      save();
      return publicDataExportRequest(state, request);
    },

    listDataExportRequests(userId) {
      return state.dataExportRequests
        .filter((entry) => entry.userId === userId)
        .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
        .map((entry) => publicDataExportRequest(state, entry));
    },

    getDataExportRequest(userId, id) {
      return publicDataExportRequest(state, state.dataExportRequests.find((entry) => entry.userId === userId && entry.id === id));
    },

    claimDataExportRequests({ limit = 1 } = {}) {
      const claimLimit = Math.max(1, Math.min(Number(limit) || 1, 25));
      const claimed = state.dataExportRequests
        .filter((entry) => entry.status === 'requested')
        .sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)))
        .slice(0, claimLimit);
      for (const request of claimed) {
        Object.assign(request, { status: 'building', startedAt: now(), errorMessage: '' });
      }
      if (claimed.length) save();
      return claimed.map((request) => publicDataExportRequest(state, request));
    },

    expireDataExportRequests() {
      let expired = 0;
      const timestamp = now();
      for (const request of state.dataExportRequests) {
        if (request.status === 'ready' && request.expiresAt && request.expiresAt < timestamp) {
          request.status = 'expired';
          expired += 1;
        }
      }
      if (expired) save();
      return { expired };
    },

    getDataExportQueueStatus() {
      const status = {
        requested: 0,
        building: 0,
        ready: 0,
        failed: 0,
        expired: 0,
        oldestRequestedAt: null,
      };
      for (const request of state.dataExportRequests) {
        if (Object.prototype.hasOwnProperty.call(status, request.status)) {
          status[request.status] += 1;
        }
        if (request.status === 'requested' && (!status.oldestRequestedAt || request.requestedAt < status.oldestRequestedAt)) {
          status.oldestRequestedAt = request.requestedAt;
        }
      }
      return status;
    },

    markDataExportBuilding(id) {
      const request = state.dataExportRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, { status: 'building', startedAt: now(), errorMessage: '' });
      save();
      return publicDataExportRequest(state, request);
    },

    markDataExportReady(id, { bucket, path: storagePath, expiresAt, metadata = {} }) {
      const request = state.dataExportRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, {
        status: 'ready',
        completedAt: now(),
        expiresAt,
        storageBucket: bucket,
        storagePath,
        metadata,
        errorMessage: '',
      });
      this.recordUserActivity({ userId: request.userId, eventType: 'data_export_ready', metadata: { requestId: request.id } });
      save();
      return publicDataExportRequest(state, request);
    },

    markDataExportFailed(id, errorMessage) {
      const request = state.dataExportRequests.find((entry) => entry.id === id);
      if (!request) return null;
      Object.assign(request, { status: 'failed', completedAt: now(), errorMessage: String(errorMessage || 'Data export failed.').slice(0, 240) });
      this.recordUserActivity({ userId: request.userId, eventType: 'data_export_failed', metadata: { requestId: request.id, error: errorMessage } });
      save();
      return publicDataExportRequest(state, request);
    },

    upsertDataExportStep(requestId, step) {
      const existing = state.dataExportSteps.find((entry) => entry.requestId === requestId && entry.category === step.category);
      const next = {
        requestId,
        userId: state.dataExportRequests.find((entry) => entry.id === requestId)?.userId || null,
        category: step.category,
        status: step.status,
        rowCount: step.rowCount || 0,
        byteCount: step.byteCount || 0,
        errorMessage: step.errorMessage || '',
        updatedAt: now(),
      };
      if (existing) Object.assign(existing, next);
      else state.dataExportSteps.push({ id: `data-export-step-${Date.now()}-${state.dataExportSteps.length + 1}`, createdAt: now(), ...next });
      save();
      return next;
    },

    saveDataExportArtifact({ userId, requestId, bucket, path: storagePath, buffer, contentType }) {
      state.dataExportArtifacts = state.dataExportArtifacts.filter((entry) => entry.requestId !== requestId);
      state.dataExportArtifacts.push({
        userId,
        requestId,
        bucket,
        storagePath,
        contentType,
        data: Buffer.from(buffer).toString('base64'),
        createdAt: now(),
      });
      save();
    },

    getDataExportArtifact(userId, requestId) {
      const artifact = state.dataExportArtifacts.find((entry) => entry.userId === userId && entry.requestId === requestId);
      if (!artifact) return null;
      return {
        contentType: artifact.contentType,
        buffer: Buffer.from(artifact.data, 'base64'),
      };
    },

    downloadUserStorageObject() {
      return null;
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
      this.recordUserActivity({ userId, eventType: 'extension_token_created', metadata: { tokenId: token.id, scopeCount: scopes.length } });
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
      this.recordUserActivity({ userId, eventType: 'extension_token_revoked', metadata: { tokenId: id } });
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

    upsertCaptureConnection(userId, { provider, externalId, tokenHash, username = '', displayName = '' }) {
      const normalizedProvider = String(provider || '').trim().toLowerCase();
      const normalizedExternalId = String(externalId || '').trim();
      if (!normalizedProvider || !normalizedExternalId || !tokenHash) return null;
      let connection = state.captureConnections.find((entry) => entry.provider === normalizedProvider && entry.externalId === normalizedExternalId);
      if (connection) {
        Object.assign(connection, {
          userId,
          tokenHash,
          username: String(username || '').trim().slice(0, 120),
          displayName: String(displayName || '').trim().slice(0, 160),
          revokedAt: null,
          updatedAt: now(),
        });
      } else {
        connection = {
          id: `capture-connection-${Date.now()}-${state.captureConnections.length + 1}`,
          userId,
          provider: normalizedProvider,
          externalId: normalizedExternalId,
          tokenHash,
          username: String(username || '').trim().slice(0, 120),
          displayName: String(displayName || '').trim().slice(0, 160),
          createdAt: now(),
          updatedAt: now(),
          lastUsedAt: null,
          revokedAt: null,
        };
        state.captureConnections.push(connection);
      }
      this.recordUserActivity({ userId, eventType: 'capture_connection_saved', metadata: { connectionId: connection.id, provider: normalizedProvider } });
      save();
      return publicCaptureConnection(connection);
    },

    getCaptureConnection(provider, externalId) {
      const connection = state.captureConnections.find((entry) => (
        entry.provider === String(provider || '').trim().toLowerCase()
        && entry.externalId === String(externalId || '').trim()
        && !entry.revokedAt
      ));
      return connection ? { ...connection } : null;
    },

    markCaptureConnectionUsed(id) {
      const connection = state.captureConnections.find((entry) => entry.id === id);
      if (!connection) return null;
      connection.lastUsedAt = now();
      connection.updatedAt = now();
      save();
      return publicCaptureConnection(connection);
    },

    revokeCaptureConnection(provider, externalId) {
      const connection = state.captureConnections.find((entry) => (
        entry.provider === String(provider || '').trim().toLowerCase()
        && entry.externalId === String(externalId || '').trim()
        && !entry.revokedAt
      ));
      if (!connection) return false;
      connection.revokedAt = now();
      connection.updatedAt = now();
      this.recordUserActivity({ userId: connection.userId, eventType: 'capture_connection_revoked', metadata: { connectionId: connection.id, provider: connection.provider } });
      save();
      return true;
    },

    listCaptureConnections(userId) {
      return state.captureConnections
        .filter((entry) => entry.userId === userId)
        .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
        .map(publicCaptureConnection);
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
        eventType: status === 'queued_storage' ? 'import_started' : 'import_completed',
        metadata: { importId: entry.id, source, fileCount: fileNames.length },
      });
      save();
      return entry;
    },

    getImport(userId, id) {
      return state.imports.find((entry) => entry.userId === userId && entry.id === id) || null;
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
      this.recordUserActivity({
        userId: entry.userId,
        eventType: status === 'failed' ? 'import_failed' : status === 'imported' ? 'import_completed' : 'import_status_changed',
        metadata: { importId: entry.id, status, errorCategory: error ? 'import_error' : '' },
      });
      save();
      return entry;
    },

    upsertImportData({ userId, importId, parsed, initialStatus = 'queued', duplicateMode = 'mergeExisting' }) {
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
          if (duplicateMode === 'skipExisting') continue;
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

    getItemArchive(userId, itemId) {
      return localItemArchive(state, userId, itemId, { includeContent: true });
    },

    upsertItemArchive(userId, itemId, archive = {}) {
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!item) return null;
      const existing = state.itemArchives.find((entry) => entry.userId === userId && entry.itemId === itemId);
      const timestamp = now();
      const next = {
        id: existing?.id || `archive-${crypto.randomUUID()}`,
        userId,
        itemId,
        status: archive.status || existing?.status || 'pending',
        sourceUrl: archive.sourceUrl ?? existing?.sourceUrl ?? item.url,
        finalUrl: archive.finalUrl ?? existing?.finalUrl ?? '',
        canonicalUrl: archive.canonicalUrl ?? existing?.canonicalUrl ?? '',
        title: archive.title ?? existing?.title ?? '',
        byline: archive.byline ?? existing?.byline ?? '',
        siteName: archive.siteName ?? existing?.siteName ?? '',
        excerpt: archive.excerpt ?? existing?.excerpt ?? '',
        contentText: archive.contentText ?? existing?.contentText ?? '',
        contentHtml: archive.contentHtml ?? existing?.contentHtml ?? '',
        textLength: Number(archive.textLength ?? existing?.textLength ?? 0),
        byteSize: Number(archive.byteSize ?? existing?.byteSize ?? 0),
        contentHash: archive.contentHash ?? existing?.contentHash ?? '',
        httpStatus: archive.httpStatus ?? existing?.httpStatus ?? null,
        errorCode: archive.errorCode ?? existing?.errorCode ?? '',
        errorMessage: archive.errorMessage ?? existing?.errorMessage ?? '',
        capturedAt: archive.capturedAt ?? existing?.capturedAt ?? null,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      };
      if (existing) Object.assign(existing, next);
      else state.itemArchives.push(next);
      save();
      return publicArchive(next, { includeContent: true });
    },

    listLinkHealthChecks(userId) {
      return state.linkHealthChecks
        .filter((entry) => entry.userId === userId)
        .map(publicLinkHealth);
    },

    upsertLinkHealthCheck(userId, itemId, check = {}) {
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!item) return null;
      const existing = state.linkHealthChecks.find((entry) => entry.userId === userId && entry.itemId === itemId);
      const timestamp = now();
      const next = {
        id: existing?.id || `link-health-${crypto.randomUUID()}`,
        userId,
        itemId,
        status: check.status || existing?.status || 'unknown',
        url: check.sourceUrl || check.url || existing?.url || item.url,
        finalUrl: check.finalUrl ?? existing?.finalUrl ?? '',
        httpStatus: check.httpStatus ?? existing?.httpStatus ?? null,
        errorCode: check.errorCode ?? existing?.errorCode ?? '',
        errorMessage: check.errorMessage ?? existing?.errorMessage ?? '',
        checkedAt: check.checkedAt || timestamp,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      };
      if (existing) Object.assign(existing, next);
      else state.linkHealthChecks.push(next);
      save();
      return publicLinkHealth(next);
    },

    listItemReminders(userId, { status = null } = {}) {
      return state.itemReminders
        .filter((entry) => entry.userId === userId && (!status || entry.status === status))
        .sort((a, b) => String(a.remindAt).localeCompare(String(b.remindAt)))
        .map(publicReminder);
    },

    createItemReminder(userId, itemId, reminder = {}) {
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!item) return null;
      const existing = state.itemReminders.find((entry) => (
        entry.userId === userId &&
        entry.itemId === itemId &&
        entry.status === 'pending' &&
        entry.reason === reminder.reason &&
        entry.remindAt === reminder.remindAt
      ));
      if (existing) return publicReminder(existing);
      const timestamp = now();
      const created = {
        id: `reminder-${crypto.randomUUID()}`,
        userId,
        itemId,
        status: 'pending',
        remindAt: reminder.remindAt,
        reason: reminder.reason || 'remind_later',
        note: reminder.note || '',
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.itemReminders.push(created);
      save();
      return publicReminder(created);
    },

    updateItemReminder(userId, id, patch = {}) {
      const reminder = state.itemReminders.find((entry) => entry.userId === userId && entry.id === id);
      if (!reminder) return null;
      if (Object.prototype.hasOwnProperty.call(patch, 'status')) reminder.status = patch.status;
      if (Object.prototype.hasOwnProperty.call(patch, 'completedAt')) reminder.completedAt = patch.completedAt;
      reminder.updatedAt = now();
      save();
      return publicReminder(reminder);
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
      state.itemArchives = state.itemArchives.filter((archive) => !(archive.userId === userId && archive.itemId === id));
      state.linkHealthChecks = state.linkHealthChecks.filter((check) => !(check.userId === userId && check.itemId === id));
      state.itemReminders = state.itemReminders.filter((reminder) => !(reminder.userId === userId && reminder.itemId === id));
      state.smartCollectionItems = state.smartCollectionItems.filter((entry) => !(entry.userId === userId && entry.itemId === id));
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

    listItemsPage(userId, options = {}) {
      return listItemsPageFromItems(this.getItems(userId), options);
    },

    refreshSmartCollections(userId) {
      const generatedAt = now();
      const candidates = generateSmartCollectionCandidates(this.getItems(userId));
      const collectionIds = [];

      for (const candidate of candidates) {
        let collection = state.smartCollections.find((entry) => entry.userId === userId && entry.slug === candidate.slug);
        if (!collection) {
          collection = {
            id: `smart-${crypto.randomUUID()}`,
            userId,
            name: candidate.name,
            description: candidate.description,
            slug: candidate.slug,
            sourceType: candidate.sourceType,
            pinned: false,
            hidden: false,
            generationMetadata: candidate.generationMetadata || {},
            createdAt: generatedAt,
            updatedAt: generatedAt,
          };
          state.smartCollections.push(collection);
        } else {
          collection.sourceType = candidate.sourceType;
          collection.generationMetadata = candidate.generationMetadata || {};
          collection.updatedAt = generatedAt;
        }
        collectionIds.push(collection.id);
      }

      if (collectionIds.length) {
        const collectionIdSet = new Set(collectionIds);
        state.smartCollectionItems = state.smartCollectionItems.filter((entry) => (
          !(entry.userId === userId && collectionIdSet.has(entry.collectionId) && entry.source === 'auto')
        ));
      }

      const manualExcludes = new Set(state.smartCollectionItems
        .filter((entry) => entry.userId === userId && entry.source === 'manual_exclude')
        .map((entry) => `${entry.collectionId}:${entry.itemId}`));
      const existingMemberships = new Set(state.smartCollectionItems
        .filter((entry) => entry.userId === userId)
        .map((entry) => `${entry.collectionId}:${entry.itemId}:${entry.source}`));

      for (const candidate of candidates) {
        const collection = state.smartCollections.find((entry) => entry.userId === userId && entry.slug === candidate.slug);
        if (!collection) continue;
        for (const item of candidate.items) {
          if (manualExcludes.has(`${collection.id}:${item.itemId}`)) continue;
          const key = `${collection.id}:${item.itemId}:auto`;
          if (existingMemberships.has(key)) continue;
          existingMemberships.add(key);
          state.smartCollectionItems.push({
            id: `smart-item-${crypto.randomUUID()}`,
            userId,
            collectionId: collection.id,
            itemId: item.itemId,
            confidence: item.confidence,
            reason: item.reason,
            source: 'auto',
            createdAt: generatedAt,
            updatedAt: generatedAt,
          });
        }
      }

      save();
      return this.listSmartCollections(userId);
    },

    listSmartCollections(userId, { limit = DEFAULT_VISIBLE_COLLECTIONS_LIMIT, includeHidden = false } = {}) {
      const visible = state.smartCollections
        .filter((collection) => collection.userId === userId && (includeHidden || !collection.hidden))
        .map(publicLocalSmartCollection)
        .filter((collection) => collection.itemCount > 0);
      return sortSmartCollections(visible).slice(0, Math.max(1, Math.min(Number(limit) || DEFAULT_VISIBLE_COLLECTIONS_LIMIT, 100)));
    },

    listSmartCollectionItems(userId, collectionId, options = {}) {
      const collection = state.smartCollections.find((entry) => entry.userId === userId && entry.id === collectionId);
      if (!collection) return null;
      const itemIds = activeSmartCollectionItemIds(userId, collectionId);
      const items = this.getItems(userId).filter((item) => itemIds.has(item.id));
      const page = listItemsPageFromItems(items, options);
      return {
        collection: publicLocalSmartCollection(collection),
        ...page,
      };
    },

    updateSmartCollection(userId, id, patch = {}) {
      const collection = state.smartCollections.find((entry) => entry.userId === userId && entry.id === id);
      if (!collection) return null;
      if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
        const name = String(patch.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (name) collection.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
        collection.description = String(patch.description || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) collection.pinned = Boolean(patch.pinned);
      if (Object.prototype.hasOwnProperty.call(patch, 'hidden')) collection.hidden = Boolean(patch.hidden);
      collection.updatedAt = now();
      save();
      return publicLocalSmartCollection(collection);
    },

    setSmartCollectionItemOverride(userId, collectionId, itemId, action = 'exclude') {
      const collection = state.smartCollections.find((entry) => entry.userId === userId && entry.id === collectionId);
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!collection || !item) return null;
      const normalizedAction = ['include', 'exclude', 'auto'].includes(action) ? action : 'exclude';
      state.smartCollectionItems = state.smartCollectionItems.filter((entry) => (
        !(entry.userId === userId && entry.collectionId === collectionId && entry.itemId === itemId && entry.source !== 'auto')
      ));
      if (normalizedAction !== 'auto') {
        const source = normalizedAction === 'include' ? 'manual_include' : 'manual_exclude';
        state.smartCollectionItems.push({
          id: `smart-item-${crypto.randomUUID()}`,
          userId,
          collectionId,
          itemId,
          confidence: 1,
          reason: normalizedAction === 'include' ? 'Added by you.' : 'Removed by you.',
          source,
          createdAt: now(),
          updatedAt: now(),
        });
      }
      save();
      return publicLocalSmartCollection(collection);
    },

    getItem(userId, id) {
      return hydrateLocalItem(state, state.items.find((item) => item.userId === userId && item.id === id) || null, { includeArchiveContent: true });
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

    getWorkerQueueStatus({ maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS } = {}) {
      return summarizeJobQueue(state.jobs, { maxAttempts });
    },

    saveAnalysis(userId, itemId, analysis) {
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!item) return null;
      item.analysis = analysis;
      item.status = 'done';
      item.updatedAt = now();
      save();
      this.refreshSmartCollections(userId);
      return hydrateLocalItem(state, item, { includeArchiveContent: true });
    },

    markItemFailed(userId, itemId, error) {
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!item) return null;
      item.status = 'failed';
      item.error = error;
      item.updatedAt = now();
      save();
      return hydrateLocalItem(state, item, { includeArchiveContent: true });
    },

    setItemStatus(userId, itemId, status, error = null) {
      const item = state.items.find((entry) => entry.userId === userId && entry.id === itemId);
      if (!item) return null;
      item.status = status;
      item.error = error;
      item.updatedAt = now();
      save();
      return hydrateLocalItem(state, item, { includeArchiveContent: true });
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
        metadata: sanitizeAuditMetadata(metadata),
        createdAt: now(),
      };
      state.userActivityEvents.push(event);
      save();
      return event;
    },

    recordSecurityAudit({
      actorUserId = null,
      actorType = 'system',
      targetUserId = null,
      eventType,
      severity = 'info',
      result = 'success',
      requestId = '',
      route = '',
      method = '',
      ipHash = '',
      userAgentHash = '',
      metadata = {},
    }) {
      if (!eventType) return null;
      const event = {
        id: `audit-${Date.now()}-${state.securityAuditEvents.length + 1}`,
        actorUserId,
        actorType,
        targetUserId,
        eventType,
        severity,
        result,
        requestId,
        route,
        method,
        ipHash,
        userAgentHash,
        metadata: sanitizeAuditMetadata(metadata),
        createdAt: now(),
      };
      state.securityAuditEvents.push(event);
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
      this.recordUserActivity({
        userId,
        eventType: 'credit_changed',
        metadata: { amount: numericAmount, reason, itemId: itemId || '' },
      });
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
      const userJobs = state.jobs.filter((entry) => entry.userId === user.id);
      const lastActivity = state.userActivityEvents
        .filter((entry) => entry.userId === user.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
      return {
        ...adminUserSummary(state, user, this.getCredits(user.id)),
        counts: {
          imports: state.imports.filter((entry) => entry.userId === user.id).length,
          saves: state.items.filter((entry) => entry.userId === user.id).length,
          providerCredentials: state.providerCredentials.filter((entry) => entry.userId === user.id).length,
          extensionTokens: state.extensionTokens.filter((entry) => entry.userId === user.id && !entry.revokedAt).length,
          captureConnections: state.captureConnections.filter((entry) => entry.userId === user.id).length,
        },
        jobStats: userJobs.reduce((stats, job) => {
          stats[job.status || 'unknown'] = (stats[job.status || 'unknown'] || 0) + 1;
          return stats;
        }, {}),
        deletion: mapDeletionRequest(activeDeletionRequestForUser(user.id)),
        lastActivity,
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

    listUserTimeline(userId, { limit = 100 } = {}) {
      return [...state.userActivityEvents]
        .filter((entry) => entry.userId === userId)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, Math.max(1, Math.min(Number(limit) || 100, 200)));
    },

    listUserSecurityActivity(userId, { limit = 20 } = {}) {
      return [...state.securityAuditEvents]
        .filter((entry) => entry.actorUserId === userId || entry.targetUserId === userId)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, Math.max(1, Math.min(Number(limit) || 20, 50)))
        .map((entry) => ({
          id: entry.id,
          eventType: entry.eventType,
          actorType: entry.actorUserId === userId ? entry.actorType : 'support',
          severity: entry.severity,
          result: entry.result,
          metadata: sanitizeAuditMetadata(entry.metadata || {}),
          createdAt: entry.createdAt,
        }));
    },

    listSecurityAuditEvents({
      targetUserId = '',
      eventType = '',
      severity = '',
      limit = 100,
    } = {}) {
      return [...state.securityAuditEvents]
        .filter((entry) => !targetUserId || entry.targetUserId === targetUserId)
        .filter((entry) => !eventType || entry.eventType === eventType)
        .filter((entry) => !severity || entry.severity === severity)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, Math.max(1, Math.min(Number(limit) || 100, 200)));
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
      this.recordUserActivity({
        userId,
        eventType: existing ? 'provider_credential_updated' : 'provider_credential_created',
        metadata: { credentialId: row.id, provider, purpose, model },
      });
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
      if (state.providerCredentials.length !== before) {
        this.recordUserActivity({ userId, eventType: 'provider_credential_deleted', metadata: { credentialId: id } });
      }
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
