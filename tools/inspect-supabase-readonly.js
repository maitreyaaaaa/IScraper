const fs = require('fs');
const path = require('path');
const { createClient } = require('../apps/orchestration/node_modules/@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return '[invalid-url]';
  }
}

async function maybeCount(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) return { table, ok: false, error: `${error.code || 'error'}: ${error.message}` };
  return { table, ok: true, count };
}

async function sampleColumns(client, table, columns = '*') {
  const { data, error } = await client.from(table).select(columns).limit(1);
  if (error) return { table, ok: false, error: `${error.code || 'error'}: ${error.message}` };
  return { table, ok: true, columns: data?.[0] ? Object.keys(data[0]) : [] };
}

async function main() {
  const envPath = process.argv[2] || path.resolve(__dirname, '../../IScraper-main/.vercel/.env.production.local');
  loadEnvFile(envPath);

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and a server-side Supabase key are required.');
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const expectedTables = [
    'users',
    'imports',
    'collections',
    'saved_items',
    'item_assets',
    'item_analysis',
    'item_embeddings',
    'processing_jobs',
    'user_ai_keys',
    'user_provider_credentials',
    'user_credit_accounts',
    'credit_transactions',
    'analysis_usage_events',
    'public_feedback',
    'credit_packages',
    'credit_purchases',
    'admin_credit_adjustments',
    'user_profiles',
    'extension_tokens',
    'lens_search_events',
    'user_admin_states',
    'user_activity_events',
  ];

  const counts = [];
  for (const table of expectedTables) {
    counts.push(await maybeCount(client, table));
  }

  const shapes = [];
  for (const [table, columns] of [
    ['saved_items', 'id,user_id,import_id,url,content_type,status,platform,platform_key,source_title,source_author,source_description,thumbnail_url,created_at,updated_at'],
    ['processing_jobs', 'id,user_id,import_id,item_id,status,attempts,error,created_at,updated_at'],
    ['item_embeddings', 'item_id,user_id,content,model,created_at'],
    ['user_provider_credentials', 'id,user_id,provider,purpose,model,key_hint,status,is_preferred,created_at,updated_at'],
    ['extension_tokens', 'id,user_id,name,scopes,expires_at,revoked_at,last_used_at,created_at'],
  ]) {
    shapes.push(await sampleColumns(client, table, columns));
  }

  const { data: buckets, error: bucketError } = await client.storage.listBuckets();
  const storage = bucketError
    ? { ok: false, error: `${bucketError.statusCode || 'error'}: ${bucketError.message}` }
    : { ok: true, buckets: buckets.map((bucket) => ({ id: bucket.id, name: bucket.name, public: bucket.public })) };

  const { data: packages, error: packageError } = await client
    .from('credit_packages')
    .select('id,name,credits,amount_cents,currency,active')
    .order('credits');

  const result = {
    project: {
      url: redactUrl(url),
      ref: new URL(url).hostname.split('.')[0],
    },
    counts,
    shapes,
    storage,
    creditPackages: packageError ? { ok: false, error: packageError.message } : { ok: true, rows: packages },
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
