create table if not exists public.item_visual_embeddings (
  item_id text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  embedding double precision[] not null,
  content_hash text,
  embedding_model text not null default 'local-ml-visual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

alter table public.item_visual_embeddings enable row level security;

create policy "Users own visual embeddings"
on public.item_visual_embeddings
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index if not exists item_visual_embeddings_user_content_hash_idx
on public.item_visual_embeddings(user_id, content_hash)
where content_hash is not null;
