alter table public.account_deletion_requests
drop constraint if exists account_deletion_requests_status_check;

alter table public.account_deletion_requests
add column if not exists logged_at timestamptz;

alter table public.account_deletion_requests
add constraint account_deletion_requests_status_check check (status in (
  'requested',
  'frozen',
  'pending_approval',
  'approved',
  'executing',
  'completed',
  'failed',
  'logged',
  'partially_failed',
  'canceled'
));

drop index if exists account_deletion_active_user_idx;
create unique index if not exists account_deletion_active_user_idx
on public.account_deletion_requests(user_id)
where status in ('requested', 'frozen', 'pending_approval', 'approved', 'executing', 'failed', 'partially_failed');

create table if not exists public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_type text not null default 'system',
  target_user_id uuid,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  result text not null default 'success' check (result in ('success', 'failure', 'denied')),
  request_id text,
  route text,
  method text,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_audit_events_target_created_idx
on public.security_audit_events(target_user_id, created_at desc);

create index if not exists security_audit_events_type_created_idx
on public.security_audit_events(event_type, created_at desc);

create index if not exists security_audit_events_severity_created_idx
on public.security_audit_events(severity, created_at desc);

create index if not exists security_audit_events_request_idx
on public.security_audit_events(request_id)
where request_id is not null;

alter table public.security_audit_events enable row level security;
revoke all on public.security_audit_events from anon, authenticated;
