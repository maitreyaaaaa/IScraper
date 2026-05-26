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
const profile = String(__ENV.LOAD_PROFILE || 'custom').toLowerCase();
const profileDefaults = {
  local: {
    duration: '20s',
    browseRate: 3,
    browseVus: 10,
    browseMaxVus: 30,
    importRate: 1,
    importVus: 5,
    importMaxVus: 15,
    searchRate: 2,
    searchVus: 8,
    searchMaxVus: 25,
    workerStatusRate: 1,
    healthRate: 1,
  },
  deployed: {
    duration: '15s',
    browseRate: 1,
    browseVus: 4,
    browseMaxVus: 10,
    importRate: 1,
    importVus: 3,
    importMaxVus: 8,
    searchRate: 1,
    searchVus: 4,
    searchMaxVus: 10,
    workerStatusRate: 1,
    healthRate: 1,
  },
  'deployed-warmup': {
    duration: '15s',
    browseRate: 1,
    browseVus: 4,
    browseMaxVus: 10,
    importRate: 1,
    importVus: 3,
    importMaxVus: 8,
    searchRate: 1,
    searchVus: 4,
    searchMaxVus: 10,
    workerStatusRate: 1,
    healthRate: 2,
  },
  custom: {
    duration: '2m',
    browseRate: 20,
    browseVus: 50,
    browseMaxVus: 200,
    importRate: 2,
    importVus: 10,
    importMaxVus: 50,
    searchRate: 5,
    searchVus: 20,
    searchMaxVus: 100,
    workerStatusRate: 1,
    healthRate: 1,
  },
};
const defaults = profileDefaults[profile] || profileDefaults.custom;

export const options = {
  scenarios: {
    health_probe: {
      executor: 'constant-arrival-rate',
      rate: envNumber('HEALTH_RATE', defaults.healthRate),
      timeUnit: '1s',
      duration: __ENV.DURATION || defaults.duration,
      preAllocatedVUs: 2,
      maxVUs: 10,
      exec: 'healthProbe',
      tags: { load_profile: profile, route_group: 'public' },
    },
    browse_reads: {
      executor: 'constant-arrival-rate',
      rate: envNumber('BROWSE_RATE', defaults.browseRate),
      timeUnit: '1s',
      duration: __ENV.DURATION || defaults.duration,
      preAllocatedVUs: envNumber('BROWSE_VUS', defaults.browseVus),
      maxVUs: envNumber('BROWSE_MAX_VUS', defaults.browseMaxVus),
      exec: 'browseReads',
      tags: { load_profile: profile, route_group: 'authenticated' },
    },
    upload_imports: {
      executor: 'constant-arrival-rate',
      rate: envNumber('IMPORT_RATE', defaults.importRate),
      timeUnit: '1s',
      duration: __ENV.DURATION || defaults.duration,
      preAllocatedVUs: envNumber('IMPORT_VUS', defaults.importVus),
      maxVUs: envNumber('IMPORT_MAX_VUS', defaults.importMaxVus),
      exec: 'uploadImports',
      tags: { load_profile: profile, route_group: 'import' },
    },
    search_chat: {
      executor: 'constant-arrival-rate',
      rate: envNumber('SEARCH_RATE', defaults.searchRate),
      timeUnit: '1s',
      duration: __ENV.DURATION || defaults.duration,
      preAllocatedVUs: envNumber('SEARCH_VUS', defaults.searchVus),
      maxVUs: envNumber('SEARCH_MAX_VUS', defaults.searchMaxVus),
      exec: 'searchChat',
      tags: { load_profile: profile, route_group: 'search' },
    },
    worker_status: {
      executor: 'constant-arrival-rate',
      rate: envNumber('WORKER_STATUS_RATE', defaults.workerStatusRate),
      timeUnit: '5s',
      duration: __ENV.DURATION || defaults.duration,
      preAllocatedVUs: 2,
      maxVUs: 10,
      exec: 'workerStatus',
      tags: { load_profile: profile, route_group: 'admin' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:admin}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:authenticated}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:import}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:public}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:search}': ['p(95)<1500', 'p(99)<3000'],
    iscraper_failed_checks: ['rate<0.05'],
  },
};

function envNumber(name, fallback) {
  const parsed = Number(__ENV[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

function requestTags(routeGroup, routeName) {
  return { load_profile: profile, route_group: routeGroup, route_name: routeName };
}

function record(response, expectations) {
  const ok = check(response, expectations);
  failureRate.add(!ok);
  return ok;
}

export function healthProbe() {
  group('public runtime health', () => {
    const response = http.get(`${baseUrl}/api/health`, {
      headers: { 'X-IScraper-Client-Action': 'load-health' },
      tags: requestTags('public', 'health'),
    });
    record(response, {
      'health returns aggregate status': (res) => res.status === 200,
      'health does not crash API': (res) => res.status < 500,
    });
  });
  sleep(1);
}

export function browseReads() {
  group('browse library pages', () => {
    const response = http.get(`${baseUrl}/api/items?limit=24`, {
      headers: authHeaders({ 'X-IScraper-Client-Action': 'load-browse' }),
      tags: requestTags('authenticated', 'items_list'),
    });
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
      headers: token
        ? { Authorization: `Bearer ${token}`, 'X-IScraper-Client-Action': 'load-import' }
        : { 'X-User-ID': userId, 'X-User-Email': userEmail, 'X-IScraper-Client-Action': 'load-import' },
      tags: requestTags('import', 'imports_create'),
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
      headers: authHeaders({ 'X-IScraper-Client-Action': 'load-search' }),
      tags: requestTags('search', 'search_post'),
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
    const headers = adminKey
      ? { 'X-Admin-API-Key': adminKey, 'X-IScraper-Client-Action': 'load-worker-status' }
      : { 'X-IScraper-Client-Action': 'load-worker-status' };
    const response = http.get(`${baseUrl}/api/admin/worker/status`, {
      headers,
      tags: requestTags('admin', 'admin_worker_status'),
    });
    record(response, {
      'worker status is aggregate or locked': (res) => [200, 403, 503].includes(res.status),
      'worker status does not expose server errors': (res) => res.status < 500 || res.status === 503,
    });
  });
  sleep(5);
}
