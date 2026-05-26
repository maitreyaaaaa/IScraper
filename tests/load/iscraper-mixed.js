import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const failureRate = new Rate('iscraper_failed_checks');
const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const userId = __ENV.USER_ID || `load-user-${__VU}`;
const userEmail = __ENV.USER_EMAIL || `${userId}@example.test`;
const token = __ENV.AUTH_TOKEN || '';
const adminKey = __ENV.ADMIN_API_KEY || '';

export const options = {
  scenarios: {
    browse_reads: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.BROWSE_RATE || 20),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: Number(__ENV.BROWSE_VUS || 50),
      maxVUs: Number(__ENV.BROWSE_MAX_VUS || 200),
      exec: 'browseReads',
    },
    upload_imports: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.IMPORT_RATE || 2),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: Number(__ENV.IMPORT_VUS || 10),
      maxVUs: Number(__ENV.IMPORT_MAX_VUS || 50),
      exec: 'uploadImports',
    },
    search_chat: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.SEARCH_RATE || 5),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: Number(__ENV.SEARCH_VUS || 20),
      maxVUs: Number(__ENV.SEARCH_MAX_VUS || 100),
      exec: 'searchChat',
    },
    worker_status: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.WORKER_STATUS_RATE || 1),
      timeUnit: '5s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: 2,
      maxVUs: 10,
      exec: 'workerStatus',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    iscraper_failed_checks: ['rate<0.05'],
  },
};

function authHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-User-ID': userId,
    'X-User-Email': userEmail,
    ...extra,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function record(response, expectations) {
  const ok = check(response, expectations);
  failureRate.add(!ok);
  return ok;
}

export function browseReads() {
  group('browse library pages', () => {
    const response = http.get(`${baseUrl}/api/items?limit=24`, { headers: authHeaders() });
    record(response, {
      'browse returns 200 or bounded auth error': (res) => [200, 401, 423].includes(res.status),
      'browse is not overloaded': (res) => res.status !== 500,
    });
  });
  sleep(1);
}

export function uploadImports() {
  group('upload and queue import', () => {
    const html = `<main>
      <div class="_a6-g"><table>
        <tr><td colspan="2" class="_a6_q">URL<div><a href="https://www.instagram.com/p/LOAD${__VU}${__ITER}/">x</a></div></td></tr>
        <tr><td class="_a6_q">Caption</td><td class="_2piu _a6_r">Load test save ${__VU}-${__ITER}</td></tr>
      </table></div>
    </main>`;
    const form = {
      exportFiles: http.file(html, `load-${__VU}-${__ITER}.html`, 'text/html'),
    };
    const response = http.post(`${baseUrl}/api/imports`, form, {
      headers: token ? { Authorization: `Bearer ${token}` } : { 'X-User-ID': userId, 'X-User-Email': userEmail },
    });
    record(response, {
      'import is accepted, rejected by profile/auth, or throttled': (res) => [200, 400, 401, 403, 423, 429].includes(res.status),
      'import does not crash API': (res) => res.status < 500,
    });
  });
  sleep(2);
}

export function searchChat() {
  group('search and chat budget', () => {
    const search = http.post(`${baseUrl}/api/search`, JSON.stringify({ query: 'design inspiration', includeAi: false }), {
      headers: authHeaders(),
    });
    record(search, {
      'search is served or deliberately throttled': (res) => [200, 401, 423, 429].includes(res.status),
      'search does not crash API': (res) => res.status < 500,
    });
  });
  sleep(1);
}

export function workerStatus() {
  group('worker aggregate status', () => {
    const headers = adminKey ? { 'X-Admin-API-Key': adminKey } : {};
    const response = http.get(`${baseUrl}/api/admin/worker/status`, { headers });
    record(response, {
      'worker status is aggregate or locked': (res) => [200, 403, 503].includes(res.status),
      'worker status does not expose server errors': (res) => res.status < 500 || res.status === 503,
    });
  });
  sleep(5);
}
