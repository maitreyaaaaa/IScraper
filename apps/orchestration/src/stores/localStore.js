const fs = require('fs');
const path = require('path');
const { createJobsForImport, isRestartableJob } = require('../services/queue');
const { searchItems } = require('../services/analyzer');
const { decryptSecret, encryptSecret, maskSecret, publicCredential } = require('../services/credentials');
const { assertMediaModelAllowed, assertProviderPurpose } = require('../services/providers');

const DEFAULT_USER_ID = 'local-dev-user';
const FREE_ITEMS_LIMIT = 200;

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
    creditTransactions: [],
    analysisUsageEvents: [],
    feedback: [],
    items: legacy.map((item) => ({
      ...item,
      userId: DEFAULT_USER_ID,
      importId: null,
      contentType: item.url?.includes('/reel/') ? 'reel' : 'post',
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
    creditTransactions: [],
    analysisUsageEvents: [],
    feedback: [],
  };
}

function normalizeState(state) {
  return {
    ...emptyState(),
    ...state,
    providerCredentials: state.providerCredentials || [],
    creditTransactions: state.creditTransactions || [],
    analysisUsageEvents: state.analysisUsageEvents || [],
    feedback: state.feedback || [],
  };
}

function createLocalStore({ dataPath }) {
  const file = path.join(dataPath, 'brain.local.json');
  let state = normalizeState(readJson(file, null) || seedFromLegacyIndex(dataPath));

  function save() {
    writeJson(file, state);
  }

  function ensureUser(userId, email) {
    if (!state.users.find((user) => user.id === userId)) {
      state.users.push({ id: userId, email, createdAt: now() });
      save();
    }
  }

  return {
    ensureUser,

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

    createImport({ userId, source, mode = 'export', fileNames = [] }) {
      const entry = {
        id: `import-${Date.now()}`,
        userId,
        source,
        mode,
        fileNames,
        status: 'imported',
        createdAt: now(),
        updatedAt: now(),
      };
      state.imports.push(entry);
      save();
      return entry;
    },

    upsertImportData({ userId, importId, parsed }) {
      for (const collection of parsed.collections) {
        const id = `${userId}:${collection.name}`;
        if (!state.collections.find((entry) => entry.id === id)) {
          state.collections.push({ id, userId, name: collection.name, sourceName: collection.sourceName, createdAt: now() });
        }
      }

      const items = parsed.items.map((item) => {
        const existing = state.items.find((entry) => entry.userId === userId && entry.url === item.url);
        if (existing) {
          Object.assign(existing, {
            ...item,
            userId,
            importId,
            collections: [...new Set([...(existing.collections || []), ...(item.collections || [])])],
            updatedAt: now(),
          });
          return existing;
        }

        const created = {
          ...item,
          userId,
          importId,
          status: 'queued',
          analysis: null,
          createdAt: now(),
          updatedAt: now(),
        };
        state.items.push(created);
        return created;
      });

      save();
      return items;
    },

    createJobs({ userId, importId, items }) {
      const existingJobs = state.jobs.filter((job) => job.userId === userId && job.importId === importId);
      const jobs = createJobsForImport({ importId, items, existingJobs }).map((job) => ({ ...job, userId }));
      state.jobs.push(...jobs);
      save();
      return jobs;
    },

    getItems(userId) {
      return state.items.filter((item) => item.userId === userId);
    },

    getItem(userId, id) {
      return state.items.find((item) => item.userId === userId && item.id === id) || null;
    },

    getJobs(userId, importId = null) {
      return state.jobs.filter((job) => job.userId === userId && (!importId || job.importId === importId));
    },

    getJob(userId, id) {
      return state.jobs.find((job) => job.userId === userId && job.id === id) || null;
    },

    updateJob(userId, id, patch) {
      const job = this.getJob(userId, id);
      if (!job) return null;
      Object.assign(job, patch, { updatedAt: now() });
      save();
      return job;
    },

    restartJobs(userId, importId = null) {
      const jobs = state.jobs.filter((job) => job.userId === userId && (!importId || job.importId === importId) && isRestartableJob(job));
      for (const job of jobs) {
        Object.assign(job, {
          status: 'queued',
          error: null,
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
      return searchItems(this.getItems(userId), query, filters);
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
      if (source === 'paid') {
        state.creditTransactions.push({
          id: `credit-${Date.now()}-${state.creditTransactions.length + 1}`,
          userId,
          amount: -1,
          reason: 'item_analysis',
          itemId,
          createdAt: now(),
        });
      }
      save();
      return event;
    },

    addCreditTransaction({ userId, amount, reason = 'manual' }) {
      const transaction = {
        id: `credit-${Date.now()}-${state.creditTransactions.length + 1}`,
        userId,
        amount,
        reason,
        createdAt: now(),
      };
      state.creditTransactions.push(transaction);
      save();
      return transaction;
    },

    listProviderCredentials(userId) {
      return state.providerCredentials
        .filter((credential) => credential.userId === userId)
        .map(publicCredential);
    },

    saveProviderCredential(userId, { provider, purpose, model, apiKey, encryptionKey, status = 'active', isPreferred = true }) {
      assertProviderPurpose(provider, purpose);
      if (purpose === 'media' && provider === 'openrouter') assertMediaModelAllowed(model);
      if (!apiKey) throw new Error('API key is required.');

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

module.exports = {
  createLocalStore,
  DEFAULT_USER_ID,
};
