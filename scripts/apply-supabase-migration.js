#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANAGEMENT_API = 'https://api.supabase.com/v1';
const MIGRATION_PATH = path.join(ROOT, 'apps/orchestration/supabase/migrations/202605270002_user_data_exports.sql');
const MIGRATION_NAME = '202605270002_user_data_exports';

for (const envPath of [
  path.join(ROOT, '.env'),
  path.join(ROOT, 'apps/orchestration/.env'),
  path.join(ROOT, 'apps/ui/.env'),
]) {
  if (fs.existsSync(envPath)) loadEnvFile(envPath);
}

async function main() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) throw new Error('SUPABASE_ACCESS_TOKEN is required.');
  const projectRef = resolveProjectRef();
  if (!projectRef) {
    throw new Error('SUPABASE_PROJECT_REF is required when it cannot be derived from SUPABASE_URL or VITE_SUPABASE_URL.');
  }
  if (!fs.existsSync(MIGRATION_PATH)) throw new Error(`Migration file not found: ${MIGRATION_PATH}`);
  const query = fs.readFileSync(MIGRATION_PATH, 'utf8');

  console.log(`Applying ${MIGRATION_NAME} to Supabase project ${projectRef}...`);
  await applyMigration({ accessToken, projectRef, query });
  console.log('Migration apply request completed. Verifying schema...');
  const verification = await verifyMigration({ accessToken, projectRef });
  console.log(JSON.stringify(verification, null, 2));
  if (!verification.ok) {
    throw new Error('Migration verification failed.');
  }
}

function resolveProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF.trim();
  return projectRefFromUrl(process.env.SUPABASE_URL) || projectRefFromUrl(process.env.VITE_SUPABASE_URL);
}

function projectRefFromUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const [ref] = parsed.hostname.split('.');
    return /^[a-z0-9]{20}$/.test(ref) ? ref : '';
  } catch {
    return '';
  }
}

function loadEnvFile(envPath) {
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key] != null) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function applyMigration({ accessToken, projectRef, query }) {
  const response = await fetch(`${MANAGEMENT_API}/projects/${projectRef}/database/migrations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: MIGRATION_NAME, query }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase migration API failed with ${response.status}: ${safeApiMessage(body)}`);
  }
}

async function verifyMigration({ accessToken, projectRef }) {
  const query = `
select
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'public_ref') as users_public_ref,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'updated_at') as users_updated_at,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'last_seen_at') as users_last_seen_at,
  to_regclass('public.user_data_export_requests') is not null as export_requests_table,
  to_regclass('public.user_data_export_steps') is not null as export_steps_table,
  exists(select 1 from storage.buckets where id = 'user-data-exports' and public = false) as export_bucket,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'users_public_ref_unique_idx') as public_ref_index,
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'user_data_export_requests') as request_policies,
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'user_data_export_steps') as step_policies;
`;
  const response = await fetch(`${MANAGEMENT_API}/projects/${projectRef}/database/query/read-only`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase verification query failed with ${response.status}: ${safeApiMessage(body)}`);
  }
  const body = await response.json().catch(() => ({}));
  const row = Array.isArray(body) ? body[0] : body.result?.[0] || body.data?.[0] || body;
  const checks = {
    usersPublicRef: Boolean(row.users_public_ref),
    usersUpdatedAt: Boolean(row.users_updated_at),
    usersLastSeenAt: Boolean(row.users_last_seen_at),
    exportRequestsTable: Boolean(row.export_requests_table),
    exportStepsTable: Boolean(row.export_steps_table),
    exportBucket: Boolean(row.export_bucket),
    publicRefIndex: Boolean(row.public_ref_index),
    requestPolicies: Boolean(row.request_policies),
    stepPolicies: Boolean(row.step_policies),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

function safeApiMessage(value) {
  return String(value || '')
    .replace(/sbp_[a-zA-Z0-9_-]+/g, '[redacted-token]')
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
    .slice(0, 800);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
