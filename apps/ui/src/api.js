const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
let accessToken = '';

export function setApiAccessToken(token) {
  accessToken = token || '';
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
}

export function getItems() {
  return request('/items');
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
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE}/graph/obsidian-export`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
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

export function importInstagramExport({ files, sourceType = 'auto' }) {
  const formData = new FormData();
  formData.append('sourceType', sourceType);
  for (const file of files) {
    formData.append('exportFiles', file, file.webkitRelativePath || file.name);
  }

  return request('/imports', {
    method: 'POST',
    body: formData,
  });
}

export function queueStorageImport({ files, sourceType = 'auto' }) {
  return request('/imports/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, sourceType }),
  });
}

export function saveLink(payload) {
  return request('/saves/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

export function searchItems(query, filters = {}) {
  return request('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, filters }),
  });
}
