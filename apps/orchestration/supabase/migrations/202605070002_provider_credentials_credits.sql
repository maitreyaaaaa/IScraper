create table if not exists public.user_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('openrouter', 'openai', 'anthropic', 'deepseek', 'gemini', 'glm')),
  purpose text not null check (purpose in ('text', 'media', 'embedding')),
  model text not null,
  encrypted_key text not null,
  key_hint text not null,
  status text not null default 'active' check (status in ('active', 'disabled', 'failed')),
  is_preferred boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, purpose)
);

create table if not exists public.user_credit_accounts (
  user_id uuid primary key references public.users(id) on delete cascade,
  free_items_limit integer not null default 200,
  paid_credits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount integer not null,
  reason text not null,
  item_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.analysis_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_id text not null,
  source text not null check (source in ('free', 'paid', 'byok')),
  provider text,
  model text,
  created_at timestamptz not null default now(),
  unique (user_id, item_id, source)
);

alter table public.user_provider_credentials enable row level security;
alter table public.user_credit_accounts enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.analysis_usage_events enable row level security;

drop policy if exists "Users own provider credentials" on public.user_provider_credentials;
create policy "Users own provider credentials"
on public.user_provider_credentials for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users own credit account" on public.user_credit_accounts;
create policy "Users own credit account"
on public.user_credit_accounts for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users own credit transactions" on public.credit_transactions;
create policy "Users own credit transactions"
on public.credit_transactions for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users own analysis usage" on public.analysis_usage_events;
create policy "Users own analysis usage"
on public.analysis_usage_events for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index if not exists user_provider_credentials_user_purpose_idx
on public.user_provider_credentials(user_id, purpose, status, is_preferred);

create index if not exists analysis_usage_events_user_source_idx
on public.analysis_usage_events(user_id, source);

create index if not exists credit_transactions_user_created_idx
on public.credit_transactions(user_id, created_at desc);

alter table public.processing_jobs drop constraint if exists processing_jobs_status_check;
alter table public.processing_jobs
  add constraint processing_jobs_status_check
  check (status in (
    'queued',
    'downloading',
    'analyzing',
    'done',
    'failed',
    'paused_needs_billing',
    'paused_api_limit',
    'paused_missing_provider'
  ));

insert into public.user_credit_accounts (user_id)
select id from public.users
on conflict (user_id) do nothing;
