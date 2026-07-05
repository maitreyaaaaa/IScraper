const DEFAULT_APP_URL = 'https://iscraper.vercel.app';
const DEFAULT_SETTINGS = {
  defaultAction: 'menu',
  screenshotQuality: 'balanced',
  autoClosePopup: true,
  defaultCollection: 'Browser captures',
  autoAnalyzeScreenshots: true,
  includeSourceUrl: true,
  includePageTitle: true,
  alwaysShowCaptureIcon: true,
};

const titleEl = document.getElementById('tab-title');
const signedOutEl = document.getElementById('signed-out');
const actionsEl = document.getElementById('actions');
const captureUrlEl = document.getElementById('capture-url');
const screenCaptureEl = document.getElementById('screen-capture');
const selectionCaptureEl = document.getElementById('selection-capture');
const researchDockEl = document.getElementById('research-dock');
const connectEl = document.getElementById('connect');
const settingsEl = document.getElementById('settings');
const statusEl = document.getElementById('status');
const accountEl = document.getElementById('account');
const undoUrlEl = document.getElementById('undo-url');
const captureCollectionEl = document.getElementById('capture-collection');
const captureNoteEl = document.getElementById('capture-note');

let activeTab = null;
let pageMeta = {};
let extensionSession = null;
let settings = DEFAULT_SETTINGS;
let defaultActionStarted = false;
let undoUrlTimer = null;
let pendingUrlUndo = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getAppUrl() {
  const stored = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL });
  const value = String(stored.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
  return /^https:\/\//i.test(value) ? value : DEFAULT_APP_URL;
}

async function getExtensionSession() {
  const stored = await chrome.storage.local.get({
    extensionToken: '',
    extensionTokenId: '',
    extensionUserEmail: '',
  });
  const token = String(stored.extensionToken || '').trim();
  if (!token) return null;
  return {
    token,
    tokenId: String(stored.extensionTokenId || ''),
    email: String(stored.extensionUserEmail || ''),
  };
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    defaultAction: ['menu', 'capture-url', 'screen-capture'].includes(stored.defaultAction) ? stored.defaultAction : DEFAULT_SETTINGS.defaultAction,
    screenshotQuality: ['balanced', 'high'].includes(stored.screenshotQuality) ? stored.screenshotQuality : DEFAULT_SETTINGS.screenshotQuality,
    defaultCollection: String(stored.defaultCollection || DEFAULT_SETTINGS.defaultCollection).trim().replace(/\s+/g, ' ').slice(0, 80) || DEFAULT_SETTINGS.defaultCollection,
    autoClosePopup: stored.autoClosePopup !== false,
    autoAnalyzeScreenshots: stored.autoAnalyzeScreenshots !== false,
    includeSourceUrl: stored.includeSourceUrl !== false,
    includePageTitle: stored.includePageTitle !== false,
    alwaysShowCaptureIcon: stored.alwaysShowCaptureIcon !== false,
  };
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

function captureBody() {
  const details = captureDetails();
  return {
    url: activeTab.url || '',
    title: pageMeta.title || activeTab.title || '',
    description: pageMeta.description || '',
    thumbnailUrl: pageMeta.thumbnailUrl || '',
    author: pageMeta.author || '',
    platform: detectPlatform(activeTab.url || ''),
    source: 'extension',
    collection: details.collection,
    note: details.note,
    clientActionId: createRequestId(),
  };
}

function captureDetails() {
  const collection = String(captureCollectionEl.value || settings.defaultCollection || DEFAULT_SETTINGS.defaultCollection)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80) || DEFAULT_SETTINGS.defaultCollection;
  const note = String(captureNoteEl.value || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  return { collection, note };
}

async function captureUrl() {
  if (!extensionSession?.token) {
    statusEl.textContent = 'Sign in before capturing.';
    return;
  }
  if (!activeTab?.url || !/^https?:\/\//i.test(activeTab.url)) {
    statusEl.textContent = 'Open a normal web page first.';
    return;
  }
  setBusy(captureUrlEl, true, 'Capturing...');
  statusEl.textContent = '';
  clearUrlUndo();
  try {
    const appUrl = await getAppUrl();
    const response = await sendRuntimeMessage({
      type: 'ISCRAPER_SAVE_URL',
      payload: {
        appUrl,
        token: extensionSession.token,
        body: captureBody(),
      },
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not capture this URL.');
    if (response.body?.newItemCount && response.body?.item?.id) {
      showUrlUndo(response.body.item.id);
    } else {
      statusEl.textContent = 'Already in your library.';
    }
  } catch (error) {
    statusEl.textContent = error.message || 'Could not capture this URL.';
  } finally {
    setBusy(captureUrlEl, false, 'Capture URL');
  }
}

function showUrlUndo(itemId) {
  pendingUrlUndo = { itemId };
  statusEl.textContent = 'URL captured to your library.';
  undoUrlEl.hidden = false;
  undoUrlEl.disabled = false;
  undoUrlEl.textContent = 'Undo';
  undoUrlTimer = window.setTimeout(clearUrlUndo, 5000);
}

function clearUrlUndo() {
  if (undoUrlTimer) window.clearTimeout(undoUrlTimer);
  undoUrlTimer = null;
  pendingUrlUndo = null;
  undoUrlEl.hidden = true;
  undoUrlEl.disabled = false;
  undoUrlEl.textContent = 'Undo';
}

async function undoUrlCapture() {
  if (!pendingUrlUndo?.itemId || !extensionSession?.token) return;
  const itemId = pendingUrlUndo.itemId;
  if (undoUrlTimer) window.clearTimeout(undoUrlTimer);
  undoUrlTimer = null;
  undoUrlEl.disabled = true;
  undoUrlEl.textContent = 'Undoing...';
  try {
    const appUrl = await getAppUrl();
    const response = await sendRuntimeMessage({
      type: 'ISCRAPER_DELETE_URL_CAPTURE',
      payload: {
        appUrl,
        token: extensionSession.token,
        itemId,
        requestId: createRequestId(),
      },
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not undo this URL capture.');
    statusEl.textContent = 'URL capture undone.';
    clearUrlUndo();
  } catch (error) {
    statusEl.textContent = error.message || 'Could not undo this URL capture.';
    undoUrlEl.disabled = false;
    undoUrlEl.textContent = 'Undo';
    undoUrlTimer = window.setTimeout(clearUrlUndo, 5000);
  }
}

async function startScreenCapture() {
  if (!extensionSession?.token) {
    statusEl.textContent = 'Sign in before capturing.';
    return;
  }
  if (!activeTab?.id || !/^https?:\/\//i.test(activeTab.url || '')) {
    statusEl.textContent = 'Screen capture works on normal web pages only.';
    return;
  }
  const appUrl = await getAppUrl();
  const details = captureDetails();
  const pageTitle = settings.includePageTitle ? (pageMeta.title || activeTab.title || '') : '';
  const pageUrl = settings.includeSourceUrl ? (activeTab.url || '') : '';
  const message = {
    type: 'ISCRAPER_START_SCREEN_CAPTURE',
    appUrl,
    token: extensionSession.token,
    settings: {
      screenshotQuality: settings.screenshotQuality,
      defaultCollection: details.collection,
      autoAnalyzeScreenshots: settings.autoAnalyzeScreenshots,
      includeSourceUrl: settings.includeSourceUrl,
      includePageTitle: settings.includePageTitle,
    },
    page: {
      url: pageUrl,
      title: pageTitle,
    },
  };
  try {
    await sendTabMessage(activeTab.id, message);
    if (settings.autoClosePopup) window.close();
  } catch (_error) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['content/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content/content.js'] });
      await sendTabMessage(activeTab.id, message);
      if (settings.autoClosePopup) window.close();
    } catch {
      statusEl.textContent = 'Screen capture cannot run on this browser page.';
    }
  }
}

async function startSelectionCapture() {
  if (!extensionSession?.token) {
    statusEl.textContent = 'Sign in before capturing.';
    return;
  }
  if (!activeTab?.id || !/^https?:\/\//i.test(activeTab.url || '')) {
    statusEl.textContent = 'Selection capture works on normal web pages only.';
    return;
  }
  const appUrl = await getAppUrl();
  const details = captureDetails();
  const message = {
    type: 'ISCRAPER_START_SELECTION_CAPTURE',
    appUrl,
    token: extensionSession.token,
    settings: {
      defaultCollection: details.collection,
    },
    page: {
      url: settings.includeSourceUrl ? (activeTab.url || '') : '',
      title: settings.includePageTitle ? (pageMeta.title || activeTab.title || '') : '',
      note: details.note,
    },
  };
  setBusy(selectionCaptureEl, true, 'Starting...');
  try {
    await sendTabMessage(activeTab.id, message);
    statusEl.textContent = 'Select text or hover an image/video, then click the small save icon.';
    if (settings.autoClosePopup) window.close();
  } catch (_error) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['content/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content/content.js'] });
      await sendTabMessage(activeTab.id, message);
      if (settings.autoClosePopup) window.close();
    } catch {
      statusEl.textContent = 'Selection capture cannot run on this browser page.';
    }
  } finally {
    setBusy(selectionCaptureEl, false, 'Select Text or Media');
  }
}

async function openResearchDock() {
  if (!extensionSession?.token) {
    statusEl.textContent = 'Sign in before opening the research dock.';
    return;
  }
  try {
    await chrome.sidePanel.open({ windowId: activeTab?.windowId });
    window.close();
  } catch (_error) {
    statusEl.textContent = 'Open the IScraper side panel from Chrome, then try again.';
  }
}

async function openConnect() {
  const appUrl = await getAppUrl();
  const url = `${appUrl}/app?connectExtension=1&extensionId=${encodeURIComponent(chrome.runtime.id)}`;
  await chrome.tabs.create({ url });
  window.close();
}

async function init() {
  activeTab = await getActiveTab();
  settings = await getSettings();
  extensionSession = await getExtensionSession();
  if (activeTab?.id && /^https?:\/\//i.test(activeTab.url || '')) {
    pageMeta = await readPageMeta(activeTab.id).catch(() => ({}));
  }
  const platform = activeTab?.url && /^https?:\/\//i.test(activeTab.url) ? detectPlatform(activeTab.url) : '';
  titleEl.textContent = activeTab?.title ? `${platform ? `${platform}: ` : ''}${pageMeta.title || activeTab.title}` : 'No active tab found.';

  signedOutEl.hidden = Boolean(extensionSession?.token);
  actionsEl.hidden = !extensionSession?.token;
  accountEl.textContent = extensionSession?.email ? `Signed in as ${extensionSession.email}` : '';
  captureCollectionEl.value = settings.defaultCollection;

  if (extensionSession?.token && !defaultActionStarted && settings.defaultAction !== 'menu') {
    defaultActionStarted = true;
    window.setTimeout(() => {
      if (settings.defaultAction === 'capture-url') captureUrl();
      if (settings.defaultAction === 'screen-capture') startScreenCapture();
    }, 120);
  }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ext-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

captureUrlEl.addEventListener('click', captureUrl);
screenCaptureEl.addEventListener('click', startScreenCapture);
selectionCaptureEl.addEventListener('click', startSelectionCapture);
researchDockEl.addEventListener('click', openResearchDock);
connectEl.addEventListener('click', openConnect);
undoUrlEl.addEventListener('click', undoUrlCapture);
settingsEl.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init().catch((error) => {
  statusEl.textContent = error.message || 'Could not read current tab.';
});
