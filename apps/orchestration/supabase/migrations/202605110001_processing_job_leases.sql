alter table public.processing_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_error_at timestamptz;

alter table public.imports
  add column if not exists storage_files jsonb not null default '[]'::jsonb,
  add column if not exists error text;

create index if not exists processing_jobs_claimable_idx
on public.processing_jobs(user_id, import_id, status, created_at)
where status in ('queued', 'failed', 'downloading', 'analyzing');

create index if not exists processing_jobs_active_lease_idx
on public.processing_jobs(user_id, lease_expires_at)
where lease_expires_at is not null and status in ('queued', 'failed', 'downloading', 'analyzing');

create index if not exists imports_queued_storage_idx
on public.imports(status, created_at)
where status = 'queued_storage';

create or replace function public.list_processable_job_scopes(
  p_limit integer default 20,
  p_per_user_concurrency integer default 1
)
returns table (
  user_id uuid,
  import_id uuid,
  queued_count bigint
)
language sql
security definer
set search_path = public
as $$
  with active_users as (
    select processing_jobs.user_id, count(*)::integer as active_count
    from public.processing_jobs
    where status in ('queued', 'failed', 'downloading', 'analyzing')
      and lease_expires_at is not null
      and lease_expires_at > now()
    group by processing_jobs.user_id
  ),
  claimable as (
    select j.*
    from public.processing_jobs j
    left join active_users a on a.user_id = j.user_id
    where coalesce(a.active_count, 0) < greatest(p_per_user_concurrency, 1)
      and (
        j.status in ('queued', 'failed')
        or (
          j.status in ('downloading', 'analyzing')
          and (j.lease_expires_at is null or j.lease_expires_at <= now())
        )
      )
  )
  select claimable.user_id, claimable.import_id, count(*) as queued_count
  from claimable
  group by claimable.user_id, claimable.import_id
  order by min(claimable.created_at)
  limit greatest(p_limit, 1);
$$;

create or replace function public.claim_processing_jobs(
  p_user_id uuid,
  p_import_id uuid default null,
  p_limit integer default 5,
  p_lease_owner text default 'vm-worker',
  p_lease_ms integer default 900000,
  p_per_user_concurrency integer default 1
)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
begin
  select count(*)::integer into active_count
  from public.processing_jobs
  where user_id = p_user_id
    and status in ('queued', 'failed', 'downloading', 'analyzing')
    and lease_expires_at is not null
    and lease_expires_at > now();

  if active_count >= greatest(p_per_user_concurrency, 1) then
    return;
  end if;

  return query
  with candidates as (
    select id
    from public.processing_jobs
    where user_id = p_user_id
      and (p_import_id is null or import_id = p_import_id)
      and (
        status in ('queued', 'failed')
        or (
          status in ('downloading', 'analyzing')
          and (lease_expires_at is null or lease_expires_at <= now())
        )
      )
    order by created_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.processing_jobs jobs
  set lease_owner = coalesce(nullif(p_lease_owner, ''), 'vm-worker'),
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_ms, 1000) / 1000.0),
      claimed_at = now(),
      completed_at = null,
      updated_at = now()
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

revoke all on function public.list_processable_job_scopes(integer, integer) from public;
revoke all on function public.claim_processing_jobs(uuid, uuid, integer, text, integer, integer) from public;
grant execute on function public.list_processable_job_scopes(integer, integer) to service_role;
grant execute on function public.claim_processing_jobs(uuid, uuid, integer, text, integer, integer) to service_role;
