import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const token = String(__ENV.AUTH_TOKEN || '').trim();
if (!token) {
  throw new Error('AUTH_TOKEN is required for authenticated load testing. Use a dedicated test user token only.');
}

const failureRate = new Rate('iscraper_authenticated_failed_checks');
const invalidAuthResponses = new Counter('iscraper_auth_invalid_responses');
const unauthorizedResponses = new Counter('iscraper_auth_unauthorized_responses');
const forbiddenResponses = new Counter('iscraper_auth_forbidden_responses');
const profileRequiredResponses = new Counter('iscraper_auth_profile_required_responses');
const baseUrl = (__ENV.BASE_URL || 'https://iscraper.vercel.app').replace(/\/$/, '');
const profile = String(__ENV.LOAD_PROFILE || 'deployed-auth-readonly').toLowerCase();
const mutationEnabled = /^true$/i.test(String(__ENV.AUTH_MUTATION_ENABLED || 'false'));

const defaultsByProfile = {
  'deployed-auth-readonly': {
    duration: '20s',
    profileRate: 1,
    browseRate: 2,
    summaryRate: 1,
    searchRate: 1,
    mutationRate: 0.2,
  },
  'local-auth-readonly': {
    duration: '20s',
    profileRate: 2,
    browseRate: 3,
    summaryRate: 2,
    searchRate: 2,
    mutationRate: 0.5,
  },
};

const defaults = defaultsByProfile[profile] || defaultsByProfile['deployed-auth-readonly'];
let invalidAuthWarningPrinted = false;

const scenarios = {
  profile_read: scenario('profileRead', 'authenticated', envNumber('PROFILE_RATE', defaults.profileRate), '1s', 2, 10),
  library_browse: scenario('libraryBrowse', 'authenticated', envNumber('BROWSE_RATE', defaults.browseRate), '1s', 4, 20),
  indexing_summary: scenario('indexingSummary', 'authenticated', envNumber('SUMMARY_RATE', defaults.summaryRate), '1s', 2, 10),
  search_read: scenario('searchRead', 'search', envNumber('SEARCH_RATE', defaults.searchRate), '1s', 3, 15),
};

if (mutationEnabled) {
  scenarios.manual_link_save = scenario('manualLinkSave', 'import', envNumber('MUTATION_RATE', defaults.mutationRate), '5s', 1, 5);
}

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:authenticated}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:import}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:search}': ['p(95)<1500', 'p(99)<3000'],
    iscraper_authenticated_failed_checks: ['rate<0.05'],
    iscraper_auth_invalid_responses: ['count==0'],
  },
};

function scenario(exec, routeGroup, rate, timeUnit, preAllocatedVUs, maxVUs) {
  return {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit,
    duration: __ENV.DURATION || defaults.duration,
    preAllocatedVUs,
    maxVUs,
    exec,
    tags: { load_profile: profile, route_group: routeGroup },
  };
}

function envNumber(name, fallback) {
  const parsed = Number(__ENV[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function headers(action, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-IScraper-Client-Action': action,
    ...extra,
  };
}

function requestTags(routeGroup, routeName) {
  return { load_profile: profile, route_group: routeGroup, route_name: routeName };
}

function record(response, expectations) {
  recordAuthStatus(response);
  const ok = check(response, expectations);
  failureRate.add(!ok);
  return ok;
}

function recordAuthStatus(response) {
  if (response.status === 401) {
    unauthorizedResponses.add(1);
    invalidAuthResponses.add(1);
    printInvalidAuthWarning();
  } else if (response.status === 403) {
    forbiddenResponses.add(1);
    invalidAuthResponses.add(1);
    printInvalidAuthWarning();
  } else if (response.status === 428) {
    profileRequiredResponses.add(1);
    invalidAuthResponses.add(1);
    printInvalidAuthWarning();
  }
}

function printInvalidAuthWarning() {
  if (invalidAuthWarningPrinted) return;
  invalidAuthWarningPrinted = true;
  console.error('Invalid authenticated latency evidence: received 401/403/428 before signed-in route logic completed.');
}

export function profileRead() {
  group('authenticated profile read', () => {
    const response = http.get(`${baseUrl}/api/profile`, {
      headers: headers('load-auth-profile'),
      tags: requestTags('authenticated', 'profile_read'),
    });
    record(response, {
      'profile returns signed-in user state': (res) => res.status === 200,
      'profile does not crash API': (res) => res.status < 500,
    });
  });
  sleep(1);
}

export function libraryBrowse() {
  group('authenticated library browse', () => {
    const response = http.get(`${baseUrl}/api/items?limit=24`, {
      headers: headers('load-auth-browse'),
      tags: requestTags('authenticated', 'items_list_authenticated'),
    });
    record(response, {
      'library browse succeeds for completed test profile': (res) => res.status === 200,
      'library browse does not crash API': (res) => res.status < 500,
    });
  });
  sleep(1);
}

export function indexingSummary() {
  group('authenticated indexing summary', () => {
    const response = http.get(`${baseUrl}/api/indexing/summary`, {
      headers: headers('load-auth-indexing-summary'),
      tags: requestTags('authenticated', 'indexing_summary_authenticated'),
    });
    record(response, {
      'indexing summary succeeds for completed test profile': (res) => res.status === 200,
      'indexing summary does not crash API': (res) => res.status < 500,
    });
  });
  sleep(1);
}

export function searchRead() {
  group('authenticated keyword search', () => {
    const response = http.post(`${baseUrl}/api/search`, JSON.stringify({ query: 'design inspiration', includeAi: false }), {
      headers: headers('load-auth-search'),
      tags: requestTags('search', 'search_authenticated_no_ai'),
    });
    record(response, {
      'search succeeds without AI generation': (res) => res.status === 200,
      'search does not crash API': (res) => res.status < 500,
    });
  });
  sleep(1);
}

export function manualLinkSave() {
  group('authenticated manual link save', () => {
    const suffix = `${Date.now()}-${__VU}-${__ITER}`;
    const payload = {
      url: `https://example.com/iscraper-phase6h-load-${suffix}`,
      title: 'IScraper Phase 6H load test save',
      collection: 'Load test evidence',
      review: true,
    };
    const response = http.post(`${baseUrl}/api/saves/link`, JSON.stringify(payload), {
      headers: headers('load-auth-manual-save'),
      tags: requestTags('import', 'manual_link_save_authenticated'),
    });
    record(response, {
      'manual save is accepted or deliberately throttled': (res) => [201, 429].includes(res.status),
      'manual save does not crash API': (res) => res.status < 500,
    });
  });
  sleep(2);
}
