alter table public.item_analysis
  add column if not exists processing_level text not null default 'basic'
  check (processing_level in ('basic', 'ml', 'ai_enriched'));

alter table public.item_analysis
  add column if not exists source_content_hash text,
  add column if not exists embedding_content_hash text;

alter table public.item_embeddings
  add column if not exists content_hash text;

create index if not exists item_analysis_user_processing_level_idx
on public.item_analysis(user_id, processing_level);

create index if not exists item_analysis_user_source_content_hash_idx
on public.item_analysis(user_id, source_content_hash)
where source_content_hash is not null;

create index if not exists item_embeddings_user_content_hash_idx
on public.item_embeddings(user_id, content_hash)
where content_hash is not null;
