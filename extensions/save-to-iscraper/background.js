chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ISCRAPER_LENS_SEARCH') {
    lensSearch(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Lens search failed.', requestId: error.requestId || message.payload?.requestId || '' }));
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
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function lensSearch(payload = {}) {
  const appUrl = String(payload.appUrl || '').replace(/\/$/, '');
  const token = String(payload.lensToken || '').trim();
  const requestId = payload.requestId || createRequestId();
  if (!safeHttpUrl(appUrl)) throw new Error('Set a valid IScraper app URL first.');
  if (!token) throw new Error('Connect your Lens token first.');

  const response = await fetch(`${appUrl}/api/lens/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'X-IScraper-Client-Action': 'extension:lens_search',
      'X-IScraper-Extension-Token': token,
    },
    body: JSON.stringify(payload.body || {}),
  });
  const responseRequestId = response.headers.get('x-request-id') || requestId;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Lens search failed: ${response.status}`);
    error.requestId = body.requestId || responseRequestId;
    throw error;
  }
  return { ok: true, body, requestId: responseRequestId };
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ext-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
