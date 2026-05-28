update public.saved_items
set created_at = saved_at_text::timestamptz
where saved_at_text ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
  and saved_at_text::timestamptz is not null
  and created_at <> saved_at_text::timestamptz;
