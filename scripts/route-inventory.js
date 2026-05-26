const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const routesDir = path.join(root, 'apps', 'orchestration', 'src', 'routes');

const routeFiles = fs.readdirSync(routesDir)
  .filter((file) => file.endsWith('.js'))
  .sort();

function classify(fileName, routePath) {
  if (routePath.startsWith('/api/admin/')) return 'admin';
  if (routePath.startsWith('/api/worker/')) return 'worker';
  if (fileName.includes('Private')) return 'authenticated';
  if (['accountRoutes.js', 'importRoutes.js', 'libraryRoutes.js'].includes(fileName)) return 'authenticated';
  if (routePath.startsWith('/api/agent-access/') || routePath === '/api/mcp') return 'token-authenticated';
  if (routePath === '/api/telegram/webhook') return 'signed-webhook';
  if (routePath.includes('/extension/') || routePath.includes('/lens/')) return 'token-authenticated';
  return 'public';
}

function limiterFor(source, lineIndex) {
  const routeCall = source.slice(lineIndex, Math.min(source.length, lineIndex + 4)).join(' ');
  const match = routeCall.match(/\b(adminRateLimit|checkoutRateLimit|feedbackRateLimit|importRateLimit|searchRateLimit|workerRateLimit)\b/);
  return match ? match[1] : 'generalRateLimit';
}

function authFor(fileName, routePath, source, lineIndex) {
  const body = source.slice(lineIndex, Math.min(source.length, lineIndex + 80)).join(' ');
  const helpers = [
    'assertAdmin',
    'assertWorker',
    'getAgentUser',
    'getAgentRequestUser',
    'getExtensionUser',
    'getExtensionRequestUser',
    'assertTelegramWebhookSecret',
    'requireCompletedProfile',
    'getUser',
  ];
  const helper = helpers
    .map((name) => ({ name, index: body.indexOf(name) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index)[0]?.name;
  if (helper) return helper;
  const access = classify(fileName, routePath);
  if (access === 'authenticated') return 'global getUser middleware';
  if (access === 'admin') return 'assertAdmin';
  if (access === 'worker') return 'assertWorker';
  return 'none in route';
}

const rows = [];
for (const fileName of routeFiles) {
  const filePath = path.join(routesDir, fileName);
  const source = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  source.forEach((line, index) => {
    const match = line.match(/app\.(get|post|put|patch|delete)\('([^']+)'/);
    if (!match) return;
    const [, method, routePath] = match;
    rows.push({
      method: method.toUpperCase(),
      path: routePath,
      access: classify(fileName, routePath),
      auth: authFor(fileName, routePath, source, index),
      limiter: limiterFor(source, index),
      file: path.relative(root, filePath).replace(/\\/g, '/'),
    });
  });
}

console.log('| Method | Path | Access | Auth | Rate limit | File |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const row of rows) {
  console.log(`| ${row.method} | \`${row.path}\` | ${row.access} | ${row.auth} | ${row.limiter} | ${row.file} |`);
}
