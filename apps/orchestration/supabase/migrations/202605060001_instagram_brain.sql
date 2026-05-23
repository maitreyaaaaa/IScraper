create extension if not exists vector;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null,
  mode text not null check (mode in ('export', 'login-scrape')),
  file_names text[] not null default '{}',
  status text not null default 'imported',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  source_name text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.saved_items (
  id text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  import_id uuid references public.imports(id) on delete set null,
  url text not null,
  content_type text not null check (content_type in ('reel', 'post', 'unknown')),
  caption text,
  hashtags text[] not null default '{}',
  owner_name text,
  owner_username text,
  saved_at_text text,
  collections text[] not null default '{}',
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, url)
);

create table if not exists public.item_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_id text not null,
  asset_type text not null,
  storage_path text not null,
  mime_type text,
  created_at timestamptz not null default now(),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

create table if not exists public.item_analysis (
  item_id text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  summary text,
  transcript text,
  ocr_text text,
  visual_description text,
  brands_mentioned text[] not null default '{}',
  tools_mentioned text[] not null default '{}',
  repos_mentioned text[] not null default '{}',
  people_mentioned text[] not null default '{}',
  topics text[] not null default '{}',
  tags text[] not null default '{}',
  why_useful text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

create table if not exists public.item_embeddings (
  item_id text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  embedding vector(1536),
  content text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  import_id uuid not null references public.imports(id) on delete cascade,
  item_id text not null,
  status text not null check (status in ('queued', 'downloading', 'analyzing', 'done', 'failed')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, item_id),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

create table if not exists public.user_ai_keys (
  user_id uuid primary key references public.users(id) on delete cascade,
  provider text not null check (provider in ('app', 'gemini', 'openai')),
  encrypted_key text,
  key_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.imports enable row level security;
alter table public.collections enable row level security;
alter table public.saved_items enable row level security;
alter table public.item_assets enable row level security;
alter table public.item_analysis enable row level security;
alter table public.item_embeddings enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.user_ai_keys enable row level security;

create policy "Users read own profile" on public.users for select to authenticated using ((select auth.uid()) = id);
create policy "Users insert own profile" on public.users for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users update own profile" on public.users for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Users own imports" on public.imports for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users own collections" on public.collections for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users own saved items" on public.saved_items for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users own assets" on public.item_assets for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users own analysis" on public.item_analysis for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users own embeddings" on public.item_embeddings for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users own jobs" on public.processing_jobs for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users own ai key setting" on public.user_ai_keys for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create index if not exists saved_items_user_status_idx on public.saved_items(user_id, status);
create index if not exists saved_items_user_content_type_idx on public.saved_items(user_id, content_type);
create index if not exists processing_jobs_user_status_idx on public.processing_jobs(user_id, status);
create index if not exists item_embeddings_embedding_idx on public.item_embeddings using hnsw (embedding vector_cosine_ops);

insert into storage.buckets (id, name, public)
values ('instagram-assets', 'instagram-assets', false)
on conflict (id) do nothing;

create policy "Users read own Instagram assets"
on storage.objects for select to authenticated
using (bucket_id = 'instagram-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users upload own Instagram assets"
on storage.objects for insert to authenticated
with check (bucket_id = 'instagram-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users update own Instagram assets"
on storage.objects for update to authenticated
using (bucket_id = 'instagram-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'instagram-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
