create table if not exists public.item_archives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_id text not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'skipped')),
  source_url text not null,
  final_url text,
  canonical_url text,
  title text,
  byline text,
  site_name text,
  excerpt text,
  content_text text,
  content_html text,
  text_length integer not null default 0,
  byte_size integer not null default 0,
  content_hash text,
  http_status integer,
  error_code text,
  error_message text,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

alter table public.item_archives enable row level security;

drop policy if exists "Users own item archives" on public.item_archives;
create policy "Users own item archives"
on public.item_archives for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index if not exists item_archives_user_status_idx
on public.item_archives(user_id, status);

create index if not exists item_archives_user_updated_idx
on public.item_archives(user_id, updated_at desc);
