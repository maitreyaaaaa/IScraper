const DEFAULT_APP_URL = 'https://iscraper.vercel.app';
const DEFAULT_COLLECTION = 'Browser captures';

const signedOutEl = document.getElementById('signed-out');
const dockEl = document.getElementById('dock');
const connectEl = document.getElementById('connect');
const refreshEl = document.getElementById('refresh');
const searchFormEl = document.getElementById('search-form');
const searchEl = document.getElementById('search');
const saveUrlEl = document.getElementById('save-url');
const saveNoteEl = document.getElementById('save-note');
const saveLinkEl = document.getElementById('save-link');
const dropZoneEl = document.getElementById('drop-zone');
const resultsEl = document.getElementById('results');
const resultsTitleEl = document.getElementById('results-title');
const countEl = document.getElementById('count');
const statusEl = document.getElementById('status');

let appUrl = DEFAULT_APP_URL;
let session = null;
let settings = { defaultCollection: DEFAULT_COLLECTION };

async function getAppUrl() {
  const stored = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL });
  const value = String(stored.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
  return /^https:\/\//i.test(value) ? value : DEFAULT_APP_URL;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get({ defaultCollection: DEFAULT_COLLECTION });
  return {
    defaultCollection: String(stored.defaultCollection || DEFAULT_COLLECTION).trim().slice(0, 80) || DEFAULT_COLLECTION,
  };
}

async function getExtensionSession() {
  const stored = await chrome.storage.local.get({
    extensionToken: '',
    extensionUserEmail: '',
  });
  const token = String(stored.extensionToken || '').trim();
  if (!token) return null;
  return {
    token,
    email: String(stored.extensionUserEmail || ''),
  };
}

async function apiGet(path) {
  const response = await fetch(`${appUrl}${path}`, {
    headers: {
      'X-IScraper-Extension-Token': session.token,
      'X-IScraper-Client-Action': 'extension:side_panel',
      'X-Request-ID': createRequestId(),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `IScraper request failed: ${response.status}`);
  return body;
}

async function loadRecent() {
  if (!session?.token) return;
  setStatus('Loading recent saves...');
  const body = await apiGet('/api/extension/library/recent?limit=8');
  resultsTitleEl.textContent = 'Recent saves';
  renderResults(body.items || []);
  setStatus('');
}

async function runSearch(query) {
  if (!session?.token) return;
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    await loadRecent();
    return;
  }
  setStatus('Searching library...');
  const body = await apiGet(`/api/extension/library/search?q=${encodeURIComponent(cleanQuery)}&limit=8`);
  resultsTitleEl.textContent = 'Search results';
  renderResults(body.items || []);
  setStatus('');
}

function renderResults(items) {
  countEl.textContent = items.length ? `${items.length}` : '';
  resultsEl.replaceChildren(...items.map(resultCard));
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No saves found.';
    resultsEl.appendChild(empty);
  }
}

function resultCard(item) {
  const card = document.createElement('article');
  card.className = 'result-card';

  const title = document.createElement('div');
  title.className = 'result-title';
  title.textContent = item.title || 'Saved item';

  const description = document.createElement('p');
  description.className = 'muted';
  description.textContent = compact(item.description || item.matchReason || '', 140);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  [item.platform, item.collection, item.status].filter(Boolean).slice(0, 3).forEach((value) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = value;
    meta.appendChild(chip);
  });

  const actions = document.createElement('div');
  actions.className = 'result-actions';
  const openApp = document.createElement('button');
  openApp.type = 'button';
  openApp.textContent = 'Open Item';
  openApp.addEventListener('click', () => openUrl(`${appUrl}/app?item=${encodeURIComponent(item.id)}`));
  const openSource = document.createElement('button');
  openSource.type = 'button';
  openSource.className = 'secondary';
  openSource.textContent = 'Source';
  openSource.disabled = !/^https?:\/\//i.test(item.url || '');
  openSource.addEventListener('click', () => openUrl(item.url));
  actions.append(openApp, openSource);

  card.append(title, description, meta, actions);
  return card;
}

async function saveLink() {
  const url = String(saveUrlEl.value || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    setStatus('Add a normal web link first.');
    return;
  }
  saveLinkEl.disabled = true;
  setStatus('Saving link...');
  try {
    const response = await sendRuntimeMessage({
      type: 'ISCRAPER_SAVE_URL',
      payload: {
        appUrl,
        token: session.token,
        body: {
          url,
          title: url,
          note: String(saveNoteEl.value || '').trim().slice(0, 500),
          collection: settings.defaultCollection,
          source: 'extension-side-panel',
          clientActionId: createRequestId(),
        },
      },
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not save this link.');
    saveUrlEl.value = '';
    saveNoteEl.value = '';
    setStatus('Link saved.');
    await loadRecent();
  } catch (error) {
    setStatus(error.message || 'Could not save this link.');
  } finally {
    saveLinkEl.disabled = false;
  }
}

async function openConnect() {
  const url = `${appUrl}/app?connectExtension=1&extensionId=${encodeURIComponent(chrome.runtime.id)}`;
  await chrome.tabs.create({ url });
}

function openUrl(url) {
  if (!/^https?:\/\//i.test(url || '')) return;
  chrome.tabs.create({ url });
}

function setStatus(message) {
  statusEl.textContent = message || '';
}

function compact(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `dock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function linkFromDrop(event) {
  const uri = event.dataTransfer?.getData('text/uri-list') || '';
  const text = event.dataTransfer?.getData('text/plain') || '';
  const candidate = [uri, text].join('\n').match(/https?:\/\/[^\s]+/i)?.[0] || '';
  return candidate.replace(/[),.;]+$/, '');
}

async function init() {
  appUrl = await getAppUrl();
  settings = await getSettings();
  session = await getExtensionSession();
  signedOutEl.hidden = Boolean(session?.token);
  dockEl.hidden = !session?.token;
  if (session?.token) await loadRecent();
}

connectEl.addEventListener('click', openConnect);
refreshEl.addEventListener('click', () => (searchEl.value ? runSearch(searchEl.value) : loadRecent()));
searchFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(searchEl.value).catch((error) => setStatus(error.message));
});
saveLinkEl.addEventListener('click', saveLink);
dropZoneEl.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZoneEl.classList.add('dragging');
});
dropZoneEl.addEventListener('dragleave', () => {
  dropZoneEl.classList.remove('dragging');
});
dropZoneEl.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZoneEl.classList.remove('dragging');
  const url = linkFromDrop(event);
  if (url) saveUrlEl.value = url;
});

init().catch((error) => setStatus(error.message || 'Could not load research dock.'));
