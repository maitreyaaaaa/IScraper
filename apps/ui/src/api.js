const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';
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

export function getItem(id) {
  return request(`/items/${id}`);
}

export function importInstagramExport({ files, mode, confirmEmail }) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('exportFiles', file);
  }
  formData.append('mode', mode);
  formData.append('confirmEmail', confirmEmail || '');

  return request('/imports', {
    method: 'POST',
    body: formData,
  });
}

export function processImport(importId) {
  return request(`/imports/${importId}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ download: true }),
  });
}

export function searchItems(query, filters = {}) {
  return request('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, filters }),
  });
}
