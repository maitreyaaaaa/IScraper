alter table public.processing_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_error_at timestamptz;

alter table public.imports
  add column if not exists storage_files jsonb not null default '[]'::jsonb,
  add column if not exists error text;

create index if not exists imports_status_created_idx
on public.imports(status, created_at)
where status = 'queued_storage';

create index if not exists processing_jobs_claimable_idx
on public.processing_jobs(status, lease_expires_at, created_at);

create index if not exists processing_jobs_user_active_lease_idx
on public.processing_jobs(user_id, status, lease_expires_at)
where status in ('downloading', 'analyzing');

create or replace function public.list_processable_job_scopes(
  p_limit integer default 20,
  p_per_user_concurrency integer default 1
)
returns table(user_id uuid, import_id uuid, waiting_count bigint)
language sql
security definer
set search_path = public
as $$
  with processable as (
    select jobs.user_id, jobs.import_id, jobs.created_at
    from public.processing_jobs jobs
    where (
      jobs.status = 'queued'
      or (
        jobs.status in ('downloading', 'analyzing')
        and (jobs.lease_expires_at is null or jobs.lease_expires_at <= now())
      )
    )
    and (
      select count(*)
      from public.processing_jobs active
      where active.user_id = jobs.user_id
        and active.status in ('downloading', 'analyzing')
        and active.lease_expires_at > now()
    ) < greatest(1, least(coalesce(p_per_user_concurrency, 1), 10))
  )
  select processable.user_id, processable.import_id, count(*) as waiting_count
  from processable
  group by processable.user_id, processable.import_id
  order by min(processable.created_at)
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

create or replace function public.claim_processing_jobs(
  p_user_id uuid,
  p_import_id uuid default null,
  p_limit integer default 5,
  p_lease_owner text default 'worker',
  p_lease_expires_at timestamptz default now() + interval '15 minutes',
  p_per_user_concurrency integer default 1
)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.processing_jobs active
    where active.user_id = p_user_id
      and active.status in ('downloading', 'analyzing')
      and active.lease_expires_at > now()
  ) >= greatest(1, least(coalesce(p_per_user_concurrency, 1), 10)) then
    return;
  end if;

  return query
  with candidates as (
    select jobs.id
    from public.processing_jobs jobs
    where jobs.user_id = p_user_id
      and (p_import_id is null or jobs.import_id = p_import_id)
      and (
        jobs.status = 'queued'
        or (
          jobs.status in ('downloading', 'analyzing')
          and (jobs.lease_expires_at is null or jobs.lease_expires_at <= now())
        )
      )
    order by jobs.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 100))
  )
  update public.processing_jobs jobs
  set
    status = 'downloading',
    attempts = jobs.attempts + 1,
    error = null,
    lease_owner = p_lease_owner,
    lease_expires_at = p_lease_expires_at,
    claimed_at = now(),
    completed_at = null,
    last_error_at = null,
    updated_at = now()
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

revoke all on function public.list_processable_job_scopes(integer, integer) from public, anon, authenticated;
revoke all on function public.claim_processing_jobs(uuid, uuid, integer, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_processable_job_scopes(integer, integer) to service_role;
grant execute on function public.claim_processing_jobs(uuid, uuid, integer, text, timestamptz, integer) to service_role;
