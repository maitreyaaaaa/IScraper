const DEFAULT_APP_URL = 'https://iscraper.vercel.app';
const DEFAULT_SETTINGS = {
  defaultAction: 'menu',
  screenshotQuality: 'balanced',
  autoClosePopup: true,
  defaultCollection: 'Browser captures',
  autoAnalyzeScreenshots: true,
  includeSourceUrl: true,
  includePageTitle: true,
};

const appUrlEl = document.getElementById('app-url');
const accountEl = document.getElementById('account');
const defaultActionEl = document.getElementById('default-action');
const screenshotQualityEl = document.getElementById('screenshot-quality');
const autoClosePopupEl = document.getElementById('auto-close-popup');
const defaultCollectionEl = document.getElementById('default-collection');
const autoAnalyzeScreenshotsEl = document.getElementById('auto-analyze-screenshots');
const includeSourceUrlEl = document.getElementById('include-source-url');
const includePageTitleEl = document.getElementById('include-page-title');
const versionEl = document.getElementById('version');
const lastRequestEl = document.getElementById('last-request');
const saveEl = document.getElementById('save');
const connectEl = document.getElementById('connect');
const disconnectEl = document.getElementById('disconnect');
const resetEl = document.getElementById('reset');
const statusEl = document.getElementById('status');

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
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

async function saveSettings() {
  const appUrl = appUrlEl.value.trim().replace(/\/$/, '');
  const defaultCollection = defaultCollectionEl.value.trim().replace(/\s+/g, ' ').slice(0, 80) || DEFAULT_SETTINGS.defaultCollection;

  if (!/^https:\/\//i.test(appUrl)) {
    statusEl.textContent = 'Use a full secure app URL starting with https://';
    return;
  }

  await chrome.storage.sync.set({
    appUrl,
    defaultAction: validChoice(defaultActionEl.value, ['menu', 'capture-url', 'screen-capture'], DEFAULT_SETTINGS.defaultAction),
    screenshotQuality: validChoice(screenshotQualityEl.value, ['balanced', 'high'], DEFAULT_SETTINGS.screenshotQuality),
    autoClosePopup: autoClosePopupEl.checked,
    defaultCollection,
    autoAnalyzeScreenshots: autoAnalyzeScreenshotsEl.checked,
    includeSourceUrl: includeSourceUrlEl.checked,
    includePageTitle: includePageTitleEl.checked,
  });
  defaultCollectionEl.value = defaultCollection;
  statusEl.textContent = 'Settings saved.';
}

async function disconnect() {
  await chrome.storage.local.remove(['extensionToken', 'extensionTokenId', 'extensionUserEmail', 'lensToken', 'lastRequest']);
  await chrome.storage.sync.remove('lensToken');
  await renderConnection();
  await renderTroubleshooting();
  statusEl.textContent = 'This browser is disconnected.';
}

async function resetSettings() {
  await chrome.storage.sync.set({ appUrl: DEFAULT_APP_URL, ...DEFAULT_SETTINGS });
  await chrome.storage.local.remove('lastRequest');
  await init();
  statusEl.textContent = 'Extension settings reset.';
}

async function openConnect() {
  const appUrl = await getAppUrl();
  await chrome.tabs.create({
    url: `${appUrl}/app?connectExtension=1&extensionId=${encodeURIComponent(chrome.runtime.id)}`,
  });
}

async function renderConnection() {
  const session = await getExtensionSession();
  accountEl.textContent = session?.email ? `Signed in as ${session.email}` : 'Not connected';
  disconnectEl.disabled = !session?.token;
}

async function renderSettings() {
  const settings = await getSettings();
  defaultActionEl.value = validChoice(settings.defaultAction, ['menu', 'capture-url', 'screen-capture'], DEFAULT_SETTINGS.defaultAction);
  screenshotQualityEl.value = validChoice(settings.screenshotQuality, ['balanced', 'high'], DEFAULT_SETTINGS.screenshotQuality);
  autoClosePopupEl.checked = settings.autoClosePopup !== false;
  defaultCollectionEl.value = String(settings.defaultCollection || DEFAULT_SETTINGS.defaultCollection);
  autoAnalyzeScreenshotsEl.checked = settings.autoAnalyzeScreenshots !== false;
  includeSourceUrlEl.checked = settings.includeSourceUrl !== false;
  includePageTitleEl.checked = settings.includePageTitle !== false;
}

async function renderTroubleshooting() {
  const manifest = chrome.runtime.getManifest();
  const stored = await chrome.storage.local.get({ lastRequest: null });
  versionEl.textContent = `Extension version ${manifest.version}`;
  if (!stored.lastRequest) {
    lastRequestEl.textContent = 'No extension requests yet.';
    return;
  }
  const last = stored.lastRequest;
  const result = last.ok ? 'OK' : 'Failed';
  const requestId = last.requestId ? ` Request ID: ${last.requestId}` : '';
  lastRequestEl.textContent = `${result} - ${last.action || 'request'} - ${last.time || 'recent'}.${requestId}`;
}

function validChoice(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

async function init() {
  appUrlEl.value = await getAppUrl();
  await renderSettings();
  await renderConnection();
  await renderTroubleshooting();
}

saveEl.addEventListener('click', saveSettings);
connectEl.addEventListener('click', openConnect);
disconnectEl.addEventListener('click', disconnect);
resetEl.addEventListener('click', resetSettings);

init().catch((error) => {
  statusEl.textContent = error.message || 'Could not load settings.';
});
