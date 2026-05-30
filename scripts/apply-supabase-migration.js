#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANAGEMENT_API = 'https://api.supabase.com/v1';
const migrationArg = process.argv[2] || process.env.MIGRATION_PATH || 'apps/orchestration/supabase/migrations/202605270002_user_data_exports.sql';
const MIGRATION_PATH = path.isAbsolute(migrationArg) ? migrationArg : path.join(ROOT, migrationArg);
const MIGRATION_NAME = process.env.MIGRATION_NAME || path.basename(MIGRATION_PATH, '.sql');

for (const envPath of [
  path.join(ROOT, '.env'),
  path.join(ROOT, '.vercel/.env.production.local'),
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
  const verification = await verifyMigration({ accessToken, projectRef, migrationName: MIGRATION_NAME });
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

async function verifyMigration({ accessToken, projectRef, migrationName }) {
  if (migrationName === '202605270003_security_audit_timeline') {
    return verifySecurityAuditTimelineMigration({ accessToken, projectRef });
  }
  if (migrationName === '202605270004_tenant_isolation_classification') {
    return verifyTenantIsolationMigration({ accessToken, projectRef });
  }
  if (migrationName === '202605270005_request_correlation_ai_notice') {
    return verifyRequestCorrelationMigration({ accessToken, projectRef });
  }
  if (migrationName === '202605300001_user_onboarding_preferences') {
    return verifyOnboardingPreferencesMigration({ accessToken, projectRef });
  }
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

async function verifyOnboardingPreferencesMigration({ accessToken, projectRef }) {
  const query = `
select
  to_regclass('public.user_onboarding_preferences') is not null as onboarding_table,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_onboarding_preferences' and column_name = 'user_id') as user_id_column,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_onboarding_preferences' and column_name = 'content_types') as content_types_column,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_onboarding_preferences' and column_name = 'referral_source') as referral_source_column,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_onboarding_preferences' and column_name = 'completed_at') as completed_at_column,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_onboarding_preferences' and column_name = 'skipped_at') as skipped_at_column,
  exists(select 1 from pg_constraint where conname = 'user_onboarding_preferences_content_types_allowed') as content_types_constraint,
  exists(select 1 from pg_constraint where conname = 'user_onboarding_preferences_referral_source_allowed') as referral_source_constraint,
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'user_onboarding_preferences' and policyname = 'Users can read own onboarding preferences') as read_policy,
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'user_onboarding_preferences' and policyname = 'Users can create own onboarding preferences') as insert_policy,
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'user_onboarding_preferences' and policyname = 'Users can update own onboarding preferences') as update_policy;
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
    onboardingTable: Boolean(row.onboarding_table),
    userIdColumn: Boolean(row.user_id_column),
    contentTypesColumn: Boolean(row.content_types_column),
    referralSourceColumn: Boolean(row.referral_source_column),
    completedAtColumn: Boolean(row.completed_at_column),
    skippedAtColumn: Boolean(row.skipped_at_column),
    contentTypesConstraint: Boolean(row.content_types_constraint),
    referralSourceConstraint: Boolean(row.referral_source_constraint),
    readPolicy: Boolean(row.read_policy),
    insertPolicy: Boolean(row.insert_policy),
    updatePolicy: Boolean(row.update_policy),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

async function verifyTenantIsolationMigration({ accessToken, projectRef }) {
  const query = `
select
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_deletion_steps' and column_name = 'user_id') as deletion_steps_user_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_data_export_steps' and column_name = 'user_id') as export_steps_user_id,
  exists(select 1 from pg_constraint where conname = 'account_deletion_steps_user_id_fkey') as deletion_steps_user_fk,
  exists(select 1 from pg_constraint where conname = 'user_data_export_steps_user_id_fkey') as export_steps_user_fk,
  exists(select 1 from pg_constraint where conname = 'smart_collection_items_user_collection_fkey') as smart_collection_tenant_fk,
  exists(select 1 from pg_constraint where conname = 'search_result_feedback_user_event_fkey') as search_feedback_tenant_fk,
  exists(select 1 from pg_constraint where conname = 'analysis_usage_events_user_item_fkey') as analysis_usage_tenant_fk,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'account_deletion_steps_user_request_idx') as deletion_step_user_index,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'user_data_export_steps_user_request_idx') as export_step_user_index,
  exists(select 1 from storage.buckets where id = 'instagram-assets' and public = false) as instagram_assets_private,
  exists(select 1 from storage.buckets where id = 'import-uploads' and public = false) as import_uploads_private,
  exists(select 1 from storage.buckets where id = 'user-data-exports' and public = false) as exports_private;
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
    deletionStepsUserId: Boolean(row.deletion_steps_user_id),
    exportStepsUserId: Boolean(row.export_steps_user_id),
    deletionStepsUserFk: Boolean(row.deletion_steps_user_fk),
    exportStepsUserFk: Boolean(row.export_steps_user_fk),
    smartCollectionTenantFk: Boolean(row.smart_collection_tenant_fk),
    searchFeedbackTenantFk: Boolean(row.search_feedback_tenant_fk),
    analysisUsageTenantFk: Boolean(row.analysis_usage_tenant_fk),
    deletionStepUserIndex: Boolean(row.deletion_step_user_index),
    exportStepUserIndex: Boolean(row.export_step_user_index),
    instagramAssetsPrivate: Boolean(row.instagram_assets_private),
    importUploadsPrivate: Boolean(row.import_uploads_private),
    exportsPrivate: Boolean(row.exports_private),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

async function verifyRequestCorrelationMigration({ accessToken, projectRef }) {
  const query = `
select
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'imports' and column_name = 'request_id') as imports_request_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'imports' and column_name = 'correlation_id') as imports_correlation_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'request_id') as jobs_request_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'correlation_id') as jobs_correlation_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'source_action') as jobs_source_action,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_data_export_requests' and column_name = 'request_id') as exports_request_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_data_export_requests' and column_name = 'correlation_id') as exports_correlation_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_deletion_requests' and column_name = 'request_id') as deletion_request_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_deletion_requests' and column_name = 'correlation_id') as deletion_correlation_id,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'security_audit_events' and column_name = 'correlation_id') as audit_correlation_id,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'imports_correlation_idx') as imports_correlation_idx,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'processing_jobs_correlation_idx') as jobs_correlation_idx,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'user_data_export_requests_correlation_idx') as exports_correlation_idx,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'account_deletion_requests_correlation_idx') as deletion_correlation_idx,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'security_audit_events_correlation_idx') as audit_correlation_idx;
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
    importsRequestId: Boolean(row.imports_request_id),
    importsCorrelationId: Boolean(row.imports_correlation_id),
    jobsRequestId: Boolean(row.jobs_request_id),
    jobsCorrelationId: Boolean(row.jobs_correlation_id),
    jobsSourceAction: Boolean(row.jobs_source_action),
    exportsRequestId: Boolean(row.exports_request_id),
    exportsCorrelationId: Boolean(row.exports_correlation_id),
    deletionRequestId: Boolean(row.deletion_request_id),
    deletionCorrelationId: Boolean(row.deletion_correlation_id),
    auditCorrelationId: Boolean(row.audit_correlation_id),
    importsCorrelationIndex: Boolean(row.imports_correlation_idx),
    jobsCorrelationIndex: Boolean(row.jobs_correlation_idx),
    exportsCorrelationIndex: Boolean(row.exports_correlation_idx),
    deletionCorrelationIndex: Boolean(row.deletion_correlation_idx),
    auditCorrelationIndex: Boolean(row.audit_correlation_idx),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

async function verifySecurityAuditTimelineMigration({ accessToken, projectRef }) {
  const query = `
select
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_deletion_requests' and column_name = 'logged_at') as deletion_logged_at,
  to_regclass('public.security_audit_events') is not null as security_audit_table,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'security_audit_events_target_created_idx') as audit_target_index,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'security_audit_events_type_created_idx') as audit_type_index,
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'account_deletion_active_user_idx') as deletion_active_index,
  exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'security_audit_events' and rowsecurity = true) as audit_rls_enabled;
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
    deletionLoggedAt: Boolean(row.deletion_logged_at),
    securityAuditTable: Boolean(row.security_audit_table),
    auditTargetIndex: Boolean(row.audit_target_index),
    auditTypeIndex: Boolean(row.audit_type_index),
    deletionActiveIndex: Boolean(row.deletion_active_index),
    auditRlsEnabled: Boolean(row.audit_rls_enabled),
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
