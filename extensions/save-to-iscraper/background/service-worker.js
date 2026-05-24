chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ appUrl: 'https://iscraper.vercel.app' }, (stored) => {
    if (!stored.appUrl) {
      chrome.storage.sync.set({ appUrl: 'https://iscraper.vercel.app' });
    }
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

  const response = await fetch(`${appUrl}/api/extension/captures/screenshot`, {
    method: 'POST',
    headers: extensionHeaders({ token, requestId, action: 'extension:screen_capture' }),
    body: formData,
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

function extensionHeaders({ token, requestId, contentType, action }) {
  const headers = {
    'X-Request-ID': requestId,
    'X-IScraper-Client-Action': action,
    'X-IScraper-Extension-Token': token,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

async function responseBody(response, requestId) {
  const responseRequestId = response.headers.get('x-request-id') || requestId;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `IScraper request failed: ${response.status}`);
    error.requestId = body.requestId || responseRequestId;
    throw error;
  }
  return { ok: true, body, requestId: responseRequestId };
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
