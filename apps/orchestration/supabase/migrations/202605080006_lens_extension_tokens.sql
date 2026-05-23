create table if not exists public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  name text not null default 'Browser extension',
  scopes text[] not null default array['lens:search'],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists extension_tokens_user_idx
on public.extension_tokens(user_id, created_at desc);

create table if not exists public.lens_search_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  query_type text not null check (query_type in ('text', 'image')),
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists lens_search_events_user_idx
on public.lens_search_events(user_id, created_at desc);

alter table public.extension_tokens enable row level security;
alter table public.lens_search_events enable row level security;

drop policy if exists "Users can read own extension tokens" on public.extension_tokens;
create policy "Users can read own extension tokens"
on public.extension_tokens for select
using (auth.uid() = user_id);

drop policy if exists "Users can revoke own extension tokens" on public.extension_tokens;
create policy "Users can revoke own extension tokens"
on public.extension_tokens for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own lens events" on public.lens_search_events;
create policy "Users can read own lens events"
on public.lens_search_events for select
using (auth.uid() = user_id);
