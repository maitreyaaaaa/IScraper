alter table public.saved_items
  drop constraint if exists saved_items_content_type_check;

alter table public.saved_items
  add constraint saved_items_content_type_check
  check (content_type in ('reel', 'post', 'unknown', 'pin', 'note'));

create index if not exists saved_items_user_content_created_idx
on public.saved_items(user_id, content_type, created_at desc);

create index if not exists saved_items_user_updated_idx
on public.saved_items(user_id, updated_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-assets',
  'note-assets',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read own note assets" on storage.objects;
create policy "Users read own note assets"
on storage.objects for select to authenticated
using (bucket_id = 'note-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users upload own note assets" on storage.objects;
create policy "Users upload own note assets"
on storage.objects for insert to authenticated
with check (bucket_id = 'note-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users update own note assets" on storage.objects;
create policy "Users update own note assets"
on storage.objects for update to authenticated
using (bucket_id = 'note-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'note-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users delete own note assets" on storage.objects;
create policy "Users delete own note assets"
on storage.objects for delete to authenticated
using (bucket_id = 'note-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
