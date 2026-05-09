create table if not exists public.user_admin_states (
  user_id uuid primary key references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'blocked')),
  blocked_at timestamptz,
  blocked_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.user_admin_states enable row level security;
alter table public.user_activity_events enable row level security;

create index if not exists user_admin_states_status_idx
on public.user_admin_states(status);

create index if not exists user_activity_events_user_created_idx
on public.user_activity_events(user_id, created_at desc);

create index if not exists user_activity_events_type_created_idx
on public.user_activity_events(event_type, created_at desc);
