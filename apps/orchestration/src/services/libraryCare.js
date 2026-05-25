const { normalizeSavedUrl } = require('./linkSaver');

const LINK_HEALTH_STATUSES = new Set(['ok', 'broken', 'unknown']);
const REMINDER_STATUSES = new Set(['pending', 'done', 'dismissed']);

function nowIso() {
  return new Date().toISOString();
}

function duplicateKeyForItem(item) {
  if (!item?.url) return '';
  try {
    const normalized = normalizeSavedUrl(item.url);
    const parsed = new URL(normalized);
    parsed.hostname = parsed.hostname.replace(/^www\./, '');
    return parsed.toString();
  } catch {
    return '';
  }
}

function publicCareItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    url: item.url,
    title: item.sourceTitle || item.analysis?.title || firstLine(item.caption) || item.url,
    platform: item.platform || 'Web',
    platformKey: item.platformKey || '',
    collection: item.collections?.[0] || 'Unsorted',
    thumbnailUrl: item.thumbnailUrl || item.assets?.find((asset) => asset.assetType === 'image' && asset.url)?.url || '',
    status: item.status || 'queued',
    createdAt: item.createdAt || item.savedAt || '',
    updatedAt: item.updatedAt || '',
  };
}

function firstLine(value = '') {
  return String(value || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
}

function buildDuplicateGroups(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = duplicateKeyForItem(item);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => String(a.createdAt || a.savedAt || '').localeCompare(String(b.createdAt || b.savedAt || '')));
      const keep = sorted.find((item) => item.status === 'done') || sorted[0];
      return {
        id: `dup-${hashString(key)}`,
        key,
        host: hostForUrl(key),
        title: keep.sourceTitle || firstLine(keep.caption) || hostForUrl(key),
        keepItemId: keep.id,
        duplicateCount: sorted.length - 1,
        items: sorted.map(publicCareItem),
      };
    })
    .sort((a, b) => b.duplicateCount - a.duplicateCount || a.title.localeCompare(b.title));
}

function buildBrokenLinks(items = [], checks = []) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return checks
    .filter((check) => check.status === 'broken' && itemById.has(check.itemId))
    .map((check) => ({
      ...publicLinkHealth(check),
      item: publicCareItem(itemById.get(check.itemId)),
    }))
    .sort((a, b) => String(b.checkedAt || '').localeCompare(String(a.checkedAt || '')));
}

function buildRediscovery({ items = [], reminders = [], referenceDate = new Date() } = {}) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const dueReminders = reminders
    .filter((reminder) => reminder.status === 'pending' && new Date(reminder.remindAt).getTime() <= referenceDate.getTime() && itemById.has(reminder.itemId))
    .sort((a, b) => String(a.remindAt).localeCompare(String(b.remindAt)))
    .slice(0, 12)
    .map((reminder) => ({
      ...publicReminder(reminder),
      item: publicCareItem(itemById.get(reminder.itemId)),
    }));
  const oldItems = items
    .filter((item) => {
      const created = new Date(item.createdAt || item.savedAt || 0).getTime();
      return created > 0 && referenceDate.getTime() - created >= 90 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => String(a.createdAt || a.savedAt || '').localeCompare(String(b.createdAt || b.savedAt || '')))
    .slice(0, 8)
    .map(publicCareItem);
  const weeklyItems = stableSample(items, 6, weekSeed(referenceDate)).map(publicCareItem);
  const randomItem = stableSample(items, 1, daySeed(referenceDate))[0] || null;
  return {
    dueReminders,
    oldItems,
    weeklyItems,
    randomItem: publicCareItem(randomItem),
  };
}

function linkCheckCandidates(items = [], checks = [], limit = 20) {
  const checkByItemId = new Map(checks.map((check) => [check.itemId, check]));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return items
    .filter((item) => item?.url && item.contentType !== 'note' && item.platformKey !== 'iscraper-note')
    .map((item) => ({ item, check: checkByItemId.get(item.id) || null }))
    .filter(({ check }) => !check?.checkedAt || new Date(check.checkedAt).getTime() < weekAgo)
    .sort((a, b) => String(a.check?.checkedAt || '').localeCompare(String(b.check?.checkedAt || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || 20, 50)))
    .map(({ item }) => item);
}

function publicLinkHealth(check) {
  if (!check) return null;
  return {
    id: check.id || '',
    itemId: check.itemId,
    status: LINK_HEALTH_STATUSES.has(check.status) ? check.status : 'unknown',
    url: check.url || '',
    finalUrl: check.finalUrl || '',
    httpStatus: check.httpStatus ?? null,
    errorCode: check.errorCode || '',
    errorMessage: check.errorMessage || '',
    checkedAt: check.checkedAt || null,
    createdAt: check.createdAt || null,
    updatedAt: check.updatedAt || null,
  };
}

function publicReminder(reminder) {
  if (!reminder) return null;
  return {
    id: reminder.id,
    itemId: reminder.itemId,
    status: REMINDER_STATUSES.has(reminder.status) ? reminder.status : 'pending',
    remindAt: reminder.remindAt,
    reason: reminder.reason || 'remind_later',
    note: reminder.note || '',
    completedAt: reminder.completedAt || null,
    createdAt: reminder.createdAt || null,
    updatedAt: reminder.updatedAt || null,
  };
}

function normalizeReminderInput(input = {}) {
  const preset = String(input.preset || '').trim();
  const now = new Date();
  let remindAt = input.remindAt ? new Date(input.remindAt) : null;
  if (!remindAt || Number.isNaN(remindAt.getTime())) {
    const days = preset === 'tomorrow' ? 1 : preset === 'month' ? 30 : 7;
    remindAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }
  if (remindAt.getTime() < now.getTime() - 60 * 1000) {
    const error = new Error('Choose a future reminder time.');
    error.statusCode = 400;
    throw error;
  }
  return {
    remindAt: remindAt.toISOString(),
    reason: String(input.reason || preset || 'remind_later').trim().slice(0, 80),
    note: String(input.note || '').replace(/\s+/g, ' ').trim().slice(0, 300),
  };
}

function buildLibraryCareSummary({ items = [], linkChecks = [], reminders = [] } = {}) {
  const duplicateGroups = buildDuplicateGroups(items);
  const brokenLinks = buildBrokenLinks(items, linkChecks);
  const resurface = buildRediscovery({ items, reminders });
  return {
    cleanup: {
      duplicateGroups,
      brokenLinks,
      duplicateGroupCount: duplicateGroups.length,
      brokenLinkCount: brokenLinks.length,
      checkedLinkCount: linkChecks.length,
    },
    resurface,
    generatedAt: nowIso(),
  };
}

function hostForUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < String(value).length; index += 1) {
    hash = ((hash << 5) - hash + String(value).charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function stableSample(items, limit, seed) {
  return [...items]
    .filter((item) => item.status !== 'needs_review')
    .map((item) => ({ item, score: hashString(`${seed}:${item.id}`) }))
    .sort((a, b) => a.score.localeCompare(b.score))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.item);
}

function weekSeed(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.floor((date.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-w${week}`;
}

function daySeed(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = {
  LINK_HEALTH_STATUSES,
  REMINDER_STATUSES,
  buildLibraryCareSummary,
  duplicateKeyForItem,
  linkCheckCandidates,
  normalizeReminderInput,
  publicLinkHealth,
  publicReminder,
};
