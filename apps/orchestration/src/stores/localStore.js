const fs = require('fs');
const path = require('path');
const { createJobsForImport } = require('../services/queue');
const { searchItems } = require('../services/analyzer');

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
    return { users: [], imports: [], items: [], collections: [], jobs: [] };
  }

  const legacy = readJson(legacyFile, []);
  return {
    users: [{ id: DEFAULT_USER_ID, email: 'local@example.com', createdAt: now() }],
    imports: [],
    collections: [],
    jobs: [],
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

function createLocalStore({ dataPath }) {
  const file = path.join(dataPath, 'brain.local.json');
  let state = readJson(file, null) || seedFromLegacyIndex(dataPath);

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

    search(userId, query, filters = {}) {
      return searchItems(this.getItems(userId), query, filters);
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
