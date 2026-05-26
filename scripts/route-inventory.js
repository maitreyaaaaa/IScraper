const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const routesDir = path.join(root, 'apps', 'orchestration', 'src', 'routes');

const ROUTE_RE = /app\.(get|post|put|patch|delete)\('([^']+)'/;
const RATE_LIMIT_RE = /\b(adminRateLimit|checkoutRateLimit|feedbackRateLimit|importRateLimit|searchRateLimit|workerRateLimit|generalRateLimit)\b/;
const AUTH_HELPERS = [
  'assertAdmin',
  'assertWorker',
  'getAgentUser',
  'getAgentRequestUser',
  'getExtensionUser',
  'getExtensionRequestUser',
  'assertTelegramWebhookSecret',
  'stripe.webhooks.constructEvent',
  'workerProcessHandler',
  'requireCompletedProfile',
  'getUser',
];

function routeFiles(dir = routesDir) {
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.js'))
    .sort();
}

function classify(fileName, routePath) {
  if (routePath.startsWith('/api/admin/')) return 'admin';
  if (routePath.startsWith('/api/worker/')) return 'worker';
  if (routePath === '/api/webhooks/stripe') return 'signed-webhook';
  if (routePath === '/api/telegram/webhook') return 'signed-webhook';
  if (fileName.includes('Private')) return 'authenticated';
  if (routePath.startsWith('/api/agent-access/') || routePath === '/api/mcp') return 'token-authenticated';
  if (routePath.includes('/extension/') || routePath.includes('/lens/')) return 'token-authenticated';
  if (['accountRoutes.js', 'importRoutes.js', 'libraryRoutes.js'].includes(fileName)) return 'authenticated';
  return 'public';
}

function context(source, lineIndex, length = 80) {
  return source.slice(lineIndex, Math.min(source.length, lineIndex + length)).join(' ');
}

function routeSegment(source, lineIndex, maxLength = 80) {
  const nextRouteIndex = source.findIndex((line, index) => index > lineIndex && ROUTE_RE.test(line));
  const routeEnd = nextRouteIndex > lineIndex ? nextRouteIndex : Math.min(source.length, lineIndex + maxLength);
  return source.slice(lineIndex, routeEnd).join(' ');
}

function limiterFor(source, lineIndex) {
  const routeCall = context(source, lineIndex, 6);
  const match = routeCall.match(RATE_LIMIT_RE);
  return match ? match[1] : 'generalRateLimit';
}

function authFor(fileName, routePath, source, lineIndex) {
  if (routePath === '/api/admin/login') return 'password admin login';
  const body = routeSegment(source, lineIndex);
  const helper = AUTH_HELPERS
    .map((name) => ({ name, index: body.indexOf(name) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index)[0]?.name;
  if (helper === 'stripe.webhooks.constructEvent') return 'stripe signature';
  if (helper === 'workerProcessHandler') return 'workerProcessHandler';
  if (helper) return helper;
  const access = classify(fileName, routePath);
  if (access === 'authenticated') return 'global getUser middleware';
  return 'none in route';
}

function uploadOrBodyLimitFor(routePath, source, lineIndex) {
  const body = routeSegment(source, lineIndex);
  if (body.includes("express.raw({ type: 'application/json' })")) return 'raw json webhook body';
  if (body.includes("upload.array('exportFiles', 20)")) return '20 files, configured max file size';
  if (body.includes("chunkUpload.single('chunk')")) return 'single chunk, 2 MB memory limit';
  if (body.includes("noteUpload.array('images'")) return 'note images, max count/bytes/type';
  if (routePath.includes('/upload-urls') || routePath.includes('/storage')) return '20 files, storage path ownership';
  if (routePath.includes('/search') || routePath.includes('/library-chat')) return 'query trimmed to 240 chars';
  return 'json/default';
}

function sensitiveOutputRisk(routePath, access) {
  if (routePath.includes('/privacy-export') || routePath === '/api/data') return 'high user export';
  if (routePath.startsWith('/api/admin/')) return 'admin aggregate/user data';
  if (routePath.startsWith('/api/worker/') || routePath.endsWith('/worker/status')) return 'aggregate worker status';
  if (routePath.includes('/provider-credentials') || routePath.includes('/extension-tokens') || routePath.includes('/agent-access/tokens')) return 'token/credential metadata';
  if (routePath.includes('/items') || routePath.includes('/search') || routePath.includes('/library-chat')) return 'user library content';
  if (access === 'public') return 'public only';
  return 'authenticated metadata';
}

function expectedLimiter(row) {
  if (row.access === 'admin') return 'adminRateLimit';
  if (row.access === 'worker') return 'workerRateLimit';
  if (row.path.includes('/search') || row.path.includes('/library-chat') || row.path.includes('/visual-search') || row.path.includes('/enrichment/intent-batch')) return 'searchRateLimit';
  if (row.path === '/api/imports/:id/process') return null;
  if (row.path.includes('/imports') || row.path.includes('/saves/link') || row.path.includes('/library-care/check-links')) return 'importRateLimit';
  if (row.path.includes('/checkout')) return 'checkoutRateLimit';
  if (row.path === '/api/feedback' && row.method === 'POST') return 'feedbackRateLimit';
  return null;
}

function validateRows(rows) {
  const findings = [];
  for (const row of rows) {
    if (['admin', 'worker', 'token-authenticated', 'signed-webhook'].includes(row.access) && row.auth === 'none in route') {
      findings.push(`${row.method} ${row.path} is ${row.access} but has no route auth helper.`);
    }
    if (row.access === 'admin' && !['assertAdmin', 'password admin login'].includes(row.auth)) {
      findings.push(`${row.method} ${row.path} must use assertAdmin.`);
    }
    if (row.access === 'worker' && !['assertWorker', 'workerProcessHandler'].includes(row.auth)) {
      findings.push(`${row.method} ${row.path} must use assertWorker through the route or workflow handler.`);
    }
    const expected = expectedLimiter(row);
    if (expected && row.limiter !== expected) {
      const allowedChunk = row.path === '/api/imports/upload-chunk' && row.limiter === 'generalRateLimit';
      if (!allowedChunk) findings.push(`${row.method} ${row.path} expected ${expected}, found ${row.limiter}.`);
    }
  }
  return findings;
}

function collectRoutes({ dir = routesDir } = {}) {
  const rows = [];
  for (const fileName of routeFiles(dir)) {
    const filePath = path.join(dir, fileName);
    const source = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    source.forEach((line, index) => {
      const match = line.match(ROUTE_RE);
      if (!match) return;
      const [, method, routePath] = match;
      const access = classify(fileName, routePath);
      rows.push({
        method: method.toUpperCase(),
        path: routePath,
        access,
        auth: authFor(fileName, routePath, source, index),
        limiter: limiterFor(source, index),
        uploadBodyLimit: uploadOrBodyLimitFor(routePath, source, index),
        sensitiveOutputRisk: sensitiveOutputRisk(routePath, access),
        file: path.relative(root, filePath).replace(/\\/g, '/'),
      });
    });
  }
  return rows;
}

function renderMarkdown(rows) {
  const lines = [
    '| Method | Path | Access | Auth | Rate limit | Upload/body limit | Sensitive output risk | File |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(`| ${row.method} | \`${row.path}\` | ${row.access} | ${row.auth} | ${row.limiter} | ${row.uploadBodyLimit} | ${row.sensitiveOutputRisk} | ${row.file} |`);
  }
  return lines.join('\n');
}

function main() {
  const rows = collectRoutes();
  console.log(renderMarkdown(rows));
  const findings = validateRows(rows);
  if (findings.length) {
    console.error('\nRoute inventory check failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  classify,
  collectRoutes,
  renderMarkdown,
  validateRows,
};
