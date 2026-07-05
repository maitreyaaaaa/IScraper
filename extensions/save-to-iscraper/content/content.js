(() => {
  if (window.__iscraperCaptureLoaded) return;
  window.__iscraperCaptureLoaded = true;

  const DEFAULT_APP_URL = 'https://iscraper.vercel.app';
  const DEFAULT_SETTINGS = {
    defaultCollection: 'Browser captures',
    alwaysShowCaptureIcon: true,
    includeSourceUrl: true,
    includePageTitle: true,
  };

  let session = null;
  let root = null;
  let quickRoot = null;
  let quickSession = null;
  let quickTarget = null;
  let quickTimer = null;
  let quickMode = '';
  let quickListenersAttached = false;
  let passiveEnabled = false;
  let startPoint = null;
  let box = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ISCRAPER_START_SELECTION_CAPTURE') {
      startSelectionCapture(message);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type !== 'ISCRAPER_START_SCREEN_CAPTURE') return false;
    startCapture(message);
    sendResponse({ ok: true });
    return false;
  });

  initPersistentCapture();

  function startCapture(message) {
    session = {
      appUrl: message.appUrl,
      token: message.token,
      page: message.page || {},
      settings: {
        screenshotQuality: message.settings?.screenshotQuality === 'high' ? 'high' : 'balanced',
        defaultCollection: String(message.settings?.defaultCollection || 'Browser captures').trim().slice(0, 80) || 'Browser captures',
        autoAnalyzeScreenshots: message.settings?.autoAnalyzeScreenshots !== false,
      },
    };
    createCropOverlay();
  }

  function startSelectionCapture(message) {
    stopSelectionCapture({ restartPassive: false });
    quickMode = 'manual';
    quickSession = {
      appUrl: message.appUrl,
      token: message.token,
      page: message.page || {},
      settings: {
        defaultCollection: String(message.settings?.defaultCollection || 'Browser captures').trim().slice(0, 80) || 'Browser captures',
      },
    };
    ensureQuickRoot();
    showQuickPanel();
    attachQuickListeners();
    if (quickTimer) window.clearTimeout(quickTimer);
    quickTimer = window.setTimeout(stopSelectionCapture, 120000);
  }

  async function initPersistentCapture() {
    await refreshPersistentCaptureState();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!['sync', 'local'].includes(area)) return;
      if (
        changes.alwaysShowCaptureIcon
        || changes.defaultCollection
        || changes.appUrl
        || changes.extensionToken
        || changes.extensionUserEmail
      ) {
        refreshPersistentCaptureState();
      }
    });
  }

  async function refreshPersistentCaptureState() {
    const settings = await getStoredSettings();
    const hasSession = Boolean(await getStoredSession());
    passiveEnabled = settings.alwaysShowCaptureIcon !== false && hasSession && /^https?:\/\//i.test(window.location.href);
    if (passiveEnabled) {
      if (quickMode !== 'manual') await startPersistentCapture();
      checkSavedPageStatus();
    } else if (quickMode === 'passive') {
      stopSelectionCapture({ restartPassive: false });
    } else {
      checkSavedPageStatus();
    }
  }

  async function startPersistentCapture() {
    stopSelectionCapture({ restartPassive: false });
    quickMode = 'passive';
    quickSession = await buildStoredQuickSession();
    if (!quickSession) return;
    ensureQuickRoot();
    attachQuickListeners();
  }

  function attachQuickListeners() {
    if (quickListenersAttached) return;
    document.addEventListener('mouseup', handleSelectionMouseup, true);
    document.addEventListener('keyup', handleSelectionMouseup, true);
    document.addEventListener('mouseover', handleMediaHover, true);
    document.addEventListener('scroll', removeQuickButton, true);
    quickListenersAttached = true;
  }

  function ensureRoot() {
    if (root) root.remove();
    root = document.createElement('div');
    root.id = 'iscraper-capture-root';
    document.documentElement.appendChild(root);
    return root;
  }

  function ensureQuickRoot() {
    if (quickRoot) quickRoot.remove();
    quickRoot = document.createElement('div');
    quickRoot.id = 'iscraper-quick-capture-root';
    document.documentElement.appendChild(quickRoot);
    return quickRoot;
  }

  function createCropOverlay() {
    const container = ensureRoot();
    const shade = document.createElement('div');
    shade.className = 'iscraper-capture-shade';
    shade.title = 'Drag to capture a screenshot area.';
    container.appendChild(shade);
    showPanel('Drag over the area you want to save.', 'Screen Capture');

    shade.addEventListener('pointerdown', (event) => {
      startPoint = { x: event.clientX, y: event.clientY };
      box = document.createElement('div');
      box.className = 'iscraper-capture-box';
      container.appendChild(box);
      updateBox(event.clientX, event.clientY);
      shade.setPointerCapture(event.pointerId);
    });

    shade.addEventListener('pointermove', (event) => {
      if (!startPoint || !box) return;
      updateBox(event.clientX, event.clientY);
    });

    shade.addEventListener('pointerup', (event) => {
      if (!startPoint || !box) return;
      const rect = normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY);
      startPoint = null;
      if (rect.width < 20 || rect.height < 20) {
        showPanel('Select a larger area to save.', 'Screen Capture');
        return;
      }
      const captureSession = {
        appUrl: session.appUrl,
        token: session.token,
        page: { ...session.page },
        settings: { ...session.settings },
      };
      closeCapture();
      window.setTimeout(() => saveSelectedArea(rect, captureSession), 0);
    });
  }

  async function saveSelectedArea(rect, captureSession) {
    try {
      await waitForOverlayRemoval();
      const crop = await captureCrop(rect);
      const response = await sendRuntimeMessage({
        type: 'ISCRAPER_SAVE_SCREENSHOT',
        payload: {
          appUrl: captureSession.appUrl,
          token: captureSession.token,
          imageDataUrl: crop,
          title: captureSession.page.title ? `Screen capture - ${captureSession.page.title}` : 'Screen capture',
          sourceTitle: captureSession.page.title || '',
          sourceUrl: captureSession.page.url || '',
          collection: captureSession.settings.defaultCollection,
          autoAnalyze: captureSession.settings.autoAnalyzeScreenshots,
          requestId: createRequestId(),
        },
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not save screenshot.');
      const itemId = response.body?.item?.id || '';
      showUndoToast({ itemId, captureSession });
    } catch (error) {
      showStatusToast(error.message || 'Could not save screenshot.');
    }
  }

  function showQuickPanel() {
    const container = quickRoot || ensureQuickRoot();
    const panel = document.createElement('section');
    panel.className = 'iscraper-quick-panel';
    const text = document.createElement('p');
    text.textContent = 'Select text or hover an image/video.';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Done';
    close.addEventListener('click', stopSelectionCapture);
    panel.append(text, close);
    container.appendChild(panel);
  }

  function handleSelectionMouseup() {
    window.setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = String(selection?.toString() || '').replace(/\s+/g, ' ').trim();
      if (!selectedText || selectedText.length < 3 || !selection.rangeCount) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      quickTarget = {
        kind: 'text',
        text: selectedText.slice(0, 1800),
      };
      showQuickButton({
        left: Math.min(window.innerWidth - 46, Math.max(8, rect.right + 8)),
        top: Math.min(window.innerHeight - 46, Math.max(8, rect.bottom + 8)),
        label: 'Save selected text',
      });
    }, 0);
  }

  function handleMediaHover(event) {
    const media = event.target?.closest?.('img, video');
    if (!media || quickRoot?.contains(media)) return;
    const rect = media.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const mediaUrl = media.currentSrc || media.src || media.poster || '';
    if (!mediaUrl) return;
    quickTarget = {
      kind: media.tagName.toLowerCase() === 'video' ? 'video' : 'image',
      mediaUrl,
      mediaAlt: media.alt || media.getAttribute('aria-label') || '',
    };
    showQuickButton({
      left: Math.min(window.innerWidth - 44, Math.max(8, rect.right - 22)),
      top: Math.min(window.innerHeight - 44, Math.max(8, rect.top - 22)),
      label: `Save ${quickTarget.kind}`,
    });
  }

  function showQuickButton({ left, top, label }) {
    const container = quickRoot || ensureQuickRoot();
    removeQuickButton();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'iscraper-quick-button';
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = '+';
    button.addEventListener('click', saveQuickTarget);
    container.appendChild(button);
  }

  function removeQuickButton() {
    quickRoot?.querySelector('.iscraper-quick-button')?.remove();
  }

  async function saveQuickTarget() {
    if (!quickTarget) return;
    if (!quickSession) quickSession = await buildStoredQuickSession();
    if (!quickSession) {
      showStatusToast('Sign in to IScraper before saving from this page.');
      return;
    }
    const target = { ...quickTarget };
    removeQuickButton();
    try {
      const response = await sendRuntimeMessage({
        type: 'ISCRAPER_SAVE_SELECTION',
        payload: {
          appUrl: quickSession.appUrl,
          token: quickSession.token,
          kind: target.kind,
          text: target.text || '',
          mediaUrl: target.mediaUrl || '',
          mediaAlt: target.mediaAlt || '',
          sourceTitle: quickSession.page.title || document.title || '',
          sourceUrl: quickSession.page.url || window.location.href,
          note: quickSession.page.note || '',
          collection: quickSession.settings.defaultCollection,
          requestId: createRequestId(),
        },
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not save this selection.');
      showUndoToast({
        itemId: response.body?.item?.id || '',
        captureSession: quickSession,
        message: target.kind === 'text' ? 'Text saved to library.' : 'Media reference saved to library.',
      });
    } catch (error) {
      showStatusToast(error.message || 'Could not save this selection.');
    }
  }


  function updateBox(x, y) {
    const rect = normalizeRect(startPoint.x, startPoint.y, x, y);
    Object.assign(box.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  function normalizeRect(x1, y1, x2, y2) {
    const left = Math.max(0, Math.min(x1, x2));
    const top = Math.max(0, Math.min(y1, y2));
    const right = Math.min(window.innerWidth, Math.max(x1, x2));
    const bottom = Math.min(window.innerHeight, Math.max(y1, y2));
    return { left, top, width: right - left, height: bottom - top };
  }

  async function captureCrop(rect) {
    const response = await sendRuntimeMessage({ type: 'ISCRAPER_CAPTURE_VISIBLE_TAB' });
    if (!response?.ok) throw new Error(response?.error || 'Could not capture this page.');
    const image = await loadImage(response.dataUrl);
    const scaleX = image.width / window.innerWidth;
    const scaleY = image.height / window.innerHeight;
    const canvas = document.createElement('canvas');
    const maxWidth = 1200;
    const qualityMaxWidth = session?.settings?.screenshotQuality === 'high' ? 2000 : maxWidth;
    const outputScale = Math.min(1, qualityMaxWidth / Math.max(rect.width * scaleX, 1));
    canvas.width = Math.max(1, Math.round(rect.width * scaleX * outputScale));
    canvas.height = Math.max(1, Math.round(rect.height * scaleY * outputScale));
    const context = canvas.getContext('2d');
    context.drawImage(
      image,
      rect.left * scaleX,
      rect.top * scaleY,
      rect.width * scaleX,
      rect.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL('image/png');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read screenshot.'));
      image.src = src;
    });
  }

  function showPanel(message, title = 'IScraper') {
    const container = root || ensureRoot();
    const old = container.querySelector('.iscraper-capture-panel');
    if (old) old.remove();
    const panel = document.createElement('section');
    panel.className = 'iscraper-capture-panel';

    const header = document.createElement('header');
    const titleWrap = document.createElement('div');
    const brand = document.createElement('img');
    brand.className = 'iscraper-capture-logo';
    brand.src = chrome.runtime.getURL('icons/logo.png');
    brand.alt = 'IScraper';
    const strong = document.createElement('strong');
    strong.textContent = title;
    titleWrap.append(brand, strong);

    const closeButton = document.createElement('button');
    closeButton.className = 'iscraper-capture-close';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', closeCapture);
    header.append(titleWrap, closeButton);

    const body = document.createElement('div');
    body.className = 'iscraper-capture-body';
    const text = document.createElement('p');
    text.className = 'iscraper-capture-muted';
    text.textContent = message || '';
    body.appendChild(text);

    panel.append(header, body);
    container.appendChild(panel);
  }

  function showUndoToast({ itemId, captureSession, message = 'Image saved to library.' }) {
    document.getElementById('iscraper-capture-toast-root')?.remove();
    const toastRoot = document.createElement('div');
    toastRoot.id = 'iscraper-capture-toast-root';
    const toast = document.createElement('section');
    toast.className = 'iscraper-capture-toast';

    const text = document.createElement('p');
    text.textContent = message;

    const undo = document.createElement('button');
    undo.type = 'button';
    undo.textContent = 'Undo';
    undo.disabled = !itemId;

    let dismissed = false;
    const timeout = window.setTimeout(() => dismiss(), 5000);
    undo.addEventListener('click', async () => {
      if (dismissed || !itemId) return;
      undo.disabled = true;
      undo.textContent = 'Undoing...';
      const response = await sendRuntimeMessage({
        type: 'ISCRAPER_DELETE_CAPTURE',
        payload: {
          appUrl: captureSession.appUrl,
          token: captureSession.token,
          itemId,
          requestId: createRequestId(),
        },
      });
      if (!response?.ok) {
        undo.textContent = 'Failed';
        return;
      }
      clearTimeout(timeout);
      text.textContent = 'Image upload undone.';
      window.setTimeout(() => dismiss(), 1000);
    });

    toast.append(text, undo);
    toastRoot.appendChild(toast);
    document.documentElement.appendChild(toastRoot);

    function dismiss() {
      dismissed = true;
      toastRoot.remove();
    }
  }

  function showStatusToast(message) {
    document.getElementById('iscraper-capture-toast-root')?.remove();
    const toastRoot = document.createElement('div');
    toastRoot.id = 'iscraper-capture-toast-root';
    const toast = document.createElement('section');
    toast.className = 'iscraper-capture-toast';
    const text = document.createElement('p');
    text.textContent = message;
    toast.appendChild(text);
    toastRoot.appendChild(toast);
    document.documentElement.appendChild(toastRoot);
    window.setTimeout(() => toastRoot.remove(), 4000);
  }

  function closeCapture() {
    root?.remove();
    root = null;
    startPoint = null;
    box = null;
  }

  function stopSelectionCapture({ restartPassive = true } = {}) {
    if (quickListenersAttached) {
      document.removeEventListener('mouseup', handleSelectionMouseup, true);
      document.removeEventListener('keyup', handleSelectionMouseup, true);
      document.removeEventListener('mouseover', handleMediaHover, true);
      document.removeEventListener('scroll', removeQuickButton, true);
      quickListenersAttached = false;
    }
    if (quickTimer) window.clearTimeout(quickTimer);
    quickTimer = null;
    quickTarget = null;
    quickSession = null;
    quickRoot?.remove();
    quickRoot = null;
    const stoppedMode = quickMode;
    quickMode = '';
    if (restartPassive && passiveEnabled && stoppedMode === 'manual') {
      startPersistentCapture();
    }
  }

  async function checkSavedPageStatus() {
    if (!/^https?:\/\//i.test(window.location.href)) return;
    const response = await sendRuntimeMessage({
      type: 'ISCRAPER_CHECK_SAVED_PAGE',
      payload: { url: window.location.href },
    }).catch(() => null);
    if (response?.saved) showSavedPill(response.item);
  }

  function showSavedPill(item) {
    document.getElementById('iscraper-saved-page-pill')?.remove();
    const pill = document.createElement('button');
    pill.id = 'iscraper-saved-page-pill';
    pill.type = 'button';
    pill.textContent = 'Saved in IScraper';
    pill.title = item?.title || 'Saved in IScraper';
    pill.addEventListener('click', () => pill.remove());
    document.documentElement.appendChild(pill);
    window.setTimeout(() => pill.remove(), 3200);
  }

  async function buildStoredQuickSession() {
    const [settings, sessionState] = await Promise.all([getStoredSettings(), getStoredSession()]);
    if (!sessionState?.token) return null;
    return {
      appUrl: settings.appUrl,
      token: sessionState.token,
      page: {
        url: settings.includeSourceUrl === false ? '' : window.location.href,
        title: settings.includePageTitle === false ? '' : document.title,
        note: '',
      },
      settings: {
        defaultCollection: settings.defaultCollection,
      },
    };
  }

  async function getStoredSettings() {
    const stored = await chrome.storage.sync.get({
      appUrl: DEFAULT_APP_URL,
      ...DEFAULT_SETTINGS,
    });
    const appUrl = String(stored.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      appUrl: /^https:\/\//i.test(appUrl) ? appUrl : DEFAULT_APP_URL,
      defaultCollection: String(stored.defaultCollection || DEFAULT_SETTINGS.defaultCollection).trim().slice(0, 80) || DEFAULT_SETTINGS.defaultCollection,
      alwaysShowCaptureIcon: stored.alwaysShowCaptureIcon !== false,
      includeSourceUrl: stored.includeSourceUrl !== false,
      includePageTitle: stored.includePageTitle !== false,
    };
  }

  async function getStoredSession() {
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

  function waitForOverlayRemoval() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.setTimeout(resolve, 80);
        });
      });
    });
  }
})();
