const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  classifyStatus,
  runAuthenticatedLoad,
  runPreflight,
  signInWithPassword,
} = require('../../../scripts/authenticated-load-runner');
const { analyzeSupabaseSecurity } = require('../../../scripts/supabase-security-check');
const { collectRoutes, validateRows } = require('../../../scripts/route-inventory');
const { renderAudit, summarizePlanBody } = require('../../../scripts/supabase-db-audit');

test('Supabase security gate catches missing RLS and policies in migrations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iscraper-supabase-security-'));
  fs.writeFileSync(path.join(dir, '202605270001_bad.sql'), `
    create table if not exists public.leaky_table (
      id uuid primary key
    );
  `);

  const result = analyzeSupabaseSecurity({ migrationsDir: dir });

  assert.equal(result.ok, false);
  assert.match(result.findings.join('\n'), /without enabling row level security/);
  assert.match(result.findings.join('\n'), /no policy/);
});

test('route inventory fails high-risk routes with missing auth or rate limits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iscraper-route-inventory-'));
  fs.writeFileSync(path.join(dir, 'adminRoutes.js'), `
    function registerAdminRoutes(app, deps) {
      const { generalRateLimit } = deps.http.rateLimiters;
      app.get('/api/admin/summary', generalRateLimit, asyncRoute(async (_req, res) => res.json({ ok: true })));
    }
  `);

  const rows = collectRoutes({ dir });
  const findings = validateRows(rows);

  assert.equal(rows.length, 1);
  assert.match(findings.join('\n'), /no route auth helper|must use assertAdmin/);
  assert.match(findings.join('\n'), /expected adminRateLimit/);
});

test('DB audit rendering keeps query-plan output aggregate-only', () => {
  const plan = summarizePlanBody([
    {
      'QUERY PLAN': [
        {
          Plan: {
            'Node Type': 'Limit',
            'Total Cost': 12.34,
            'Plan Rows': 24,
            Plans: [
              {
                'Node Type': 'Index Scan',
                'Relation Name': 'saved_items',
                'Index Name': 'saved_items_user_created_id_idx',
              },
            ],
          },
        },
      ],
    },
  ]);
  const rendered = renderAudit({
    projectRef: 'example-ref',
    inventories: {
      rls_policy_inventory: [{ table_name: 'saved_items', rls_enabled: true, policy_count: 1 }],
      index_inventory: [{ tablename: 'saved_items', indexname: 'saved_items_user_created_id_idx' }],
      table_stats: [{ table_name: 'saved_items', estimated_live_rows: 10, estimated_dead_rows: 0, seq_scan: 1, idx_scan: 2 }],
    },
    plans: [{ name: 'saved_items_first_page', ...plan }],
    recommendations: [],
  });

  assert.match(rendered, /saved_items_user_created_id_idx/);
  assert.doesNotMatch(rendered, /caption|url|email|token|Authorization/i);
});

test('authenticated load runner fails before k6 when required env is missing', async () => {
  await assert.rejects(
    () => runAuthenticatedLoad({ env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: 'secret-token' }) }) }),
    (error) => {
      assert.equal(error.category, 'missing_env');
      assert.doesNotMatch(error.message, /secret-token|password-secret|person@example.com/i);
      return true;
    },
  );
});

test('Supabase test sign-in failure is sanitized', async () => {
  await assert.rejects(
    () => signInWithPassword({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-secret',
      testEmail: 'person@example.com',
      testPassword: 'password-secret',
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }),
    }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.category, 'client_error');
      assert.doesNotMatch(error.message, /person@example.com|password-secret|anon-secret|invalid_grant/);
      return true;
    },
  );
});

test('authenticated preflight classifies incomplete profile before k6 starts', async () => {
  const logs = [];
  await assert.rejects(
    () => runPreflight({
      baseUrl: 'https://iscraper.example',
      token: 'secret-token',
      log: (line) => logs.push(line),
      fetchImpl: async (url) => ({
        status: String(url).includes('/api/items') ? 428 : 200,
      }),
    }),
    (error) => {
      assert.equal(error.category, 'profile_required');
      assert.equal(error.status, 428);
      assert.equal(error.route, 'GET /api/items?limit=1');
      return true;
    },
  );
  assert.match(logs.join('\n'), /category=profile_required/);
  assert.doesNotMatch(logs.join('\n'), /secret-token/);
});

test('authenticated preflight accepts profile, item, and no-AI search routes', async () => {
  const results = await runPreflight({
    baseUrl: 'https://iscraper.example',
    token: 'secret-token',
    log: () => {},
    fetchImpl: async () => ({ status: 200 }),
  });

  assert.deepEqual(results.map((result) => result.category), ['ok', 'ok', 'ok']);
});

test('auth status classifier separates auth failures from latency failures', () => {
  assert.equal(classifyStatus(401), 'unauthenticated');
  assert.equal(classifyStatus(403), 'forbidden');
  assert.equal(classifyStatus(428), 'profile_required');
  assert.equal(classifyStatus(500), 'server_error');
});
