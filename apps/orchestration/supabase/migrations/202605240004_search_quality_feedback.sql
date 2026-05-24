create table if not exists public.search_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  query text,
  query_length integer not null default 0,
  filters jsonb not null default '{}'::jsonb,
  result_count integer not null default 0,
  include_ai boolean not null default false,
  result_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.search_result_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  search_event_id uuid not null references public.search_events(id) on delete cascade,
  item_id text not null,
  rating text not null check (rating in ('helpful', 'not_helpful')),
  reason text,
  created_at timestamptz not null default now(),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

alter table public.search_events enable row level security;
alter table public.search_result_feedback enable row level security;

create policy "Users own search events" on public.search_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users own search result feedback" on public.search_result_feedback
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists search_events_user_created_idx on public.search_events(user_id, created_at desc);
create index if not exists search_events_user_no_results_idx on public.search_events(user_id, created_at desc)
  where result_count = 0 and coalesce(query, '') <> '';
create index if not exists search_result_feedback_user_event_idx on public.search_result_feedback(user_id, search_event_id);
create index if not exists search_result_feedback_user_item_idx on public.search_result_feedback(user_id, item_id);
