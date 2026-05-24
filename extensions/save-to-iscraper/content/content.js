(() => {
  if (window.__iscraperCaptureLoaded) return;
  window.__iscraperCaptureLoaded = true;

  let session = null;
  let root = null;
  let startPoint = null;
  let box = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ISCRAPER_START_SCREEN_CAPTURE') return false;
    startCapture(message);
    sendResponse({ ok: true });
    return false;
  });

  function startCapture(message) {
    session = {
      appUrl: message.appUrl,
      token: message.token,
      page: message.page || {},
    };
    createCropOverlay();
  }

  function ensureRoot() {
    if (root) root.remove();
    root = document.createElement('div');
    root.id = 'iscraper-capture-root';
    document.documentElement.appendChild(root);
    return root;
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

    shade.addEventListener('pointerup', async (event) => {
      if (!startPoint || !box) return;
      const rect = normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY);
      startPoint = null;
      if (rect.width < 20 || rect.height < 20) {
        showPanel('Select a larger area to save.', 'Screen Capture');
        return;
      }
      showPanel('Saving selected area...', 'Screen Capture');
      try {
        const crop = await captureCrop(rect);
        const response = await sendRuntimeMessage({
          type: 'ISCRAPER_SAVE_SCREENSHOT',
          payload: {
            appUrl: session.appUrl,
            token: session.token,
            imageDataUrl: crop,
            title: `Screen capture - ${session.page.title || document.title || 'Current page'}`,
            sourceTitle: session.page.title || document.title || '',
            sourceUrl: session.page.url || window.location.href,
            requestId: createRequestId(),
          },
        });
        if (!response?.ok) throw new Error(response?.error || 'Could not save screenshot.');
        const itemId = response.body?.item?.id || '';
        root?.remove();
        root = null;
        showUndoToast({ itemId });
      } catch (error) {
        showPanel(error.message || 'Could not save screenshot.', 'Capture error');
      }
    });
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
    const outputScale = Math.min(1, maxWidth / Math.max(rect.width * scaleX, 1));
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
    const brand = document.createElement('div');
    brand.className = 'iscraper-capture-brand';
    brand.textContent = 'IScraper';
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

  function showUndoToast({ itemId }) {
    const toastRoot = document.createElement('div');
    toastRoot.id = 'iscraper-capture-toast-root';
    const toast = document.createElement('section');
    toast.className = 'iscraper-capture-toast';

    const text = document.createElement('p');
    text.textContent = 'Image saved to library.';

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
          appUrl: session.appUrl,
          token: session.token,
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

  function closeCapture() {
    root?.remove();
    root = null;
    startPoint = null;
    box = null;
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
})();
