const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scanRoots = [
  path.join(root, 'apps', 'ui', 'src'),
  path.join(root, 'apps', 'ui', 'dist'),
  path.join(root, 'extensions'),
];

const blockedPatterns = [
  { name: 'Supabase service role key name', pattern: /SUPABASE_SERVICE_ROLE_KEY/i },
  { name: 'Supabase secret key prefix', pattern: /sb_secret_/i },
  { name: 'Supabase service role token text', pattern: /\bservice[_-]?role\b/i },
  { name: 'OpenRouter secret key name', pattern: /OPENROUTER_API_KEY/i },
  { name: 'Gemini secret key name', pattern: /GEMINI_API_KEY/i },
  { name: 'Stripe secret key name', pattern: /STRIPE_SECRET_KEY/i },
  { name: 'Stripe webhook secret name', pattern: /STRIPE_WEBHOOK_SECRET/i },
  { name: 'worker secret key name', pattern: /WORKER_API_KEY/i },
  { name: 'admin secret key name', pattern: /ADMIN_API_KEY|ADMIN_PASSWORD/i },
  { name: 'credential encryption key name', pattern: /CREDENTIAL_ENCRYPTION_KEY/i },
];

const allowedExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.mjs',
  '.ts',
  '.tsx',
]);

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'scripts') continue;
      files.push(...listFiles(fullPath));
    } else if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const findings = [];
for (const scanRoot of scanRoots) {
  for (const file of listFiles(scanRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const blocked of blockedPatterns) {
        if (blocked.pattern.test(line)) {
          findings.push({
            file: path.relative(root, file),
            line: index + 1,
            name: blocked.name,
          });
        }
      }
    });
  }
}

if (findings.length) {
  console.error('Secret boundary check failed. Move these names/values out of browser-facing code:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.name}`);
  }
  process.exit(1);
}

console.log('Secret boundary check passed: no blocked server secret names were found in browser-facing code.');
