create table if not exists public.request_rate_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('ai_search', 'automation_generation', 'automation_run', 'workflow_generation', 'media_analysis', 'semantic_embedding')),
  minute_window_start timestamptz not null,
  minute_count integer not null default 0 check (minute_count >= 0),
  day_window_start timestamptz not null,
  daily_count integer not null default 0 check (daily_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);

alter table public.request_rate_budgets enable row level security;
revoke all on public.request_rate_budgets from public;
revoke all on table public.request_rate_budgets from anon, authenticated;

create or replace function public.consume_request_rate_budget(
  p_user_id uuid,
  p_scope text,
  p_minute_limit integer,
  p_daily_limit integer,
  p_now timestamptz default now()
)
returns table (
  allowed boolean,
  retry_at timestamptz,
  exceeded text,
  minute_count integer,
  daily_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minute_start timestamptz;
  v_day_start timestamptz;
  v_minute_count integer;
  v_daily_count integer;
  v_minute_exceeded boolean;
  v_day_exceeded boolean;
  v_retry_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;
  if p_scope not in ('ai_search', 'automation_generation', 'automation_run', 'workflow_generation', 'media_analysis', 'semantic_embedding') then
    raise exception 'unsupported rate budget scope' using errcode = '22023';
  end if;
  if p_minute_limit is null or p_minute_limit < 1 or p_minute_limit > 1000000
    or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 1000000 then
    raise exception 'rate budget limits must be positive and bounded' using errcode = '22023';
  end if;

  v_minute_start := date_trunc('minute', p_now at time zone 'UTC') at time zone 'UTC';
  v_day_start := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';

  insert into public.request_rate_budgets
    (user_id, scope, minute_window_start, minute_count, day_window_start, daily_count, updated_at)
  values (p_user_id, p_scope, v_minute_start, 0, v_day_start, 0, p_now)
  on conflict (user_id, scope) do nothing;

  select
    case when minute_window_start = v_minute_start then minute_count else 0 end,
    case when day_window_start = v_day_start then daily_count else 0 end
  into v_minute_count, v_daily_count
  from public.request_rate_budgets
  where user_id = p_user_id and scope = p_scope
  for update;

  v_minute_exceeded := v_minute_count >= p_minute_limit;
  v_day_exceeded := v_daily_count >= p_daily_limit;

  if not (v_minute_exceeded or v_day_exceeded) then
    v_minute_count := v_minute_count + 1;
    v_daily_count := v_daily_count + 1;
  end if;

  update public.request_rate_budgets
  set minute_window_start = v_minute_start,
      minute_count = v_minute_count,
      day_window_start = v_day_start,
      daily_count = v_daily_count,
      updated_at = p_now
  where user_id = p_user_id and scope = p_scope;

  if v_minute_exceeded then
    v_retry_at := v_minute_start + interval '1 minute';
  end if;
  if v_day_exceeded then
    v_retry_at := greatest(coalesce(v_retry_at, v_day_start), v_day_start + interval '1 day');
  end if;

  return query select
    not (v_minute_exceeded or v_day_exceeded),
    v_retry_at,
    case
      when v_minute_exceeded and v_day_exceeded then 'minute_and_day'
      when v_minute_exceeded then 'minute'
      when v_day_exceeded then 'day'
      else null
    end,
    v_minute_count,
    v_daily_count;
end;
$$;

revoke all on function public.consume_request_rate_budget(uuid, text, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_request_rate_budget(uuid, text, integer, integer, timestamptz)
  to service_role;

alter table public.automation_runs drop constraint if exists automation_runs_status_check;
alter table public.automation_runs add constraint automation_runs_status_check
  check (status in ('running', 'completed', 'needs_connection', 'failed', 'rate_limited'));

create or replace function public.claim_processing_jobs(
  p_user_id uuid,
  p_import_id uuid default null,
  p_limit integer default 5,
  p_lease_owner text default 'worker',
  p_lease_token text default null,
  p_lease_expires_at timestamptz default now() + interval '15 minutes',
  p_per_user_concurrency integer default 1,
  p_max_attempts integer default 3
)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  if (
    select count(*)
    from public.processing_jobs as active
    where active.user_id = p_user_id
      and active.status in ('downloading', 'analyzing')
      and active.lease_expires_at > now()
  ) >= greatest(1, least(coalesce(p_per_user_concurrency, 1), 10)) then
    return;
  end if;

  return query
  with candidates as (
    select jobs.id
    from public.processing_jobs as jobs
    where jobs.user_id = p_user_id
      and (p_import_id is null or jobs.import_id = p_import_id)
      and jobs.attempts < greatest(1, least(coalesce(p_max_attempts, 3), 20))
      and (
        (
          jobs.status = 'queued'
          and (jobs.next_attempt_at is null or jobs.next_attempt_at <= now())
        )
        or (
          jobs.status in ('downloading', 'analyzing')
          and (jobs.lease_expires_at is null or jobs.lease_expires_at <= now())
          and (jobs.next_attempt_at is null or jobs.next_attempt_at <= now())
        )
      )
    order by jobs.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 100))
  )
  update public.processing_jobs as jobs
  set
    status = 'downloading',
    attempts = jobs.attempts + 1,
    error = null,
    lease_owner = p_lease_owner,
    lease_token = coalesce(p_lease_token, gen_random_uuid()::text),
    lease_expires_at = p_lease_expires_at,
    next_attempt_at = null,
    claimed_at = now(),
    completed_at = null,
    last_error_at = null,
    updated_at = now()
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_processing_jobs(uuid, uuid, integer, text, text, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_processing_jobs(uuid, uuid, integer, text, text, timestamptz, integer, integer)
  to service_role;

create or replace function public.record_paid_analysis_usage(
  p_user_id uuid,
  p_item_id text,
  p_provider text,
  p_model text
)
returns table (
  recorded boolean,
  already_recorded boolean,
  paid_credits integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_id uuid;
  v_paid_credits integer;
begin
  if p_user_id is null or nullif(btrim(p_item_id), '') is null then
    raise exception 'user and item are required' using errcode = '22023';
  end if;

  insert into public.analysis_usage_events (user_id, item_id, source, provider, model)
  values (p_user_id, p_item_id, 'paid', p_provider, p_model)
  on conflict (user_id, item_id, source) do nothing
  returning id into v_usage_id;

  if v_usage_id is null then
    select account.paid_credits
    into v_paid_credits
    from public.user_credit_accounts as account
    where account.user_id = p_user_id;
    return query select false, true, coalesce(v_paid_credits, 0);
    return;
  end if;

  update public.user_credit_accounts as account
  set paid_credits = account.paid_credits - 1,
      updated_at = now()
  where account.user_id = p_user_id
    and account.paid_credits > 0
  returning account.paid_credits into v_paid_credits;

  if not found then
    delete from public.analysis_usage_events as usage
    where usage.id = v_usage_id;
    return query select false, false, 0;
    return;
  end if;

  insert into public.credit_transactions (user_id, amount, reason, item_id, metadata)
  values (
    p_user_id,
    -1,
    'item_analysis',
    p_item_id,
    jsonb_build_object('provider', p_provider, 'model', p_model)
  );

  insert into public.user_activity_events (user_id, event_type, metadata)
  values
    (p_user_id, 'analysis_used', jsonb_build_object('itemId', p_item_id, 'source', 'paid', 'provider', p_provider, 'model', p_model)),
    (p_user_id, 'credit_changed', jsonb_build_object('amount', -1, 'reason', 'item_analysis', 'itemId', p_item_id));

  return query select true, false, v_paid_credits;
end;
$$;

revoke all on function public.record_paid_analysis_usage(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_paid_analysis_usage(uuid, text, text, text)
  to service_role;
