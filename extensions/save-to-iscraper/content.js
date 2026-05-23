(() => {
  if (window.__iscraperLensLoaded) return;
  window.__iscraperLensLoaded = true;

  let session = null;
  let root = null;
  let startPoint = null;
  let box = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ISCRAPER_START_LENS') return false;
    startLens(message);
    sendResponse({ ok: true });
    return false;
  });

  async function startLens({ appUrl, lensToken }) {
    session = { appUrl, lensToken };
    const selected = String(window.getSelection()?.toString() || '').trim();
    if (selected.length >= 2) {
      showPanel('Searching selected text...', 'Text Lens');
      await searchLens({ type: 'text', query: selected.slice(0, 240) });
      return;
    }
    createCropOverlay();
  }

  function ensureRoot() {
    if (root) root.remove();
    root = document.createElement('div');
    root.id = 'iscraper-lens-root';
    document.documentElement.appendChild(root);
    return root;
  }

  function createCropOverlay() {
    const container = ensureRoot();
    const shade = document.createElement('div');
    shade.className = 'iscraper-lens-shade';
    shade.title = 'Drag around text or an object to search your IScraper brain.';
    container.appendChild(shade);
    showPanel('Drag around text or an object. Release to search your brain.', 'Crop Lens', false);

    shade.addEventListener('pointerdown', (event) => {
      startPoint = { x: event.clientX, y: event.clientY };
      box = document.createElement('div');
      box.className = 'iscraper-lens-box';
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
        showPanel('Select a larger area to search.', 'Crop Lens');
        return;
      }
      showPanel('Reading selected area...', 'Crop Lens');
      const crop = await captureCrop(rect);
      await searchLens({ type: 'image', imageDataUrl: crop });
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
    const response = await chrome.runtime.sendMessage({ type: 'ISCRAPER_CAPTURE_VISIBLE_TAB' });
    if (!response?.ok) throw new Error(response?.error || 'Could not capture this page.');
    const image = await loadImage(response.dataUrl);
    const scaleX = image.width / window.innerWidth;
    const scaleY = image.height / window.innerHeight;
    const canvas = document.createElement('canvas');
    const maxWidth = 900;
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

  async function searchLens(body) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ISCRAPER_LENS_SEARCH',
        payload: {
          appUrl: session.appUrl,
          lensToken: session.lensToken,
          requestId: createRequestId(),
          body,
        },
      });
      if (!response?.ok) {
        const error = new Error(response?.error || 'Lens search failed.');
        error.requestId = response?.requestId || '';
        throw error;
      }
      renderResults(response.body);
    } catch (error) {
      showPanel(lensErrorMessage(error), 'Lens error');
    }
  }

  function showPanel(message, title = 'IScraper Lens', includeOpen = true) {
    const container = root || ensureRoot();
    const old = container.querySelector('.iscraper-lens-panel');
    if (old) old.remove();
    const panel = document.createElement('section');
    panel.className = 'iscraper-lens-panel';
    panel.innerHTML = `
      <header>
        <div>
          <div class="iscraper-lens-brand">IScraper</div>
          <strong>${escapeHtml(title)}</strong>
        </div>
        <button class="iscraper-lens-close" type="button">Close</button>
      </header>
      <div class="iscraper-lens-body">
        <p class="iscraper-lens-muted">${escapeHtml(message)}</p>
        ${includeOpen ? '<button class="iscraper-lens-open" type="button">Open full dashboard</button>' : ''}
      </div>
    `;
    container.appendChild(panel);
    panel.querySelector('.iscraper-lens-close').addEventListener('click', closeLens);
    panel.querySelector('.iscraper-lens-open')?.addEventListener('click', () => openApp('/#app'));
  }

  function renderResults(body) {
    const results = body.results || [];
    const summary = body.type === 'image'
      ? body.imageAnalysis?.visualDescription || body.imageAnalysis?.ocrText || body.query
      : body.query;
    const container = root || ensureRoot();
    const panel = container.querySelector('.iscraper-lens-panel');
    if (!panel) showPanel('', 'Lens results');
    const target = container.querySelector('.iscraper-lens-panel .iscraper-lens-body');
    target.innerHTML = `
      <p class="iscraper-lens-muted">${escapeHtml(summary || 'Search complete.')}</p>
      ${results.length ? results.map(resultHtml).join('') : '<p class="iscraper-lens-muted">No matching saves yet.</p>'}
      <button class="iscraper-lens-open" type="button">Open full dashboard</button>
    `;
    target.querySelector('.iscraper-lens-open').addEventListener('click', () => openApp('/#app'));
    target.querySelectorAll('[data-open-url]').forEach((button) => {
      button.addEventListener('click', () => openApp(`/#app?item=${encodeURIComponent(button.dataset.openUrl)}`));
    });
  }

  function resultHtml(result) {
    const thumb = result.thumbnailUrl
      ? `<img class="iscraper-lens-thumb" src="${escapeAttribute(result.thumbnailUrl)}" alt="">`
      : '<div class="iscraper-lens-thumb"></div>';
    return `
      <article class="iscraper-lens-result">
        ${thumb}
        <div>
          <div class="iscraper-lens-meta">${escapeHtml(result.platform || 'Web')}</div>
          <h3 class="iscraper-lens-title">${escapeHtml(result.sourceTitle || 'Saved item')}</h3>
          <p class="iscraper-lens-summary">${escapeHtml(result.summary || result.sourceDescription || '')}</p>
          <button class="iscraper-lens-open" type="button" data-open-url="${escapeAttribute(result.id)}">Open in IScraper</button>
        </div>
      </article>
    `;
  }

  function openApp(path) {
    chrome.runtime.sendMessage({ type: 'ISCRAPER_OPEN_TAB', url: `${session.appUrl}${path}` });
  }

  function closeLens() {
    root?.remove();
    root = null;
    startPoint = null;
    box = null;
  }

  function createRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `ext-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function lensErrorMessage(error) {
    const message = error.message || 'Lens search failed.';
    if (!error.requestId || /Reference ID:/i.test(message)) return message;
    return `${message} Reference ID: ${error.requestId}`;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[char]));
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }
})();
