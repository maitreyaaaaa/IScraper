create table if not exists public.capture_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('telegram')),
  external_id text not null,
  token_hash text not null references public.extension_tokens(token_hash) on delete cascade,
  username text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique(provider, external_id)
);

create index if not exists capture_connections_user_idx
on public.capture_connections(user_id, updated_at desc);

create index if not exists capture_connections_provider_external_idx
on public.capture_connections(provider, external_id)
where revoked_at is null;

alter table public.capture_connections enable row level security;

drop policy if exists "Users can read own capture connections" on public.capture_connections;
create policy "Users can read own capture connections"
on public.capture_connections for select
using (auth.uid() = user_id);

drop policy if exists "Users can update own capture connections" on public.capture_connections;
create policy "Users can update own capture connections"
on public.capture_connections for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
