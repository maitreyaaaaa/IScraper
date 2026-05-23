alter table public.saved_items
  add column if not exists indexing_stage text not null default 'metadata_ready',
  add column if not exists indexing_error text,
  add column if not exists indexed_text_at timestamptz,
  add column if not exists indexed_visual_at timestamptz,
  add column if not exists last_enrichment_requested_at timestamptz;

alter table public.saved_items
  drop constraint if exists saved_items_indexing_stage_check;

alter table public.saved_items
  add constraint saved_items_indexing_stage_check
  check (indexing_stage in (
    'metadata_ready',
    'text_indexed',
    'visual_indexing',
    'visual_indexed',
    'deep_indexed',
    'index_failed'
  ));

update public.saved_items
set
  indexing_stage = case
    when status = 'needs_review' then 'metadata_ready'
    when indexing_stage is null or indexing_stage = 'metadata_ready' then 'text_indexed'
    else indexing_stage
  end,
  indexed_text_at = case
    when status <> 'needs_review' and indexed_text_at is null then updated_at
    else indexed_text_at
  end;

create index if not exists saved_items_user_indexing_stage_idx
  on public.saved_items(user_id, indexing_stage);
