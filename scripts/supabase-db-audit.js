const SUPABASE_API_BASE = 'https://api.supabase.com/v1';

const EXPLAIN_QUERIES = [
  {
    name: 'account_deletion_completed_lookup',
    sql: "explain (format json, analyze false, buffers false) select id from public.account_deletion_audit where status = 'completed' and (user_id_hash = '0000000000000000000000000000000000000000000000000000000000000000' or email_hash = '1111111111111111111111111111111111111111111111111111111111111111') limit 1;",
  },
  {
    name: 'saved_items_first_page',
    sql: "explain (format json, analyze false, buffers false) select id, created_at from public.saved_items where user_id = '00000000-0000-0000-0000-000000000000' order by created_at desc, id asc limit 24;",
  },
  {
    name: 'saved_items_no_ai_candidate_search',
    sql: "explain (format json, analyze false, buffers false) select id from public.saved_items where user_id = '00000000-0000-0000-0000-000000000000' and (caption ilike '%security%' or source_title ilike '%security%' or source_description ilike '%security%' or source_author ilike '%security%' or owner_name ilike '%security%' or owner_username ilike '%security%' or platform ilike '%security%') order by created_at desc limit 300;",
  },
];

const INVENTORY_QUERIES = [
  {
    name: 'rls_policy_inventory',
    sql: `
      select
        n.nspname as schema_name,
        c.relname as table_name,
        c.relrowsecurity as rls_enabled,
        count(p.polname)::int as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'public'
        and c.relkind = 'r'
      group by n.nspname, c.relname, c.relrowsecurity
      order by c.relname;
    `,
  },
  {
    name: 'index_inventory',
    sql: `
      select
        schemaname,
        tablename,
        indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename in ('account_deletion_audit', 'saved_items', 'search_events')
      order by tablename, indexname;
    `,
  },
  {
    name: 'table_stats',
    sql: `
      select
        relname as table_name,
        n_live_tup::bigint as estimated_live_rows,
        n_dead_tup::bigint as estimated_dead_rows,
        seq_scan::bigint as seq_scan,
        idx_scan::bigint as idx_scan
      from pg_stat_user_tables
      where relname in ('account_deletion_audit', 'saved_items', 'search_events')
      order by relname;
    `,
  },
];

function projectRefFromEnv(env = process.env) {
  if (env.SUPABASE_PROJECT_REF) return env.SUPABASE_PROJECT_REF;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const match = String(url || '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] : '';
}

async function runReadOnlyQuery({ token, projectRef, sql, fetchImpl = fetch }) {
  const response = await fetchImpl(`${SUPABASE_API_BASE}/projects/${projectRef}/database/query/read-only`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body?.message || body?.error || response.statusText || 'Supabase read-only query failed';
    const error = new Error(`${response.status} ${message}`);
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function rowsFromBody(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.rows)) return body.rows;
  return [];
}

function summarizePlanBody(body) {
  const rows = rowsFromBody(body);
  const planRoot = rows[0]?.['QUERY PLAN']?.[0]?.Plan || rows[0]?.['QUERY PLAN']?.Plan || rows[0]?.Plan || null;
  if (!planRoot) return { nodeTypes: [], relationNames: [], indexNames: [], totalCost: null, planRows: null };
  const nodeTypes = new Set();
  const relationNames = new Set();
  const indexNames = new Set();
  walkPlan(planRoot, (node) => {
    if (node['Node Type']) nodeTypes.add(node['Node Type']);
    if (node['Relation Name']) relationNames.add(node['Relation Name']);
    if (node['Index Name']) indexNames.add(node['Index Name']);
  });
  return {
    nodeTypes: [...nodeTypes].sort(),
    relationNames: [...relationNames].sort(),
    indexNames: [...indexNames].sort(),
    totalCost: Number.isFinite(planRoot['Total Cost']) ? Math.round(planRoot['Total Cost']) : null,
    planRows: Number.isFinite(planRoot['Plan Rows']) ? planRoot['Plan Rows'] : null,
  };
}

function walkPlan(node, visit) {
  visit(node);
  for (const child of node.Plans || []) walkPlan(child, visit);
}

async function collectSupabaseAudit({ token = process.env.SUPABASE_ACCESS_TOKEN, projectRef = projectRefFromEnv(), fetchImpl = fetch } = {}) {
  if (!token) throw new Error('Missing SUPABASE_ACCESS_TOKEN.');
  if (!projectRef) throw new Error('Missing SUPABASE_PROJECT_REF or SUPABASE_URL.');

  const inventories = {};
  for (const query of INVENTORY_QUERIES) {
    inventories[query.name] = rowsFromBody(await runReadOnlyQuery({ token, projectRef, sql: query.sql, fetchImpl }));
  }

  const plans = [];
  for (const query of EXPLAIN_QUERIES) {
    const body = await runReadOnlyQuery({ token, projectRef, sql: query.sql, fetchImpl });
    plans.push({ name: query.name, ...summarizePlanBody(body) });
  }

  return {
    projectRef,
    inventories,
    plans,
    recommendations: recommendationsFor({ inventories, plans }),
  };
}

function recommendationsFor({ inventories, plans }) {
  const recommendations = [];
  const indexNames = new Set((inventories.index_inventory || []).map((row) => row.indexname));
  const slowSearchPlan = plans.find((plan) => plan.name === 'saved_items_no_ai_candidate_search');
  if (slowSearchPlan && !slowSearchPlan.indexNames.some((name) => /trgm|search/i.test(name))) {
    recommendations.push('Review the draft pg_trgm candidate-search indexes before live apply.');
  }
  if (!indexNames.has('account_deletion_audit_completed_user_hash_idx')) {
    recommendations.push('Review the draft partial account deletion audit hash indexes before live apply.');
  }
  if (!indexNames.has('saved_items_user_created_id_idx')) {
    recommendations.push('Review the draft saved item page ordering index before live apply.');
  }
  return recommendations;
}

function renderAudit(audit) {
  const lines = [];
  lines.push(`Supabase read-only DB audit for project ${audit.projectRef}`);
  lines.push('');
  lines.push('RLS inventory:');
  for (const row of audit.inventories.rls_policy_inventory || []) {
    lines.push(`- public.${row.table_name}: rls=${Boolean(row.rls_enabled)} policies=${Number(row.policy_count || 0)}`);
  }
  lines.push('');
  lines.push('Index inventory for hot tables:');
  for (const row of audit.inventories.index_inventory || []) {
    lines.push(`- public.${row.tablename}: ${row.indexname}`);
  }
  lines.push('');
  lines.push('Aggregate table stats:');
  for (const row of audit.inventories.table_stats || []) {
    lines.push(`- public.${row.table_name}: live~${row.estimated_live_rows} dead~${row.estimated_dead_rows} seq_scan=${row.seq_scan} idx_scan=${row.idx_scan}`);
  }
  lines.push('');
  lines.push('Sanitized query-plan summaries:');
  for (const plan of audit.plans) {
    lines.push(`- ${plan.name}: nodes=${plan.nodeTypes.join(',') || 'unknown'} indexes=${plan.indexNames.join(',') || 'none'} relations=${plan.relationNames.join(',') || 'unknown'} total_cost=${plan.totalCost ?? 'unknown'} plan_rows=${plan.planRows ?? 'unknown'}`);
  }
  lines.push('');
  lines.push('Recommendations:');
  if (audit.recommendations.length) {
    for (const item of audit.recommendations) lines.push(`- ${item}`);
  } else {
    lines.push('- No draft index recommendation changed from the current evidence.');
  }
  return lines.join('\n');
}

async function main() {
  try {
    const audit = await collectSupabaseAudit();
    console.log(renderAudit(audit));
  } catch (error) {
    console.error(`Supabase read-only DB audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  collectSupabaseAudit,
  projectRefFromEnv,
  recommendationsFor,
  renderAudit,
  rowsFromBody,
  summarizePlanBody,
};
