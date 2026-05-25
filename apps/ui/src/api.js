import { captureClientError, captureClientEvent } from './posthog'

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
let accessToken = '';

export class ApiError extends Error {
  constructor(message, { status, requestId, endpoint, action } = {}) {
    super(requestId ? `${message} Reference ID: ${requestId}` : message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId || '';
    this.endpoint = endpoint || '';
    this.action = action || '';
  }
}

export function setApiAccessToken(token) {
  accessToken = token || '';
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeAction(path, method) {
  return `${method.toLowerCase()}:${path.replace(/\/[a-zA-Z0-9_-]{8,}/g, '/:id')}`.slice(0, 80);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = String(options.method || 'GET').toUpperCase();
  const requestId = options.requestId || createRequestId();
  const action = options.action || safeAction(path, method);
  headers.set('X-Request-ID', requestId);
  headers.set('X-IScraper-Client-Action', action);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    const apiError = new ApiError('Network request failed.', { status: 0, requestId, endpoint: path, action });
    captureClientError(apiError, { requestId, endpoint: path, action, status: 0 });
    throw apiError;
  }
  const responseRequestId = response.headers.get('x-request-id') || requestId;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 413
      ? 'This file is too large. Upload files must be 20 MB or smaller.'
      : body.error || `Request failed: ${response.status}`;
    const apiError = new ApiError(message, {
      status: response.status,
      requestId: body.requestId || responseRequestId,
      endpoint: path,
      action,
    });
    captureClientError(apiError, { requestId: apiError.requestId, endpoint: path, action, status: response.status });
    throw apiError;
  }
  captureClientEvent('api request completed', { requestId: responseRequestId, endpoint: path, action, status: response.status });
  return body;
}

export function getItems(params = null) {
  if (!params) return request('/items');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '' || value === 'all') continue;
    query.set(key, String(value));
  }
  return request(`/items${query.toString() ? `?${query}` : ''}`);
}

export function getItemsPage(params = {}) {
  return getItems({ limit: 60, ...params });
}

export function getSmartCollections(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '' || value === false) continue;
    query.set(key, String(value));
  }
  return request(`/smart-collections${query.toString() ? `?${query}` : ''}`);
}

export function refreshSmartCollections() {
  return request('/smart-collections/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export function getSmartCollectionItems(id, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '' || value === 'all') continue;
    query.set(key, String(value));
  }
  return request(`/smart-collections/${id}/items${query.toString() ? `?${query}` : ''}`);
}

export function updateSmartCollection(id, payload) {
  return request(`/smart-collections/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function setSmartCollectionItemOverride(id, itemId, action) {
  return request(`/smart-collections/${id}/items/${itemId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

export function getPrivacyExportData() {
  return request('/privacy-export');
}

export function getAccountDeletion() {
  return request('/account/deletion');
}

export function requestAccountDeletion(payload) {
  return request('/account/deletion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function cancelAccountDeletion() {
  return request('/account/deletion/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export function getIndexingSummary() {
  return request('/indexing/summary');
}

export function getPublicFeedback() {
  return request('/feedback');
}

export function submitPublicFeedback(payload) {
  return request('/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getItem(id) {
  return request(`/items/${id}`);
}

export function updateReviewItem(id, payload) {
  return request(`/items/${id}/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function approveReviewItem(id, payload = {}) {
  return request(`/items/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getCredits() {
  return request('/credits');
}

export function getProfile() {
  return request('/profile');
}

export function recordSignInActivity() {
  return request('/activity/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export function saveProfile(payload) {
  return request('/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getKnowledgeGraph() {
  return request('/graph');
}

export async function downloadObsidianGraph() {
  const headers = new Headers();
  const requestId = createRequestId();
  const action = 'get:/graph/obsidian-export';
  headers.set('X-Request-ID', requestId);
  headers.set('X-IScraper-Client-Action', action);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE}/graph/obsidian-export`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const apiError = new ApiError(body.error || `Request failed: ${response.status}`, {
      status: response.status,
      requestId: body.requestId || response.headers.get('x-request-id') || requestId,
      endpoint: '/graph/obsidian-export',
      action,
    });
    captureClientError(apiError, { requestId: apiError.requestId, endpoint: '/graph/obsidian-export', action, status: response.status });
    throw apiError;
  }
  captureClientEvent('api request completed', { requestId: response.headers.get('x-request-id') || requestId, endpoint: '/graph/obsidian-export', action, status: response.status });
  return response.blob();
}

export function getCreditPackages() {
  return request('/credit-packages');
}

export function createCreditCheckout(packageId) {
  return request('/credits/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageId }),
  });
}

export function getProviderCredentials() {
  return request('/provider-credentials');
}

export function getExtensionTokens() {
  return request('/extension-tokens');
}

export function createExtensionToken(name = 'Browser extension') {
  return request('/extension-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function revokeExtensionToken(id) {
  return request(`/extension-tokens/${id}`, {
    method: 'DELETE',
  });
}

export function saveProviderCredential(payload) {
  return request('/provider-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteProviderCredential(id) {
  return request(`/provider-credentials/${id}`, {
    method: 'DELETE',
  });
}

export function testProviderCredential(id) {
  return request(`/provider-credentials/${id}/test`, {
    method: 'POST',
  });
}

export function revealProviderCredential(id) {
  return request(`/provider-credentials/${id}/reveal`, {
    method: 'POST',
  });
}

export function importInstagramExport({ files }) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('exportFiles', file);
  }

  return request('/imports', {
    method: 'POST',
    body: formData,
  });
}

export function importStoredExport({ files }) {
  return request('/imports/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
}

export function queueStorageImport({ files, sourceType = 'auto' }) {
  return request('/imports/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, sourceType }),
  });
}

export function createImportUploadUrls({ files }) {
  return request('/imports/upload-urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: files.map((file) => ({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
      })),
    }),
  });
}

export function uploadImportChunk({ path, chunk, index, totalChunks }) {
  const formData = new FormData();
  formData.append('path', path);
  formData.append('index', String(index));
  formData.append('totalChunks', String(totalChunks));
  formData.append('chunk', chunk, `chunk-${index}`);

  return request('/imports/upload-chunk', {
    method: 'POST',
    body: formData,
  });
}

export function startIndexing(payload = {}) {
  return request('/indexing/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ download: false, ...payload }),
  });
}

export function saveLink(payload) {
  return request('/saves/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function noteFormData(payload = {}) {
  const formData = new FormData();
  formData.append('title', payload.title || '');
  formData.append('body', payload.body || '');
  formData.append('links', JSON.stringify(payload.links || []));
  if (payload.removeAssetIds?.length) formData.append('removeAssetIds', payload.removeAssetIds.join(','));
  for (const image of payload.images || []) {
    formData.append('images', image);
  }
  return formData;
}

export function createNote(payload) {
  return request('/notes', {
    method: 'POST',
    body: noteFormData(payload),
  });
}

export function updateNote(id, payload) {
  return request(`/notes/${id}`, {
    method: 'PATCH',
    body: noteFormData(payload),
  });
}

export function deleteNote(id) {
  return request(`/notes/${id}`, {
    method: 'DELETE',
  });
}

export function enrichItem(id, payload = {}) {
  return request(`/items/${id}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function enrichIntentBatch(itemIds = []) {
  return request('/enrichment/intent-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds }),
  });
}

export function processImport(importId) {
  return request(`/imports/${importId}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ download: false }),
  });
}

export function restartQueue(importId = null) {
  return request('/jobs/restart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ importId, download: false }),
  });
}

export function searchItems(query, filters = {}, options = {}) {
  return request('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, filters, ...options }),
  });
}

export function submitSearchFeedback(payload) {
  return request('/search/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
