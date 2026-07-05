chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({
    appUrl: 'https://iscraper.vercel.app',
    defaultAction: 'menu',
    screenshotQuality: 'balanced',
    autoClosePopup: true,
    defaultCollection: 'Browser captures',
    autoAnalyzeScreenshots: true,
    includeSourceUrl: true,
    includePageTitle: true,
    alwaysShowCaptureIcon: true,
  }, (stored) => {
    const defaults = {};
    if (!stored.appUrl) {
      defaults.appUrl = 'https://iscraper.vercel.app';
    }
    if (!stored.defaultAction) defaults.defaultAction = 'menu';
    if (!stored.screenshotQuality) defaults.screenshotQuality = 'balanced';
    if (typeof stored.autoClosePopup !== 'boolean') defaults.autoClosePopup = true;
    if (!stored.defaultCollection) defaults.defaultCollection = 'Browser captures';
    if (typeof stored.autoAnalyzeScreenshots !== 'boolean') defaults.autoAnalyzeScreenshots = true;
    if (typeof stored.includeSourceUrl !== 'boolean') defaults.includeSourceUrl = true;
    if (typeof stored.includePageTitle !== 'boolean') defaults.includePageTitle = true;
    if (typeof stored.alwaysShowCaptureIcon !== 'boolean') defaults.alwaysShowCaptureIcon = true;
    if (Object.keys(defaults).length) chrome.storage.sync.set(defaults);
  });
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ISCRAPER_EXTENSION_CONNECTED') return false;
  const origin = safeOrigin(sender.origin || sender.url);
  if (origin !== 'https://iscraper.vercel.app') {
    sendResponse({ ok: false, error: 'This IScraper origin is not allowed.' });
    return false;
  }
  const payload = message.payload || {};
  const token = String(payload.token || '').trim();
  const appUrl = String(payload.appUrl || origin).replace(/\/$/, '');
  if (!token.startsWith('isx_') || safeHttpUrl(appUrl) !== `${origin}/`) {
    sendResponse({ ok: false, error: 'The extension connection payload is invalid.' });
    return false;
  }
  chrome.storage.sync.set({ appUrl }, () => {
    chrome.storage.local.set({
      extensionToken: token,
      extensionTokenId: String(payload.tokenId || ''),
      extensionUserEmail: String(payload.email || ''),
    }, () => {
      chrome.storage.local.remove('lensToken');
      chrome.storage.sync.remove('lensToken');
      sendResponse({ ok: true });
    });
  });
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ISCRAPER_SAVE_URL') {
    saveUrl(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not save this URL.', requestId: error.requestId || message.payload?.requestId || '' }));
    return true;
  }

  if (message?.type === 'ISCRAPER_SAVE_SCREENSHOT') {
    saveScreenshot(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not save this screenshot.', requestId: error.requestId || message.payload?.requestId || '' }));
    return true;
  }

  if (message?.type === 'ISCRAPER_SAVE_SELECTION') {
    saveSelection(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not save this selection.', requestId: error.requestId || message.payload?.requestId || '' }));
    return true;
  }

  if (message?.type === 'ISCRAPER_CHECK_SAVED_PAGE') {
    checkSavedPage(message.payload, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, saved: false, error: error.message || 'Could not check this page.' }));
    return true;
  }

  if (message?.type === 'ISCRAPER_DELETE_URL_CAPTURE') {
    deleteUrlCapture(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not undo this URL capture.', requestId: error.requestId || message.payload?.requestId || '' }));
    return true;
  }

  if (message?.type === 'ISCRAPER_DELETE_CAPTURE') {
    deleteCapture(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not undo this screenshot.', requestId: error.requestId || message.payload?.requestId || '' }));
    return true;
  }

  if (message?.type === 'ISCRAPER_CAPTURE_VISIBLE_TAB') {
    chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not capture this tab.' }));
    return true;
  }

  if (message?.type === 'ISCRAPER_OPEN_TAB') {
    const url = safeHttpUrl(message.url);
    if (!url) {
      sendResponse({ ok: false, error: 'Only normal web links can be opened.' });
      return false;
    }
    chrome.tabs.create({ url }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

async function saveUrl(payload = {}) {
  const appUrl = appBase(payload.appUrl);
  const token = extensionToken(payload.token);
  const requestId = payload.requestId || createRequestId();

  const response = await fetch(`${appUrl}/api/extension/saves/link`, {
    method: 'POST',
    headers: extensionHeaders({ token, requestId, contentType: 'application/json', action: 'extension:capture_url' }),
    body: JSON.stringify(payload.body || {}),
  });
  return responseBody(response, requestId);
}

async function saveScreenshot(payload = {}) {
  const appUrl = appBase(payload.appUrl);
  const token = extensionToken(payload.token);
  const requestId = payload.requestId || createRequestId();
  const file = dataUrlToBlob(payload.imageDataUrl);
  const formData = new FormData();
  formData.append('image', file, 'iscraper-capture.png');
  formData.append('title', String(payload.title || 'Screen capture').slice(0, 160));
  formData.append('sourceTitle', String(payload.sourceTitle || '').slice(0, 160));
  formData.append('sourceUrl', String(payload.sourceUrl || '').slice(0, 1000));
  formData.append('collection', String(payload.collection || 'Browser captures').slice(0, 80));
  formData.append('autoAnalyze', payload.autoAnalyze === false ? 'false' : 'true');

  const response = await fetch(`${appUrl}/api/extension/captures/screenshot`, {
    method: 'POST',
    headers: extensionHeaders({ token, requestId, action: 'extension:screen_capture' }),
    body: formData,
  });
  return responseBody(response, requestId);
}

async function saveSelection(payload = {}) {
  const appUrl = appBase(payload.appUrl);
  const token = extensionToken(payload.token);
  const requestId = payload.requestId || createRequestId();

  const response = await fetch(`${appUrl}/api/extension/captures/selection`, {
    method: 'POST',
    headers: extensionHeaders({ token, requestId, contentType: 'application/json', action: 'extension:selection_capture' }),
    body: JSON.stringify({
      kind: payload.kind,
      text: payload.text,
      mediaUrl: payload.mediaUrl,
      mediaAlt: payload.mediaAlt,
      sourceUrl: payload.sourceUrl,
      sourceTitle: payload.sourceTitle,
      note: payload.note,
      collection: payload.collection,
    }),
  });
  return responseBody(response, requestId);
}

async function deleteUrlCapture(payload = {}) {
  const appUrl = appBase(payload.appUrl);
  const token = extensionToken(payload.token);
  const requestId = payload.requestId || createRequestId();
  const itemId = encodeURIComponent(String(payload.itemId || ''));
  if (!itemId) throw new Error('Missing URL capture id.');

  const response = await fetch(`${appUrl}/api/extension/saves/${itemId}`, {
    method: 'DELETE',
    headers: extensionHeaders({ token, requestId, action: 'extension:undo_url' }),
  });
  return responseBody(response, requestId);
}

async function deleteCapture(payload = {}) {
  const appUrl = appBase(payload.appUrl);
  const token = extensionToken(payload.token);
  const requestId = payload.requestId || createRequestId();
  const itemId = encodeURIComponent(String(payload.itemId || ''));
  if (!itemId) throw new Error('Missing capture id.');

  const response = await fetch(`${appUrl}/api/extension/captures/${itemId}`, {
    method: 'DELETE',
    headers: extensionHeaders({ token, requestId, action: 'extension:undo_capture' }),
  });
  return responseBody(response, requestId);
}

async function checkSavedPage(payload = {}, sender = {}) {
  const url = safeHttpUrl(payload.url);
  const tabId = sender.tab?.id;
  if (!url) {
    if (tabId) await setSavedBadge(tabId, false);
    return { ok: true, saved: false };
  }
  const session = await storedExtensionSession();
  if (!session?.token) {
    if (tabId) await setSavedBadge(tabId, false);
    return { ok: true, saved: false };
  }
  const appUrl = await storedAppUrl();
  const requestId = createRequestId();
  const response = await fetch(`${appUrl}/api/extension/library/status?url=${encodeURIComponent(url)}`, {
    headers: extensionHeaders({ token: session.token, requestId, action: 'extension:page_status' }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `IScraper request failed: ${response.status}`);
  if (tabId) await setSavedBadge(tabId, Boolean(body.saved));
  return { ok: true, saved: Boolean(body.saved), item: body.item || null };
}

async function setSavedBadge(tabId, saved) {
  await chrome.action.setBadgeText({ tabId, text: saved ? 'SAVED' : '' });
  if (saved) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#9cff2e' });
    await chrome.action.setBadgeTextColor?.({ tabId, color: '#000000' });
  }
}

function extensionHeaders({ token, requestId, contentType, action }) {
  const headers = {
    'X-Request-ID': requestId,
    'X-IScraper-Client-Action': action,
    'X-IScraper-Extension-Token': token,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

async function storedAppUrl() {
  const stored = await chrome.storage.sync.get({ appUrl: 'https://iscraper.vercel.app' });
  const value = String(stored.appUrl || 'https://iscraper.vercel.app').replace(/\/$/, '');
  return safeHttpUrl(value) ? value : 'https://iscraper.vercel.app';
}

async function storedExtensionSession() {
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

async function responseBody(response, requestId) {
  const responseRequestId = response.headers.get('x-request-id') || requestId;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    await recordLastRequest({
      ok: false,
      action: response.url.includes('/captures/') ? 'screenshot capture' : 'URL capture',
      requestId: body.requestId || responseRequestId,
      error: body.error || `IScraper request failed: ${response.status}`,
    });
    const error = new Error(body.error || `IScraper request failed: ${response.status}`);
    error.requestId = body.requestId || responseRequestId;
    throw error;
  }
  await recordLastRequest({
    ok: true,
    action: response.url.includes('/captures/selection') ? 'selection capture' : response.url.includes('/captures/') ? 'screenshot capture' : response.url.includes('/saves/') ? 'URL capture' : 'request',
    requestId: responseRequestId,
  });
  return { ok: true, body, requestId: responseRequestId };
}

async function recordLastRequest(details) {
  await chrome.storage.local.set({
    lastRequest: {
      ...details,
      time: new Date().toISOString(),
    },
  });
}

function dataUrlToBlob(value) {
  const match = String(value || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Screenshot must be a PNG, JPEG, or WebP image.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
}

function appBase(value) {
  const appUrl = String(value || '').replace(/\/$/, '');
  if (!safeHttpUrl(appUrl)) throw new Error('Set a valid IScraper app URL first.');
  return appUrl;
}

function extensionToken(value) {
  const token = String(value || '').trim();
  if (!token) throw new Error('Sign in to IScraper before capturing.');
  return token;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function safeOrigin(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ext-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
