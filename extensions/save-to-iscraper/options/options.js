const DEFAULT_APP_URL = 'https://iscraper.vercel.app';

const appUrlEl = document.getElementById('app-url');
const accountEl = document.getElementById('account');
const saveEl = document.getElementById('save');
const connectEl = document.getElementById('connect');
const disconnectEl = document.getElementById('disconnect');
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

async function saveSettings() {
  const appUrl = appUrlEl.value.trim().replace(/\/$/, '');

  if (!/^https:\/\//i.test(appUrl)) {
    statusEl.textContent = 'Use a full secure app URL starting with https://';
    return;
  }

  await chrome.storage.sync.set({ appUrl });
  statusEl.textContent = 'Settings saved.';
}

async function disconnect() {
  await chrome.storage.local.remove(['extensionToken', 'extensionTokenId', 'extensionUserEmail', 'lensToken']);
  await chrome.storage.sync.remove('lensToken');
  await renderConnection();
  statusEl.textContent = 'This browser is disconnected.';
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

async function init() {
  appUrlEl.value = await getAppUrl();
  await renderConnection();
}

saveEl.addEventListener('click', saveSettings);
connectEl.addEventListener('click', openConnect);
disconnectEl.addEventListener('click', disconnect);

init().catch((error) => {
  statusEl.textContent = error.message || 'Could not load settings.';
});
