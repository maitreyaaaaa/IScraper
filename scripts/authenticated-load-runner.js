const { spawn } = require('node:child_process');

const DEFAULT_BASE_URL = 'https://iscraper.vercel.app';
const DEFAULT_LOAD_PROFILE = 'deployed-auth-readonly';

class AuthLoadError extends Error {
  constructor(message, { category = 'unknown', status = null, route = '' } = {}) {
    super(message);
    this.name = 'AuthLoadError';
    this.category = category;
    this.status = status;
    this.route = route;
  }
}

function firstEnv(env, names) {
  for (const name of names) {
    const value = String(env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function getConfig(env = process.env) {
  const config = {
    baseUrl: String(env.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    loadProfile: String(env.LOAD_PROFILE || DEFAULT_LOAD_PROFILE),
    supabaseUrl: firstEnv(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL']).replace(/\/$/, ''),
    supabaseAnonKey: firstEnv(env, ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY']),
    testEmail: String(env.SUPABASE_TEST_EMAIL || '').trim(),
    testPassword: String(env.SUPABASE_TEST_PASSWORD || ''),
  };
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL or VITE_SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY');
  if (!config.testEmail) missing.push('SUPABASE_TEST_EMAIL');
  if (!config.testPassword) missing.push('SUPABASE_TEST_PASSWORD');
  return { config, missing };
}

function classifyStatus(status) {
  if (status === 200) return 'ok';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 428) return 'profile_required';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  if (!status) return 'network_error';
  return 'unexpected_status';
}

async function signInWithPassword({ supabaseUrl, supabaseAnonKey, testEmail, testPassword, fetchImpl = fetch }) {
  const url = `${supabaseUrl}/auth/v1/token?grant_type=password`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
  } catch (error) {
    throw new AuthLoadError('Supabase test sign-in request failed.', { category: 'supabase_sign_in_network_error' });
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body?.access_token) {
    throw new AuthLoadError('Supabase test sign-in failed.', {
      category: classifyStatus(response.status),
      status: response.status,
    });
  }
  return body.access_token;
}

async function timedFetch(fetchImpl, url, options) {
  const startedAt = Date.now();
  const response = await fetchImpl(url, options);
  return {
    status: response.status,
    durationMs: Date.now() - startedAt,
  };
}

async function runPreflight({ baseUrl, token, fetchImpl = fetch, log = console.log }) {
  const routes = [
    { method: 'GET', path: '/api/profile' },
    { method: 'GET', path: '/api/items?limit=1' },
    {
      method: 'POST',
      path: '/api/search',
      body: JSON.stringify({ query: 'design inspiration', includeAi: false }),
    },
  ];
  const results = [];
  for (const route of routes) {
    let result;
    try {
      result = await timedFetch(fetchImpl, `${baseUrl}${route.path}`, {
        method: route.method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-IScraper-Client-Action': 'load-auth-preflight',
        },
        body: route.body,
      });
    } catch {
      result = { status: 0, durationMs: 0 };
    }
    const category = classifyStatus(result.status);
    results.push({ ...route, status: result.status, durationMs: result.durationMs, category });
    log(`Preflight ${route.method} ${route.path} status=${result.status} durationMs=${result.durationMs} category=${category}`);
  }
  const failed = results.find((result) => result.status !== 200);
  if (failed) {
    throw new AuthLoadError('Authenticated preflight failed; k6 was not started.', {
      category: failed.category,
      status: failed.status,
      route: `${failed.method} ${failed.path}`,
    });
  }
  return results;
}

function runK6({ token, baseUrl, loadProfile, env = process.env, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawnImpl(npmCommand, ['run', 'load:auth'], {
      stdio: 'inherit',
      shell: false,
      env: {
        ...env,
        AUTH_TOKEN: token,
        BASE_URL: baseUrl,
        LOAD_PROFILE: loadProfile,
      },
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function runAuthenticatedLoad({ env = process.env, fetchImpl = fetch, spawnImpl = spawn, log = console.log } = {}) {
  const { config, missing } = getConfig(env);
  if (missing.length) {
    throw new AuthLoadError(`Missing required auth-load env: ${missing.join(', ')}.`, {
      category: 'missing_env',
    });
  }
  log(`Signing in Supabase test user for ${config.baseUrl} with profile ${config.loadProfile}.`);
  const token = await signInWithPassword({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    testEmail: config.testEmail,
    testPassword: config.testPassword,
    fetchImpl,
  });
  await runPreflight({ baseUrl: config.baseUrl, token, fetchImpl, log });
  log('Authenticated preflight passed. Starting k6.');
  return runK6({ token, baseUrl: config.baseUrl, loadProfile: config.loadProfile, env, spawnImpl });
}

async function main() {
  try {
    const exitCode = await runAuthenticatedLoad();
    process.exitCode = exitCode;
  } catch (error) {
    const category = error.category || 'unknown';
    const status = error.status ? ` status=${error.status}` : '';
    const route = error.route ? ` route="${error.route}"` : '';
    console.error(`Authenticated load runner failed: category=${category}${status}${route}. ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  AuthLoadError,
  classifyStatus,
  getConfig,
  runAuthenticatedLoad,
  runPreflight,
  signInWithPassword,
};
