const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultMigrationsDir = path.join(root, 'apps', 'orchestration', 'supabase', 'migrations');

const SERVER_ONLY_POLICYLESS_TABLES = new Set([
  'admin_credit_adjustments',
  'user_admin_states',
  'user_activity_events',
]);

const INTENTIONAL_ANON_TABLES = new Set([
  'public_feedback',
]);

function readSqlFiles(dir = defaultMigrationsDir) {
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      path: path.join(dir, file),
      text: fs.readFileSync(path.join(dir, file), 'utf8'),
    }));
}

function normalizeSql(text) {
  return text
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectMatches(text, regex, groupIndex = 1) {
  const values = new Set();
  let match;
  while ((match = regex.exec(text))) values.add(match[groupIndex]);
  return values;
}

function extractStorageBuckets(sql) {
  const buckets = new Map();
  const bucketStatements = sql.match(/insert\s+into\s+storage\.buckets[\s\S]*?;/gi) || [];
  for (const statement of bucketStatements) {
    const valueMatch = statement.match(/values\s*\(\s*'([^']+)'/i);
    if (!valueMatch) continue;
    const name = valueMatch[1];
    buckets.set(name, {
      publicFalse: /\bfalse\b/i.test(statement),
      statement,
    });
  }
  return buckets;
}

function policyStatements(sql) {
  return (sql.match(/create\s+policy\s+[\s\S]*?;/gi) || []).map((statement) => normalizeSql(statement));
}

function securityDefinerFindings(files) {
  const findings = [];
  for (const file of files) {
    const text = normalizeSql(file.text);
    let index = 0;
    while ((index = text.toLowerCase().indexOf('security definer', index)) >= 0) {
      const window = text.slice(index, index + 220).toLowerCase();
      if (!window.includes('set search_path = public')) {
        findings.push(`${file.file}: security definer function is missing "set search_path = public".`);
      }
      index += 'security definer'.length;
    }
  }
  return findings;
}

function analyzeSupabaseSecurity({ migrationsDir = defaultMigrationsDir } = {}) {
  const files = readSqlFiles(migrationsDir);
  const sql = normalizeSql(files.map((file) => file.text).join('\n'));

  const createdTables = collectMatches(sql, /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi);
  const rlsTables = collectMatches(sql, /alter\s+table\s+public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi);
  const policies = policyStatements(sql);
  const policyTables = new Set();
  const broadAnonPolicyTables = new Set();
  for (const policy of policies) {
    const table = policy.match(/\s+on\s+public\.([a-z0-9_]+)/i)?.[1];
    if (!table) continue;
    policyTables.add(table);
    if (/\bto\s+anon\b/i.test(policy) || /\bto\s+anon\s*,\s*authenticated\b/i.test(policy)) {
      broadAnonPolicyTables.add(table);
    }
  }
  const revokedTables = collectMatches(sql, /revoke\s+all\s+on\s+(?:table\s+)?public\.([a-z0-9_]+)\s+from\s+anon\s*,\s*authenticated/gi);

  const findings = [];
  const review = [];
  for (const table of createdTables) {
    if (!rlsTables.has(table)) findings.push(`public.${table} is created without enabling row level security.`);
    const hasPolicy = policyTables.has(table);
    const hasRevoke = revokedTables.has(table);
    const serverOnly = SERVER_ONLY_POLICYLESS_TABLES.has(table);
    if (!hasPolicy && !hasRevoke && !serverOnly) {
      findings.push(`public.${table} has RLS but no policy, revoke, or server-only allowlist.`);
    }
    if (serverOnly && !hasPolicy) {
      review.push(`public.${table} is intentionally server-only with RLS and no client policy.`);
    }
  }

  for (const table of broadAnonPolicyTables) {
    if (!INTENTIONAL_ANON_TABLES.has(table)) {
      findings.push(`public.${table} has a policy granted to anon without an explicit allowlist.`);
    }
  }

  const buckets = extractStorageBuckets(sql);
  for (const [bucket, info] of buckets.entries()) {
    if (!info.publicFalse) findings.push(`storage bucket ${bucket} is not explicitly private.`);
    const bucketPolicyRe = new RegExp(`bucket_id\\s*=\\s*'${escapeRegExp(bucket)}'[\\s\\S]{0,220}storage\\.foldername\\(name\\)\\)\\[1\\][\\s\\S]{0,120}auth\\.uid\\(\\)`, 'i');
    if (!bucketPolicyRe.test(sql)) {
      findings.push(`storage bucket ${bucket} does not have an auth.uid()-owned folder policy.`);
    }
  }

  findings.push(...securityDefinerFindings(files));

  return {
    ok: findings.length === 0,
    findings,
    review,
    summary: {
      files: files.length,
      tablesCreated: createdTables.size,
      rlsTables: rlsTables.size,
      policyTables: policyTables.size,
      privateBuckets: [...buckets.values()].filter((bucket) => bucket.publicFalse).length,
      storageBuckets: buckets.size,
    },
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  const migrationsDir = process.env.SUPABASE_MIGRATIONS_DIR || defaultMigrationsDir;
  const result = analyzeSupabaseSecurity({ migrationsDir });
  console.log(`Supabase security scan: ${result.summary.files} migration files, ${result.summary.tablesCreated} created tables, ${result.summary.rlsTables} RLS tables, ${result.summary.policyTables} policy-covered tables, ${result.summary.privateBuckets}/${result.summary.storageBuckets} private storage buckets.`);
  for (const item of result.review) console.log(`Review: ${item}`);
  if (!result.ok) {
    console.error('Supabase security check failed:');
    for (const finding of result.findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log('Supabase security check passed: migrations keep RLS, storage ownership, and security-definer boundaries measurable.');
}

if (require.main === module) main();

module.exports = {
  analyzeSupabaseSecurity,
  extractStorageBuckets,
};
