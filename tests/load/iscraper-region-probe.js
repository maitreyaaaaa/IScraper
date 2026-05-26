import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const failureRate = new Rate('iscraper_region_probe_failed_checks');
const targets = String(__ENV.REGION_TARGETS || __ENV.BASE_URL || 'https://iscraper.vercel.app')
  .split(',')
  .map((target) => target.trim().replace(/\/$/, ''))
  .filter(Boolean);

if (!targets.length) {
  throw new Error('REGION_TARGETS or BASE_URL must include at least one URL.');
}

const duration = __ENV.DURATION || '20s';
const rate = envNumber('REGION_PROBE_RATE', 1);

export const options = {
  scenarios: {
    region_probe: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1s',
      duration,
      preAllocatedVUs: 2,
      maxVUs: 10,
      exec: 'regionProbe',
      tags: { load_profile: 'region-probe', route_group: 'public' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{route_group:public}': ['p(95)<1500', 'p(99)<3000'],
    iscraper_region_probe_failed_checks: ['rate<0.05'],
  },
};

function envNumber(name, fallback) {
  const parsed = Number(__ENV[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function record(response, expectations) {
  const ok = check(response, expectations);
  failureRate.add(!ok);
  return ok;
}

export function regionProbe() {
  group('public region probe', () => {
    for (const target of targets) {
      const response = http.get(`${target}/api/health`, {
        headers: { 'X-IScraper-Client-Action': 'load-region-probe' },
        tags: {
          load_profile: 'region-probe',
          route_group: 'public',
          route_name: 'health_region_probe',
          target,
        },
      });
      record(response, {
        'health probe returns 200': (res) => res.status === 200,
        'health probe has request id': (res) => Boolean(res.headers['X-Request-Id'] || res.headers['X-Request-ID']),
        'health probe exposes Vercel routing id': (res) => Boolean(res.headers['X-Vercel-Id']),
        'health probe does not crash API': (res) => res.status < 500,
      });
    }
  });
  sleep(1);
}
