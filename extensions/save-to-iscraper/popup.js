const DEFAULT_APP_URL = 'https://iscraper.vercel.app';

const titleEl = document.getElementById('tab-title');
const noteEl = document.getElementById('note');
const saveEl = document.getElementById('save');
const lensEl = document.getElementById('lens');
const openEl = document.getElementById('open');
const appUrlEl = document.getElementById('app-url');
const saveUrlEl = document.getElementById('save-url');
const lensTokenEl = document.getElementById('lens-token');
const saveTokenEl = document.getElementById('save-token');
const connectEl = document.getElementById('connect');
const statusEl = document.getElementById('status');

let activeTab = null;
let pageMeta = {};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getAppUrl() {
  const stored = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL });
  const value = String(stored.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
  return /^https:\/\//i.test(value) ? value : DEFAULT_APP_URL;
}

async function getLensToken() {
  const stored = await chrome.storage.sync.get({ lensToken: '' });
  return String(stored.lensToken || '').trim();
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

async function openConnect() {
  const appUrl = await getAppUrl();
  await chrome.tabs.create({ url: `${appUrl}/#app?connectExtension=1` });
  window.close();
}

async function startLens() {
  if (!activeTab?.id || !/^https?:\/\//i.test(activeTab.url || '')) {
    statusEl.textContent = 'Lens works on normal web pages only.';
    return;
  }
  const appUrl = await getAppUrl();
  const lensToken = await getLensToken();
  if (!lensToken) {
    statusEl.textContent = 'Paste your Lens token first.';
    return;
  }
  try {
    await chrome.tabs.sendMessage(activeTab.id, { type: 'ISCRAPER_START_LENS', appUrl, lensToken });
    window.close();
  } catch (_error) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(activeTab.id, { type: 'ISCRAPER_START_LENS', appUrl, lensToken });
      window.close();
    } catch {
      statusEl.textContent = 'Lens cannot run on this browser page.';
    }
  }
}

async function init() {
  activeTab = await getActiveTab();
  const appUrl = await getAppUrl();
  const lensToken = await getLensToken();
  appUrlEl.value = appUrl;
  lensTokenEl.value = lensToken;
  if (activeTab?.id && /^https?:\/\//i.test(activeTab.url || '')) {
    pageMeta = await readPageMeta(activeTab.id).catch(() => ({}));
  }
  const platform = activeTab?.url && /^https?:\/\//i.test(activeTab.url) ? detectPlatform(activeTab.url) : '';
  titleEl.textContent = activeTab?.title ? `${platform ? `${platform}: ` : ''}${pageMeta.title || activeTab.title}` : 'No active tab found.';
}

saveEl.addEventListener('click', openSaveUrl);
lensEl.addEventListener('click', startLens);
openEl.addEventListener('click', openApp);
connectEl.addEventListener('click', openConnect);
saveUrlEl.addEventListener('click', async () => {
  const value = appUrlEl.value.trim().replace(/\/$/, '');
  if (!/^https:\/\//i.test(value)) {
    statusEl.textContent = 'Use a full secure app URL starting with https://';
    return;
  }
  await chrome.storage.sync.set({ appUrl: value });
  statusEl.textContent = 'App URL saved.';
});
saveTokenEl.addEventListener('click', async () => {
  const value = lensTokenEl.value.trim();
  if (!value.startsWith('isx_')) {
    statusEl.textContent = 'Paste a valid IScraper Lens token.';
    return;
  }
  await chrome.storage.sync.set({ lensToken: value });
  statusEl.textContent = 'Lens token saved.';
});

init().catch((error) => {
  statusEl.textContent = error.message || 'Could not read current tab.';
});
