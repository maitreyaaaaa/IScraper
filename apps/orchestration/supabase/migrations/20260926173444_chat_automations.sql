create table if not exists public.automations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  prompt text not null check (char_length(prompt) between 1 and 2000),
  trigger_type text not null check (trigger_type in ('manual', 'schedule')),
  trigger_config jsonb not null default '{}'::jsonb,
  gmail_query text not null default '' check (char_length(gmail_query) <= 300),
  max_messages integer not null default 10 check (max_messages between 1 and 10),
  model text not null default 'openai/gpt-4o-mini',
  status text not null default 'active' check (status in ('active', 'paused')),
  next_run_at timestamptz,
  schedule_lease_until timestamptz,
  schedule_lease_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_schedule_config_check check (
    trigger_type <> 'schedule' or coalesce((trigger_config ->> 'everyMinutes')::integer, 0) between 60 and 43200
  ),
  constraint automations_schedule_state_check check (
    (trigger_type = 'manual' and next_run_at is null and schedule_lease_until is null and schedule_lease_token is null)
    or trigger_type = 'schedule'
  ),
  unique (id, user_id)
);

create table if not exists public.automation_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  automation_id uuid not null,
  trigger_type text not null check (trigger_type in ('manual', 'schedule')),
  status text not null check (status in ('running', 'completed', 'needs_connection', 'failed')),
  summary text not null default '' check (char_length(summary) <= 8000),
  error text not null default '' check (char_length(error) <= 500),
  activity jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (automation_id, user_id) references public.automations(id, user_id) on delete cascade
);

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
revoke all on public.automations from anon, authenticated;
revoke all on public.automation_runs from anon, authenticated;

drop policy if exists "Users own automations" on public.automations;

drop policy if exists "Users own automation runs" on public.automation_runs;

create index if not exists automations_user_updated_idx
  on public.automations(user_id, updated_at desc);
create index if not exists automations_due_idx
  on public.automations(next_run_at, schedule_lease_until)
  where trigger_type = 'schedule' and status = 'active';
create index if not exists automation_runs_user_started_idx
  on public.automation_runs(user_id, automation_id, started_at desc);

create or replace function public.claim_due_automations(p_limit integer default 5)
returns setof public.automations
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select a.id, a.user_id
    from public.automations a
    where a.trigger_type = 'schedule'
      and a.status = 'active'
      and a.next_run_at <= now()
      and (a.schedule_lease_until is null or a.schedule_lease_until <= now())
    order by a.next_run_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 10))
    for update skip locked
  )
  update public.automations a
  set schedule_lease_until = now() + interval '10 minutes',
      schedule_lease_token = gen_random_uuid(),
      updated_at = now()
  from due
  where a.id = due.id and a.user_id = due.user_id
  returning a.*;
end;
$$;

revoke all on function public.claim_due_automations(integer) from public, anon, authenticated;
grant execute on function public.claim_due_automations(integer) to service_role;
