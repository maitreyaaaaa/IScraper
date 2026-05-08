alter table public.saved_items
  add column if not exists platform text not null default 'Instagram',
  add column if not exists platform_key text not null default 'instagram',
  add column if not exists source_id text,
  add column if not exists source_title text,
  add column if not exists source_author text,
  add column if not exists source_description text,
  add column if not exists thumbnail_url text;

create index if not exists saved_items_user_platform_idx
on public.saved_items(user_id, platform_key);

update public.saved_items
set
  platform = coalesce(nullif(platform, ''), 'Instagram'),
  platform_key = coalesce(nullif(platform_key, ''), 'instagram'),
  source_id = coalesce(nullif(source_id, ''), id),
  source_title = coalesce(nullif(source_title, ''), left(coalesce(caption, url), 160)),
  source_author = coalesce(nullif(source_author, ''), nullif(owner_username, ''), owner_name),
  source_description = coalesce(nullif(source_description, ''), caption)
where platform_key = 'instagram';
