create table if not exists public.smart_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  source_type text not null default 'auto',
  pinned boolean not null default false,
  hidden boolean not null default false,
  generation_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table if not exists public.smart_collection_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  collection_id uuid not null references public.smart_collections(id) on delete cascade,
  item_id text not null,
  confidence numeric not null default 0,
  reason text not null default '',
  source text not null default 'auto' check (source in ('auto', 'manual_include', 'manual_exclude')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, item_id, source),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

create index if not exists smart_collections_user_hidden_pinned_idx
  on public.smart_collections (user_id, hidden, pinned, updated_at desc);

create index if not exists smart_collections_user_slug_idx
  on public.smart_collections (user_id, slug);

create index if not exists smart_collection_items_collection_idx
  on public.smart_collection_items (user_id, collection_id, source);

create index if not exists smart_collection_items_item_idx
  on public.smart_collection_items (user_id, item_id);

alter table public.smart_collections enable row level security;
alter table public.smart_collection_items enable row level security;

drop policy if exists "Users own smart collections" on public.smart_collections;
create policy "Users own smart collections"
  on public.smart_collections
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users own smart collection items" on public.smart_collection_items;
create policy "Users own smart collection items"
  on public.smart_collection_items
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
