alter table public.item_embeddings
  add column if not exists embedding_model text not null default 'openai/text-embedding-3-small',
  add column if not exists updated_at timestamptz not null default now();

drop index if exists public.item_embeddings_embedding_idx;

create index if not exists item_embeddings_embedding_idx
on public.item_embeddings
using hnsw (embedding extensions.vector_cosine_ops)
where embedding is not null;

create or replace function public.match_saved_items(
  p_user_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_threshold float default 0.2,
  p_match_count int default 30
)
returns table (
  item_id text,
  similarity float
)
language sql
stable
as $$
  select
    item_embeddings.item_id,
    1 - (item_embeddings.embedding <=> p_query_embedding) as similarity
  from public.item_embeddings
  where item_embeddings.user_id = p_user_id
    and item_embeddings.embedding is not null
    and 1 - (item_embeddings.embedding <=> p_query_embedding) >= p_match_threshold
  order by item_embeddings.embedding <=> p_query_embedding
  limit least(p_match_count, 100);
$$;
