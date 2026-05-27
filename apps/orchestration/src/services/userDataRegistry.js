const USER_DATA_CATEGORIES = [
  {
    key: 'account',
    label: 'Account',
    description: 'Login identity, profile, account state, and support reference.',
    sensitivity: 'account',
    exportPath: 'account/profile.json',
    retention: 'Kept while the account exists. Minimal deletion audit records may remain after deletion.',
    deletion: 'Profile and account rows are deleted during approved account deletion.',
    tables: ['users', 'user_profiles', 'user_admin_states'],
    redaction: 'Exports do not include auth sessions, passwords, or internal admin credentials.',
  },
  {
    key: 'library',
    label: 'Saved library',
    description: 'Saved links, notes, imported saves, collections, smart collections, reminders, and page-archive metadata.',
    sensitivity: 'private_content',
    exportPath: 'library/*.json',
    retention: 'Kept until the user deletes saves or the account is deleted.',
    deletion: 'Deleted during approved account deletion.',
    tables: ['saved_items', 'imports', 'collections', 'smart_collections', 'smart_collection_items', 'item_assets', 'item_archives', 'link_health_checks', 'item_reminders'],
    redaction: 'Raw uploaded media files are not included in this phase; asset metadata is exported.',
  },
  {
    key: 'activity',
    label: 'Activity',
    description: 'Search history, result feedback, and support-safe account activity events.',
    sensitivity: 'behavioral',
    exportPath: 'activity/*.json',
    retention: 'Kept for product quality, support, and account safety until deletion or retention cleanup.',
    deletion: 'Deleted during approved account deletion unless retained as minimal security audit evidence.',
    tables: ['search_events', 'search_result_feedback', 'user_activity_events', 'lens_search_events'],
    redaction: 'Security hashes, request headers, and tokens are not exported.',
  },
  {
    key: 'ai',
    label: 'AI usage',
    description: 'AI enrichment usage records and non-secret model/provider metadata.',
    sensitivity: 'usage',
    exportPath: 'ai/analysis-usage.json',
    retention: 'Kept for credit accounting and usage visibility.',
    deletion: 'Deleted with account profile data during approved account deletion.',
    tables: ['analysis_usage_events'],
    redaction: 'Provider API responses and secrets are not exported.',
  },
  {
    key: 'access',
    label: 'Connected access',
    description: 'Provider key metadata, extension tokens, agent tokens, and capture connections.',
    sensitivity: 'credential_metadata',
    exportPath: 'access/*.json',
    retention: 'Kept until the user revokes/deletes the connection or the account is deleted.',
    deletion: 'Credentials and tokens are revoked/deleted during approved account deletion.',
    tables: ['user_provider_credentials', 'user_ai_keys', 'extension_tokens', 'capture_connections'],
    redaction: 'Encrypted keys, raw tokens, token hashes, and one-time secrets are never exported.',
  },
  {
    key: 'billing',
    label: 'Credits and billing',
    description: 'Credit balances, credit transactions, purchases, and admin credit adjustments.',
    sensitivity: 'billing',
    exportPath: 'billing/credits.json',
    retention: 'Credit records are kept for support and accounting. Completed purchases may be retained as required.',
    deletion: 'Non-retained credit rows are deleted during approved account deletion.',
    tables: ['user_credit_accounts', 'credit_transactions', 'credit_purchases', 'admin_credit_adjustments'],
    redaction: 'Payment processor secrets and full payment instrument data are not stored or exported by IScraper.',
  },
  {
    key: 'privacy',
    label: 'Privacy requests',
    description: 'Account deletion request status and export request history.',
    sensitivity: 'privacy_request',
    exportPath: 'privacy/deletion-request.json',
    retention: 'Deletion audit records may remain in minimal hashed form after deletion.',
    deletion: 'Active request state is finalized; minimal audit evidence may remain.',
    tables: ['account_deletion_requests', 'account_deletion_steps', 'account_deletion_audit', 'user_data_export_requests', 'user_data_export_steps'],
    redaction: 'Internal deletion hashes and admin-only notes are not exported.',
  },
];

const EXCLUDED_USER_DATA_TABLES = [
  { table: 'account_deletion_audit', reason: 'Retained audit table; user export excludes internal hashes.' },
  { table: 'item_embeddings', reason: 'Derived vector data is not useful to users and may be large.' },
  { table: 'processing_jobs', reason: 'Operational queue state is not part of user data export.' },
];

function getUserDataCategories() {
  return USER_DATA_CATEGORIES.map((category) => ({ ...category, tables: [...category.tables] }));
}

function getUserDataMap() {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    categories: getUserDataCategories(),
    excluded: EXCLUDED_USER_DATA_TABLES,
  };
}

module.exports = {
  EXCLUDED_USER_DATA_TABLES,
  USER_DATA_CATEGORIES,
  getUserDataCategories,
  getUserDataMap,
};
