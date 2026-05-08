const DEFAULT_APP_URL = 'https://iscraper.vercel.app';

const titleEl = document.getElementById('tab-title');
const noteEl = document.getElementById('note');
const saveEl = document.getElementById('save');
const openEl = document.getElementById('open');
const appUrlEl = document.getElementById('app-url');
const saveUrlEl = document.getElementById('save-url');
const statusEl = document.getElementById('status');

let activeTab = null;
let pageMeta = {};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getAppUrl() {
  const stored = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL });
  return String(stored.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
}

function detectPlatform(url) {
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  if (host.includes('pinterest.') || host === 'pin.it') return 'Pinterest';
  if (host === 'x.com' || host.includes('twitter.com')) return 'X / Twitter';
  if (host.includes('tiktok.com')) return 'TikTok';
  if (host.includes('youtube.com') || host === 'youtu.be') return 'YouTube';
  if (host.includes('instagram.com')) return 'Instagram';
  return host;
}

async function readPageMeta(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
      return {
        title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title || '',
        description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || meta('meta[name="twitter:description"]') || '',
        thumbnailUrl: meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || '',
        author: meta('meta[name="author"]') || meta('meta[property="article:author"]') || '',
      };
    },
  });
  return result?.result || {};
}

function saveUrlFor(tab, appUrl) {
  const params = new URLSearchParams({
    url: tab.url || '',
    title: pageMeta.title || tab.title || '',
    description: pageMeta.description || '',
    thumbnailUrl: pageMeta.thumbnailUrl || '',
    author: pageMeta.author || '',
    platform: detectPlatform(tab.url || ''),
    note: noteEl.value || '',
    autoSave: '1',
  });
  return `${appUrl}/#app?${params.toString()}`;
}

async function openSaveUrl() {
  if (!activeTab?.url || !/^https?:\/\//i.test(activeTab.url)) {
    statusEl.textContent = 'Open a normal web page first.';
    return;
  }
  const appUrl = await getAppUrl();
  await chrome.tabs.create({ url: saveUrlFor(activeTab, appUrl) });
  window.close();
}

async function openApp() {
  const appUrl = await getAppUrl();
  await chrome.tabs.create({ url: `${appUrl}/#app` });
  window.close();
}

async function init() {
  activeTab = await getActiveTab();
  const appUrl = await getAppUrl();
  appUrlEl.value = appUrl;
  if (activeTab?.id && /^https?:\/\//i.test(activeTab.url || '')) {
    pageMeta = await readPageMeta(activeTab.id).catch(() => ({}));
  }
  const platform = activeTab?.url && /^https?:\/\//i.test(activeTab.url) ? detectPlatform(activeTab.url) : '';
  titleEl.textContent = activeTab?.title ? `${platform ? `${platform}: ` : ''}${pageMeta.title || activeTab.title}` : 'No active tab found.';
}

saveEl.addEventListener('click', openSaveUrl);
openEl.addEventListener('click', openApp);
saveUrlEl.addEventListener('click', async () => {
  const value = appUrlEl.value.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(value)) {
    statusEl.textContent = 'Use a full app URL starting with https://';
    return;
  }
  await chrome.storage.sync.set({ appUrl: value });
  statusEl.textContent = 'App URL saved.';
});

init().catch((error) => {
  statusEl.textContent = error.message || 'Could not read current tab.';
});
