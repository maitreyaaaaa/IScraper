create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  user_id_hash text not null,
  email_hash text not null,
  status text not null default 'pending_approval' check (status in (
    'requested',
    'pending_approval',
    'approved',
    'executing',
    'completed',
    'partially_failed',
    'canceled'
  )),
  reason text,
  export_confirmed boolean not null default false,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  executing_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  admin_actor text,
  status_message text,
  retention_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists account_deletion_active_user_idx
on public.account_deletion_requests(user_id)
where status in ('requested', 'pending_approval', 'approved', 'executing', 'partially_failed');

create index if not exists account_deletion_requests_status_idx
on public.account_deletion_requests(status, requested_at desc);

create index if not exists account_deletion_requests_hash_idx
on public.account_deletion_requests(user_id_hash, email_hash);

create table if not exists public.account_deletion_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_deletion_requests(id) on delete cascade,
  step_key text not null check (step_key in (
    'freeze_access',
    'remove_storage',
    'delete_content',
    'delete_access',
    'delete_profile',
    'delete_auth',
    'finalize'
  )),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  redacted_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, step_key)
);

create index if not exists account_deletion_steps_request_idx
on public.account_deletion_steps(request_id, step_key);

create table if not exists public.account_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  user_id_hash text not null,
  email_hash text not null,
  status text not null,
  actor text not null,
  retained_categories text[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_deletion_audit_hash_idx
on public.account_deletion_audit(user_id_hash, email_hash, status);

alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_steps enable row level security;
alter table public.account_deletion_audit enable row level security;

drop policy if exists "Users read own deletion request" on public.account_deletion_requests;
create policy "Users read own deletion request"
on public.account_deletion_requests for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users read own deletion steps" on public.account_deletion_steps;
create policy "Users read own deletion steps"
on public.account_deletion_steps for select to authenticated
using (
  exists (
    select 1
    from public.account_deletion_requests requests
    where requests.id = account_deletion_steps.request_id
      and requests.user_id = (select auth.uid())
  )
);

revoke all on public.account_deletion_audit from anon, authenticated;

alter table public.credit_purchases alter column user_id drop not null;

alter table public.credit_purchases
drop constraint if exists credit_purchases_user_id_fkey;

alter table public.credit_purchases
add constraint credit_purchases_user_id_fkey
foreign key (user_id) references public.users(id) on delete set null;
