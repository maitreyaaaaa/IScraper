const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultMigrationsDir = path.join(root, 'apps', 'orchestration', 'supabase', 'migrations');

const SERVER_ONLY_POLICYLESS_TABLES = new Set([
  'admin_credit_adjustments',
  'security_audit_events',
  'user_admin_states',
  'user_activity_events',
  'automations',
  'automation_runs',
  'automation_chats',
  'automation_chat_messages',
  'request_rate_budgets',
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

function tableDefinitions(sql) {
  const tables = new Map();
  const regex = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi;
  let match;
  while ((match = regex.exec(sql))) {
    tables.set(match[1], normalizeSql(match[2]));
  }
  return tables;
}

function tableHasColumn(body, column) {
  return new RegExp(`(?:^|,)\\s*\\b${escapeRegExp(column)}\\b\\s+`, 'i').test(body);
}

function tableHasColumnInSql(sql, table, body, column) {
  return tableHasColumn(body || '', column)
    || new RegExp(`alter\\s+table\\s+public\\.${escapeRegExp(table)}[^;]*add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${escapeRegExp(column)}\\s+`, 'i').test(sql);
}

function hasUserForeignKey(sql, table, body) {
  return new RegExp(`\\buser_id\\b[^,]*references\\s+(?:public|auth)\\.users\\s*\\(\\s*id\\s*\\)`, 'i').test(body)
    || new RegExp(`alter\\s+table\\s+public\\.${escapeRegExp(table)}[^;]*foreign\\s+key\\s*\\(\\s*user_id\\s*\\)[^;]*references\\s+(?:public|auth)\\.users\\s*\\(\\s*id\\s*\\)`, 'i').test(sql);
}

function hasUserIndex(sql, table, body) {
  return /\buser_id\b[^,]*(?:primary\s+key|unique)/i.test(body)
    || /(?:primary\s+key|unique)\s*\([^)]*\buser_id\b/i.test(body)
    || new RegExp(`create\\s+(?:unique\\s+)?index[\\s\\S]*?on\\s+public\\.${escapeRegExp(table)}\\s*\\([^)]*\\buser_id\\b`, 'i').test(sql);
}

function bucketForcedPrivate(sql, bucket) {
  const escaped = escapeRegExp(bucket);
  const conflictPrivate = new RegExp(`insert\\s+into\\s+storage\\.buckets[\\s\\S]{0,260}'${escaped}'[\\s\\S]{0,360}on\\s+conflict\\s*\\([^)]*\\)\\s*do\\s+update[\\s\\S]{0,240}public\\s*=\\s*false`, 'i').test(sql);
  const directUpdate = new RegExp(`update\\s+storage\\.buckets[\\s\\S]{0,180}public\\s*=\\s*false[\\s\\S]{0,180}(?:id\\s*=\\s*'${escaped}'|id\\s+in\\s*\\([^)]*'${escaped}'[^)]*\\))`, 'i').test(sql);
  return conflictPrivate || directUpdate;
}

function securityDefinerFindings(files) {
  const findings = [];
  for (const file of files) {
    const text = normalizeSql(file.text);
    let index = 0;
    while ((index = text.toLowerCase().indexOf('security definer', index)) >= 0) {
      const window = text.slice(index, index + 220).toLowerCase();
      const pinnedSearchPath = /set\s+search_path\s*=\s*(?:public(?:\s*,\s*pg_temp)?|pg_catalog\s*,\s*public(?:\s*,\s*pg_temp)?|''|"")/i.test(window);
      if (!pinnedSearchPath) {
        findings.push(`${file.file}: security definer function is missing a pinned or empty search_path.`);
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
  const definitions = tableDefinitions(files.map((file) => file.text).join('\n'));
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
    if (serverOnly && !hasPolicy && !hasRevoke) {
      findings.push(`public.${table} is server-only in code but does not revoke anon/authenticated access in SQL.`);
    } else if (serverOnly && !hasPolicy) {
      review.push(`public.${table} is intentionally server-only with RLS and no client policy.`);
    }

    const body = definitions.get(table) || '';
    if (tableHasColumnInSql(sql, table, body, 'user_id')) {
      if (!hasUserForeignKey(sql, table, body)) {
        findings.push(`public.${table} has user_id without a foreign key to public.users(id) or auth.users(id).`);
      }
      if (!hasUserIndex(sql, table, body)) {
        findings.push(`public.${table} has user_id without a primary key, unique key, or index beginning with user_id.`);
      }
      if (!serverOnly && !policies.some((policy) => policy.includes(` public.${table}`) && /auth\.uid\s*\(\s*\)/i.test(policy))) {
        findings.push(`public.${table} has user_id but no auth.uid()-scoped policy.`);
      }
    }
  }

  const tenantReferenceChecks = [
    {
      name: 'smart_collection_items collection ownership',
      regex: /foreign\s+key\s*\(\s*user_id\s*,\s*collection_id\s*\)\s+references\s+public\.smart_collections\s*\(\s*user_id\s*,\s*id\s*\)/i,
    },
    {
      name: 'search_result_feedback search-event ownership',
      regex: /foreign\s+key\s*\(\s*user_id\s*,\s*search_event_id\s*\)\s+references\s+public\.search_events\s*\(\s*user_id\s*,\s*id\s*\)/i,
    },
    {
      name: 'analysis_usage_events saved-item ownership',
      regex: /foreign\s+key\s*\(\s*user_id\s*,\s*item_id\s*\)\s+references\s+public\.saved_items\s*\(\s*user_id\s*,\s*id\s*\)/i,
    },
  ];
  for (const check of tenantReferenceChecks) {
    if (!check.regex.test(sql)) findings.push(`Missing tenant-bound reference: ${check.name}.`);
  }

  for (const table of broadAnonPolicyTables) {
    if (!INTENTIONAL_ANON_TABLES.has(table)) {
      findings.push(`public.${table} has a policy granted to anon without an explicit allowlist.`);
    }
  }

  const buckets = extractStorageBuckets(sql);
  for (const [bucket, info] of buckets.entries()) {
    if (!info.publicFalse) findings.push(`storage bucket ${bucket} is not explicitly private.`);
    if (!bucketForcedPrivate(sql, bucket)) findings.push(`storage bucket ${bucket} is not forced private on conflict or by a later update.`);
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
      tenantCheckedTables: [...createdTables].filter((table) => tableHasColumnInSql(sql, table, definitions.get(table) || '', 'user_id')).length,
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
