alter table public.saved_items
  drop constraint if exists saved_items_content_type_check;

alter table public.saved_items
  add constraint saved_items_content_type_check
  check (content_type in ('reel', 'post', 'unknown', 'pin'));
